// Course playability + no-dominance harness. Plays EVERY course over many
// seeds with the intended per-hole strategy and every single-shape strategy.
// Exit 1 on any failure. Run: pnpm holes

import { createSim, flatReach } from '../src/sim/physics'
import { mulberry32 } from '../src/sim/rng'
import { CAL, COURSES, MAX_STROKES, SHAPE_ORDER } from '../src/tuning'
import type { BallState, HoleSpec, Rng, ShapeId } from '../src/types'

const SEEDS = 300
const PURPOSEFUL: ShapeId[] = ['sphere', 'cube', 'disc', 'pancake']
const GAMBLES: ShapeId[] = ['egg', 'star']

let failures = 0
const check = (ok: boolean, label: string) => {
	if (!ok) failures++
	console.log(`${ok ? '  ok ' : 'FAIL '} ${label}`)
}

const sim = createSim()
const reach = new Map<ShapeId, number>()
for (const id of SHAPE_ORDER) reach.set(id, flatReach(id))

type Strategy = (hole: HoleSpec, ball: BallState) => ShapeId

/** Human-like intended play: first listed shape that reaches, else the longest. */
const intended: Strategy = (hole, ball) => {
	const remaining = Math.abs(hole.cupX - ball.x)
	let best: ShapeId = hole.intendedShapes[0] ?? 'sphere'
	let bestReach = -1
	for (const id of hole.intendedShapes) {
		const r = reach.get(id) ?? 0
		if (r >= remaining) return id
		if (r > bestReach) {
			bestReach = r
			best = id
		}
	}
	return best
}

const single =
	(id: ShapeId): Strategy =>
	() =>
		id

interface HoleRun {
	strokes: number
	holed: boolean
	used: Set<ShapeId>
}

let physicsViolations = 0

function playHole(hole: HoleSpec, strategy: Strategy, rng: Rng): HoleRun {
	let ball: BallState = { x: 0, lie: 'fairway' }
	const used = new Set<ShapeId>()
	for (let stroke = 1; stroke <= MAX_STROKES; stroke++) {
		const shape = strategy(hole, ball)
		used.add(shape)
		const out = sim.strike(hole, ball, shape, rng)
		// Sanity: no strike may rest outside the terrain polyline or pin the sim
		// clock (the ascending-lip runaway-roll class was invisible without this).
		const xMin = hole.terrain[0]?.[0] ?? 0
		const xMax = hole.terrain[hole.terrain.length - 1]?.[0] ?? hole.length
		const lastT = out.points[out.points.length - 1]?.t ?? 0
		if (out.end.x < xMin - 1 || out.end.x > xMax + 1 || lastT > 39) {
			physicsViolations++
			if (physicsViolations <= 5)
				console.log(
					`  PHYSICS VIOLATION: ${hole.name} ${shape} from x=${ball.x.toFixed(1)} rests at x=${out.end.x.toFixed(1)} (terrain [${xMin}, ${xMax}], t=${lastT.toFixed(1)})`,
				)
		}
		if (out.holed) return { strokes: stroke, holed: true, used }
		ball = out.end
	}
	return { strokes: MAX_STROKES, holed: false, used }
}

interface StratStats {
	mean: number
	p95: number
	holeRate: number
	strokes: number[]
	used: Set<ShapeId>
}

function runStrategy(
	hole: HoleSpec,
	globalHoleIdx: number,
	strategy: Strategy,
	stratIdx: number,
): StratStats {
	const strokes: number[] = []
	let holed = 0
	const used = new Set<ShapeId>()
	for (let i = 0; i < SEEDS; i++) {
		const rng = mulberry32(100_000 + globalHoleIdx * 10_000 + stratIdx * 1_000_000 + i)
		const r = playHole(hole, strategy, rng)
		strokes.push(r.strokes)
		if (r.holed) holed++
		for (const s of r.used) used.add(s)
	}
	const sorted = [...strokes].sort((a, b) => a - b)
	return {
		mean: strokes.reduce((s, v) => s + v, 0) / SEEDS,
		p95: sorted[Math.floor(0.95 * SEEDS)] ?? MAX_STROKES,
		holeRate: holed / SEEDS,
		strokes,
		used,
	}
}

// ---- run everything ----

interface CourseStats {
	intended: StratStats[]
	single: Map<ShapeId, StratStats[]>
}

const byCourse: CourseStats[] = []

COURSES.forEach((course, ci) => {
	console.log(`\n=== course ${ci + 1}: ${course.name} ===`)
	const intendedByHole: StratStats[] = []
	const singleByHole = new Map<ShapeId, StratStats[]>()
	for (const id of SHAPE_ORDER) singleByHole.set(id, [])
	course.holes.forEach((hole, hi) => {
		const g = ci * 6 + hi
		console.log(`\n— hole ${hi + 1}: ${hole.name} (${hole.length} m, wind ${hole.wind}) —`)
		const int = runStrategy(hole, g, intended, 0)
		intendedByHole.push(int)
		console.log(
			`  intended [${hole.intendedShapes.join(',')}]: mean ${int.mean.toFixed(2)}, p95 ${int.p95}, holed ${(int.holeRate * 100).toFixed(0)}%  used: ${[...int.used].join(',')}`,
		)
		SHAPE_ORDER.forEach((id, si) => {
			const s = runStrategy(hole, g, single(id), si + 1)
			singleByHole.get(id)?.push(s)
			console.log(
				`  all-${id.padEnd(8)}: mean ${s.mean.toFixed(2)}, p95 ${s.p95}, holed ${(s.holeRate * 100).toFixed(0)}%`,
			)
		})
	})
	byCourse.push({ intended: intendedByHole, single: singleByHole })
})

console.log('\n— assertions —')

// 0. Physics sanity across every strike simulated above.
check(physicsViolations === 0, `no rest outside terrain / pinned sim clock (${physicsViolations})`)

COURSES.forEach((course, ci) => {
	const cs = byCourse[ci]
	if (!cs) return
	console.log(`\n  · ${course.name} ·`)

	// 1. Completable: intended holes out within MAX_STROKES on ≥95% of seeds.
	course.holes.forEach((hole, hi) => {
		const rate = cs.intended[hi]?.holeRate ?? 0
		check(
			rate >= 0.95,
			`hole ${hi + 1} ${hole.name}: intended holes out ${(rate * 100).toFixed(0)}% ≥ 95%`,
		)
	})

	// 2. No single-shape strategy beats intended on this course's total.
	const courseTotal = (per: StratStats[]) => per.reduce((s, v) => s + v.mean, 0)
	const intTotal = courseTotal(cs.intended)
	console.log(`  intended course total: ${intTotal.toFixed(2)}`)
	for (const id of SHAPE_ORDER) {
		const tot = courseTotal(cs.single.get(id) ?? [])
		check(tot > intTotal, `all-${id} total ${tot.toFixed(2)} > intended ${intTotal.toFixed(2)}`)
	}

	// 5. Pars match measurement: par = max(2, ceil(intended mean)) — generous for
	//    kids, and beating par stays possible.
	course.holes.forEach((hole, hi) => {
		const measured = Math.max(2, Math.ceil(cs.intended[hi]?.mean ?? MAX_STROKES))
		check(
			hole.par === measured,
			`hole ${hi + 1} ${hole.name}: par ${hole.par} == measured ${measured}`,
		)
	})
})

console.log('\n  · across all holes ·')

// 3. Each purposeful shape earns its place: (near-)best alone on some hole, or
//    used by an intended line that is strictly best on that hole — anywhere
//    across all courses.
const bestMean = byCourse.map((cs, ci) =>
	COURSES[ci]?.holes.map((_, hi) => {
		let best = cs.intended[hi]?.mean ?? MAX_STROKES
		for (const id of SHAPE_ORDER)
			best = Math.min(best, cs.single.get(id)?.[hi]?.mean ?? MAX_STROKES)
		return best
	}),
)
for (const id of PURPOSEFUL) {
	let earned = false
	byCourse.forEach((cs, ci) => {
		COURSES[ci]?.holes.forEach((_, hi) => {
			if (earned) return
			const alone = cs.single.get(id)?.[hi]?.mean ?? MAX_STROKES
			const intHere = cs.intended[hi]
			const best = bestMean[ci]?.[hi] ?? MAX_STROKES
			if (alone <= best + 0.1) earned = true
			else if (intHere?.used.has(id) && intHere.mean <= best + 1e-9) earned = true
		})
	})
	check(earned, `${id} is part of a best line somewhere`)
}

// 4. Gamble shapes: on some hole (either course) the lucky tail beats intended.
for (const id of GAMBLES) {
	let bestRate = 0
	let bestHole = ''
	byCourse.forEach((cs, ci) => {
		COURSES[ci]?.holes.forEach((hole, hi) => {
			const intMean = cs.intended[hi]?.mean ?? MAX_STROKES
			const bar = Math.round(intMean)
			const strokes = cs.single.get(id)?.[hi]?.strokes ?? []
			const rate = strokes.filter((s) => s < bar).length / Math.max(1, strokes.length)
			if (rate > bestRate) {
				bestRate = rate
				bestHole = hole.name
			}
		})
	})
	check(
		bestRate >= CAL.gambleLuckyRate,
		`${id} gamble pays sometimes (best lucky rate ${(bestRate * 100).toFixed(1)}% on ${bestHole} ≥ ${CAL.gambleLuckyRate * 100}%)`,
	)
}

console.log(failures === 0 ? '\nholes: ALL PASS' : `\nholes: ${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
