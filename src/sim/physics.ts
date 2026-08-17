// Deterministic 2-D golf simulation. No DOM — runs in the browser and headless
// under node (tools/). All randomness comes from the injected Rng.
//
// Aiming: the golfer solves for strike speed on a CALM day with water treated as
// ground (binary search on the noise-free sim), then the real flight gets wind,
// water, and noise. Wind is a shape-choice consideration, not an aiming skill.

import {
	G,
	GIMME_M,
	LIE_POWER,
	ROLL_DECEL,
	ROLL_DECEL_GREEN,
	ROLL_DECEL_ROUGH,
	ROLL_START_SPEED,
	SHAPES,
	SIM_DT,
	WIND_ACCEL,
} from '../tuning'
import type {
	BallState,
	FlightEvent,
	FlightPoint,
	HoleSpec,
	Rng,
	ShapeId,
	ShapeSpec,
	Sim,
	Surface,
} from '../types'
import { gaussian } from './rng'

const CUP_CAPTURE_SPEED = 3.5 // rolling faster than this lips out
const REST_SPEED = 0.25
const TANGENT_KEEP = 0.72 // tangential speed kept through a bounce
const TINY_BOUNCE = 1.2 // normal speed below this = start rolling
const HOMING_SPEED = 1.4 // Dot's listen-roll speed
const MAX_SIM_T = 40
const NEUTRAL_RNG: Rng = () => 0.5

export function terrainY(hole: HoleSpec, x: number): number {
	const pts = hole.terrain
	const first = pts[0]
	const last = pts[pts.length - 1]
	if (!first || !last) return 0
	if (x <= first[0]) return first[1]
	if (x >= last[0]) return last[1]
	for (let i = 1; i < pts.length; i++) {
		const a = pts[i - 1]
		const b = pts[i]
		if (a && b && x <= b[0]) {
			const f = b[0] === a[0] ? 0 : (x - a[0]) / (b[0] - a[0])
			return a[1] + f * (b[1] - a[1])
		}
	}
	return last[1]
}

/** dy/dx of the terrain segment containing x. */
export function terrainSlope(hole: HoleSpec, x: number): number {
	const pts = hole.terrain
	for (let i = 1; i < pts.length; i++) {
		const a = pts[i - 1]
		const b = pts[i]
		if (a && b && x <= b[0]) {
			return b[0] === a[0] ? 0 : (b[1] - a[1]) / (b[0] - a[0])
		}
	}
	return 0
}

export function surfaceAt(hole: HoleSpec, x: number): Surface {
	for (const z of hole.zones) {
		if (x >= z.from && x < z.to) return z.surface
	}
	return 'fairway'
}

interface SimOpts {
	noise: boolean // carry noise is applied by the caller; this gates bounce jitter
	rng: Rng
	wind: number // m/s, 0 in aim mode
	waterIsGround: boolean // aim mode pretends water is fairway
	capture: boolean // aim mode disables cup capture + homing so the aim search
	// converges on the cup CENTER, not the nearest edge of the capture window
}

interface SimResult {
	points: FlightPoint[]
	events: FlightEvent[]
	restX: number
	holed: boolean
	water: boolean
	carry: number
}

function surfaceDecel(s: Surface): number {
	if (s === 'green') return ROLL_DECEL_GREEN
	if (s === 'rough') return ROLL_DECEL_ROUGH
	return ROLL_DECEL
}

/** One strike at actual launch speed, from startX toward dir (+1/-1). */
function simulate(
	hole: HoleSpec,
	startX: number,
	speed: number,
	dir: number,
	shape: ShapeSpec,
	opts: SimOpts,
): SimResult {
	const points: FlightPoint[] = []
	const events: FlightEvent[] = []
	const ang = (shape.launchDeg * Math.PI) / 180
	let x = startX
	let y = terrainY(hole, startX) + 0.01
	let vx = dir * speed * Math.cos(ang)
	let vy = speed * Math.sin(ang)
	let t = 0
	let phase: 'fly' | 'bounce' | 'roll' = 'fly'
	let carry = 0
	let touched = false
	let peaked = false
	let step = 0

	const push = (force = false) => {
		if (force || step % 2 === 0) points.push({ x, y, t, phase })
	}
	const ev = (kind: FlightEvent['kind'], strength?: number) => {
		events.push(strength === undefined ? { t, kind, x } : { t, kind, x, strength })
	}

	ev('launch')
	push(true)

	const surfAt = (px: number): Surface => {
		const s = surfaceAt(hole, px)
		return s === 'water' && opts.waterIsGround ? 'fairway' : s
	}

	// ---- airborne ----
	while (t < MAX_SIM_T) {
		const v = Math.hypot(vx, vy)
		const ax = -shape.drag * v * vx + WIND_ACCEL * opts.wind * shape.windSens
		const ay = -G * (1 - shape.lift) - shape.drag * v * vy
		vx += ax * SIM_DT
		vy += ay * SIM_DT
		x += vx * SIM_DT
		y += vy * SIM_DT
		t += SIM_DT
		step++
		if (!peaked && vy <= 0) {
			peaked = true
			ev('peak')
		}
		const gy = terrainY(hole, x)
		if (y > gy) {
			push()
			continue
		}
		// ---- contact ----
		y = gy
		push(true)
		const surf = surfAt(x)
		if (surf === 'water') {
			ev('splash')
			return { points, events, restX: startX, holed: false, water: true, carry }
		}
		if (surf === 'sand') {
			if (!touched) {
				touched = true
				carry = Math.abs(x - startX)
			}
			ev('land')
			ev('rollstop')
			return { points, events, restX: x, holed: false, water: false, carry }
		}
		const m = terrainSlope(hole, x)
		const nl = Math.hypot(m, 1)
		const nx = -m / nl
		const ny = 1 / nl
		const vn = vx * nx + vy * ny // into-ground component (negative)
		if (vn > 0) {
			// Skimmed over a step lip while still ascending (one dt step can jump the
			// riser top): not a landing. Clamp to the surface and keep flying —
			// treating this as a roll start converts flight speed into a runaway roll.
			y = gy + 0.001
			continue
		}
		if (!touched) {
			touched = true
			carry = Math.abs(x - startX)
		}
		const tx = ny
		const ty = -m / nl // tangent pointing +x-ish
		const vt = vx * tx + vy * ty
		const jitter = opts.noise ? (opts.rng() * 2 - 1) * shape.bounceJitter : 0
		const vnOut = -vn * shape.restitution
		const vtOut = vt * TANGENT_KEEP
		if (vnOut < TINY_BOUNCE || Math.hypot(vnOut, vtOut) < ROLL_START_SPEED) {
			ev('land')
			// ---- roll ----
			phase = 'roll'
			let s = vtOut * shape.rollMult
			let homingDone = shape.homing === undefined
			let prevX = x
			const edgeMin = hole.terrain[0]?.[0] ?? 0
			const edgeMax = hole.terrain[hole.terrain.length - 1]?.[0] ?? hole.length
			while (t < MAX_SIM_T) {
				// The world ends at the terrain polyline — nothing rests off it.
				if (x <= edgeMin || x >= edgeMax) {
					x = Math.min(Math.max(x, edgeMin), edgeMax)
					push(true)
					ev('rollstop')
					return { points, events, restX: x, holed: false, water: false, carry }
				}
				const mm = terrainSlope(hole, x)
				const cos = 1 / Math.hypot(mm, 1)
				const rollSurf = surfAt(x)
				if (rollSurf === 'water') {
					ev('splash')
					return { points, events, restX: startX, holed: false, water: true, carry }
				}
				if (rollSurf === 'sand') {
					ev('rollstop')
					return { points, events, restX: x, holed: false, water: false, carry }
				}
				const aG = (-G * mm) / Math.hypot(mm, 1)
				const aF = s === 0 ? 0 : -Math.sign(s) * surfaceDecel(rollSurf)
				s += (aG + aF) * SIM_DT
				prevX = x
				x += s * cos * SIM_DT
				y = terrainY(hole, x)
				t += SIM_DT
				step++
				push()
				const cup = hole.cupX
				const crossed = (prevX - cup) * (x - cup) <= 0 || Math.abs(x - cup) <= GIMME_M
				if (
					opts.capture &&
					crossed &&
					Math.abs(s) <= CUP_CAPTURE_SPEED &&
					surfaceAt(hole, cup) === 'green'
				) {
					x = cup
					push(true)
					ev('holed')
					return { points, events, restX: cup, holed: true, water: false, carry }
				}
				if (Math.abs(s) < REST_SPEED) {
					const toCup = cup - x
					const h = shape.homing
					if (
						opts.capture &&
						!homingDone &&
						h &&
						Math.abs(toCup) > GIMME_M &&
						Math.abs(toCup) <= h.radius &&
						(rollSurf === 'green' || rollSurf === 'fairway')
					) {
						// Dot listens for the beeper and rolls up to `pull` m closer.
						homingDone = true
						const dirH = Math.sign(toCup)
						const travel = Math.min(h.pull, Math.abs(toCup) - GIMME_M * 0.5)
						let gone = 0
						while (gone < travel && t < MAX_SIM_T) {
							const d = HOMING_SPEED * SIM_DT
							x += dirH * d
							gone += d
							y = terrainY(hole, x)
							t += SIM_DT
							step++
							push()
							if (Math.abs(cup - x) <= GIMME_M) {
								x = cup
								push(true)
								ev('holed')
								return { points, events, restX: cup, holed: true, water: false, carry }
							}
						}
						s = 0
						continue
					}
					if (opts.capture && Math.abs(toCup) <= GIMME_M && surfaceAt(hole, cup) === 'green') {
						x = cup
						push(true)
						ev('holed')
						return { points, events, restX: cup, holed: true, water: false, carry }
					}
					push(true)
					ev('rollstop')
					return { points, events, restX: x, holed: false, water: false, carry }
				}
			}
			break
		}
		// ---- bounce ----
		phase = 'bounce'
		const impact = Math.hypot(vx, vy)
		ev('bounce', Math.min(1, impact / 25))
		let bvx = vtOut * tx + vnOut * nx
		let bvy = vtOut * ty + vnOut * ny
		if (jitter !== 0) {
			const ca = Math.cos(jitter)
			const sa = Math.sin(jitter)
			const rx = bvx * ca - bvy * sa
			const ry = bvx * sa + bvy * ca
			bvx = rx
			bvy = ry
		}
		vx = bvx
		vy = bvy
		y = gy + 0.001
	}
	push(true)
	ev('rollstop')
	return { points, events, restX: x, holed: false, water: false, carry }
}

// ---- aiming ----

const FLAT_HOLE: HoleSpec = {
	name: 'flat',
	intro: '',
	length: 999,
	par: 3,
	wind: 0,
	windText: '',
	terrain: [
		[-700, 0],
		[700, 0],
	],
	zones: [],
	cupX: 9999,
	intendedShapes: [],
}

const AIM_OPTS: SimOpts = {
	noise: false,
	rng: NEUTRAL_RNG,
	wind: 0,
	waterIsGround: true,
	capture: false,
}
const speedCapCache = new Map<ShapeId, number>()

/** Strike speed whose noise-free flat carry equals the shape's maxCarry. */
function speedCap(shape: ShapeSpec): number {
	const hit = speedCapCache.get(shape.id)
	if (hit !== undefined) return hit
	let lo = 2
	let hi = 130
	for (let i = 0; i < 40; i++) {
		const mid = (lo + hi) / 2
		const r = simulate(FLAT_HOLE, 0, mid, 1, shape, AIM_OPTS)
		if (r.carry < shape.maxCarry) lo = mid
		else hi = mid
	}
	const cap = (lo + hi) / 2
	speedCapCache.set(shape.id, cap)
	return cap
}

/**
 * Noise-free strike speed so the ball comes to rest ~targetDist from startX
 * toward dir, capped by the shape's reach. Calm-day aim: no wind, water = ground.
 */
// Keyed on the SPEC OBJECT (not the name): editor holes can share a display
// name while having different geometry — object identity is the honest key.
const solveCache = new WeakMap<HoleSpec, Map<string, number>>()

export function solveSpeed(
	hole: HoleSpec,
	startX: number,
	shape: ShapeSpec,
	targetDist: number,
	dir: number,
): number {
	// Aim varies smoothly with position — a 0.5 m grid is plenty and makes
	// Monte-Carlo harness runs (and in-game strikes) effectively free.
	const key = `${shape.id}|${dir}|${Math.round(startX * 2)}`
	let perHole = solveCache.get(hole)
	if (!perHole) {
		perHole = new Map()
		solveCache.set(hole, perHole)
	}
	const cached = perHole.get(key)
	if (cached !== undefined) return cached
	const cap = speedCap(shape)
	const total = (sp: number) => {
		const r = simulate(hole, startX, sp, dir, shape, AIM_OPTS)
		return dir * (r.restX - startX)
	}
	// total(speed) is NOT monotone near terrain cliffs (a riser face smash and a
	// lip-clearing rocket can sit one m/s apart), so bisection can converge onto
	// the cliff and noise then flips the outcome wildly. Scan instead: pick the
	// speed whose noise-free total lands NEAREST the target — under a wall that
	// honestly chooses the short face-smash advance, like a real golfer would.
	const lo = 1.2
	let best = lo
	let bestErr = Number.POSITIVE_INFINITY
	const consider = (sp: number) => {
		const err = Math.abs(total(sp) - targetDist)
		if (err < bestErr) {
			bestErr = err
			best = sp
		}
	}
	const COARSE = 28
	for (let i = 0; i <= COARSE; i++) consider(lo + ((cap - lo) * i) / COARSE)
	const span = (cap - lo) / COARSE
	const fineLo = Math.max(lo, best - span)
	const fineHi = Math.min(cap, best + span)
	for (let i = 1; i < 12; i++) consider(fineLo + ((fineHi - fineLo) * i) / 12)
	perHole.set(key, best)
	return best
}

/** Noise-free max total distance on flat ground — used by strategy code. */
export function flatReach(id: ShapeId): number {
	const shape = SHAPES[id]
	const r = simulate(FLAT_HOLE, 0, speedCap(shape), 1, shape, AIM_OPTS)
	return r.restX
}

/** Strike with an explicit ShapeSpec — harnesses use this to test variants. */
export function strikeShape(
	hole: HoleSpec,
	ball: BallState,
	shape: ShapeSpec,
	rng: Rng,
): ReturnType<Sim['strike']> {
	const dir = Math.sign(hole.cupX - ball.x) || 1
	const dist = Math.abs(hole.cupX - ball.x)
	const aimed = solveSpeed(hole, ball.x, shape, dist, dir)
	const lie = LIE_POWER[ball.lie] ?? 1
	const noisy = Math.max(1, aimed * lie * (1 + shape.carrySigma * gaussian(rng)))
	const r = simulate(hole, ball.x, noisy, dir, shape, {
		noise: true,
		rng,
		wind: hole.wind,
		waterIsGround: false,
		capture: true,
	})
	const end: BallState = r.water
		? { x: ball.x, lie: ball.lie }
		: { x: r.restX, lie: r.holed ? 'green' : surfaceAt(hole, r.restX) }
	return {
		points: r.points,
		events: r.events,
		end,
		holed: r.holed,
		water: r.water,
		carry: r.carry,
		total: r.water ? 0 : Math.abs(r.restX - ball.x),
	}
}

export function createSim(): Sim {
	return {
		strike(hole, ball, shapeId, rng) {
			return strikeShape(hole, ball, SHAPES[shapeId], rng)
		},
	}
}
