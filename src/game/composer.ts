// Hole-editor composer. Turns scan-friendly option picks (indices into
// EDITOR_OPTIONS) into a valid, playable HoleSpec by construction: terrain x
// ascending, the cup on a ~20 m green, water never under the tee or the green,
// every span clamped so no combo can produce an uncompletable hole.
// Verified by tools/editor-check.ts (pnpm editor-check).

import { strikeShape } from '../sim/physics'
import { mulberry32 } from '../sim/rng'
import { EDITOR_OPTIONS, MAX_STROKES, SHAPES } from '../tuning'
import type { BallState, EditorParams, HoleSpec, ShapeId, Zone } from '../types'

const TEE_CLEAR_M = 45 // water never starts before this
const GREEN_GAP_M = 25 // landable fairway between any water and the green
const GREEN_HALF_M = 10 // green = cup ± this
const TAIL_M = 90 // terrain (rough) beyond the cup

const clampIdx = (len: number, i: number): number =>
	Math.min(len - 1, Math.max(0, Math.round(Number.isFinite(i) ? i : 0)))

export function composeHole(params: EditorParams): HoleSpec {
	const lengthOpt = EDITOR_OPTIONS.length[clampIdx(EDITOR_OPTIONS.length.length, params.length)]!
	const hillsIdx = clampIdx(EDITOR_OPTIONS.hills.length, params.hills)
	const waterIdx = clampIdx(EDITOR_OPTIONS.water.length, params.water)
	const sandIdx = clampIdx(EDITOR_OPTIONS.sand.length, params.sand)
	const windOpt = EDITOR_OPTIONS.wind[clampIdx(EDITOR_OPTIONS.wind.length, params.wind)]!

	const L = lengthOpt.m
	const end = L + TAIL_M
	const greenFrom = L - GREEN_HALF_M
	const greenTo = L + GREEN_HALF_M

	// Water span first — terrain steps route around it. Both placements keep the
	// tee side clear (≥ TEE_CLEAR_M) and a ≥ GREEN_GAP_M landing strip before
	// the green; a span that cannot fit (short holes) is dropped entirely.
	let water: [number, number] | null = null
	if (waterIdx === 1) {
		const from = Math.max(TEE_CLEAR_M, Math.round(0.4 * L) - 15)
		const to = Math.min(from + 30, greenFrom - GREEN_GAP_M)
		if (to - from >= 12) water = [from, to]
	} else if (waterIdx === 2) {
		const to = greenFrom - GREEN_GAP_M
		const from = Math.max(TEE_CLEAR_M, to - 25)
		if (to - from >= 12) water = [from, to]
	}

	// Terrain by hills option. Modest heights only; the last ~25 m before the
	// green (and the green itself) always sit on flat ground.
	let terrain: Array<[number, number]>
	if (hillsIdx === 1) {
		// Steps going up, Staircase-style: 6 m risers, flat treads.
		const stepH = L <= 90 ? 3 : 4
		const spots = L >= 200 ? [0.28, 0.55] : [0.4]
		terrain = [[0, 0]]
		let y = 0
		let lastX = 0
		for (const f of spots) {
			let r = Math.round(f * L)
			// Never put a riser inside water; hop it to just past the far bank.
			if (water && r + 6 > water[0] - 2 && r < water[1] + 2) r = water[1] + 4
			if (r < lastX + 10 || r + 6 > L - 25) continue
			terrain.push([r, y])
			y += stepH
			terrain.push([r + 6, y])
			lastX = r + 6
		}
		terrain.push([end, y])
	} else if (hillsIdx === 2) {
		// Downhill start, Drop-style: a high tee, down to the fairway well
		// before any water (drop ends by x=30 < TEE_CLEAR_M).
		const h = L >= 130 ? 10 : 5
		const dropEnd = Math.min(30, Math.round(0.4 * L))
		terrain = [
			[0, h],
			[6, h],
			[Math.round(dropEnd * 0.55), h * 0.45],
			[dropEnd, 0],
			[end, 0],
		]
	} else {
		terrain = [
			[0, 0],
			[end, 0],
		]
	}

	// Sand per its option. Around-green hugs the green like Tiny; patches skip
	// anything that would touch water, the tee, or the approach strip.
	const sands: Zone[] = []
	if (sandIdx === 1) {
		sands.push({ from: L - 25, to: greenFrom, surface: 'sand' })
		sands.push({ from: greenTo, to: L + 25, surface: 'sand' })
	} else if (sandIdx === 2) {
		for (const f of [0.3, 0.62]) {
			const from = Math.max(25, Math.round(f * L))
			const to = from + 10
			if (to > greenFrom - 5) continue
			if (water && to > water[0] - 3 && from < water[1] + 3) continue
			sands.push({ from, to, surface: 'sand' })
		}
	}

	const zones: Zone[] = []
	if (water) zones.push({ from: water[0], to: water[1], surface: 'water' })
	zones.push(...sands)
	zones.push({ from: greenFrom, to: greenTo, surface: 'green' })
	zones.push({ from: sandIdx === 1 ? L + 25 : greenTo, to: end, surface: 'rough' })
	zones.sort((a, b) => a.from - b.from)

	// Plain short words straight from the option labels.
	const parts = [`A ${lengthOpt.label.toLowerCase()} hole.`]
	parts.push(`${EDITOR_OPTIONS.hills[hillsIdx]!.label}.`)
	if (water) parts.push(`${EDITOR_OPTIONS.water[waterIdx]!.label}.`)
	if (sands.length > 0) parts.push(`${EDITOR_OPTIONS.sand[sandIdx]!.label}.`)

	// Best guess by construction — used only to color the narration.
	const intendedShapes: ShapeId[] = []
	const add = (id: ShapeId) => {
		if (!intendedShapes.includes(id)) intendedShapes.push(id)
	}
	if (L >= 200) add('disc')
	if (water) add('pancake')
	if (hillsIdx === 1) add('pancake')
	if (sandIdx === 1) add('cube')
	if (windOpt.wind <= -3) add('sphere')
	if (windOpt.wind >= 3 && L >= 130) add('disc')
	if (intendedShapes.length === 0) add(L <= 90 ? 'cube' : 'sphere')

	return {
		name: 'My Hole',
		intro: parts.join(' '),
		length: L,
		// Structural guess only — the flow shows the measured estimatePar value.
		par: Math.max(2, Math.min(6, 2 + (L > 160 ? 1 : 0) + (L > 260 ? 1 : 0))),
		wind: windOpt.wind,
		windText: `${windOpt.label}.`,
		terrain,
		zones,
		cupX: L,
		intendedShapes: intendedShapes.slice(0, 3),
	}
}

// ---------- measured par ----------

const PAR_SHAPES: ShapeId[] = ['sphere', 'cube', 'disc', 'pancake']
const PAR_SEEDS = 30

/** Par from the real sim: best mean strokes among a few sensible single-shape
 *  strategies over PAR_SEEDS seeded rounds; par = max(2, ceil(best mean)). */
export function estimatePar(hole: HoleSpec): number {
	// solveSpeed caches aim by hole NAME, and every editor hole is 'My Hole' —
	// simulate under a content-hashed alias so the cache never mixes two
	// different compositions (and repeat calls on the same spec stay warm).
	const alias: HoleSpec = { ...hole, name: `${hole.name}#${specHash(hole)}` }
	let best = MAX_STROKES
	PAR_SHAPES.forEach((id, si) => {
		let sum = 0
		for (let i = 0; i < PAR_SEEDS; i++) {
			const rng = mulberry32(700_000 + si * 10_000 + i)
			let ball: BallState = { x: 0, lie: 'fairway' }
			let strokes = MAX_STROKES
			for (let stroke = 1; stroke <= MAX_STROKES; stroke++) {
				const out = strikeShape(alias, ball, SHAPES[id], rng)
				if (out.holed) {
					strokes = stroke
					break
				}
				ball = out.end
			}
			sum += strokes
		}
		best = Math.min(best, sum / PAR_SEEDS)
	})
	return Math.max(2, Math.ceil(best))
}

/** FNV-1a over the fields that change the sim — stable across sessions. */
function specHash(hole: HoleSpec): string {
	const s = `${hole.length}|${hole.wind}|${hole.cupX}|${hole.terrain
		.map((p) => p.join(','))
		.join(';')}|${hole.zones.map((z) => `${z.from}-${z.to}-${z.surface}`).join(';')}`
	let h = 2166136261
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i)
		h = Math.imul(h, 16777619)
	}
	return (h >>> 0).toString(36)
}
