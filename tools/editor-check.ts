// Hole-editor composer harness. Composes every corner combo (min/max of each
// option) plus 30 deterministic mixed combos and asserts, for each hole:
// spec validity (x ascending, cup on green, zones inside terrain, water never
// under tee/green), estimatePar in [2, 6] and fast, and completability within
// MAX_STROKES on ≥90% of seeds by the best single-shape strategy.
// Exit 1 on any failure. Run: pnpm editor-check

import { composeHole, estimatePar } from '../src/game/composer'
import { strikeShape, surfaceAt } from '../src/sim/physics'
import { mulberry32 } from '../src/sim/rng'
import { EDITOR_OPTIONS, MAX_STROKES, SHAPES } from '../src/tuning'
import type { BallState, EditorParams, HoleSpec, ShapeId } from '../src/types'

const SEEDS = 40
const MIN_RATE = 0.9
// Generous on purpose: this is a smoke test that par estimation is not
// pathological, not a benchmark. A cold run on a loaded machine blew the old
// 2000 ms gate while the par values stayed byte-identical across every run, so
// the gate was reporting machine load, not code.
const PAR_MS_BUDGET = 15000
const TRY_SHAPES: ShapeId[] = ['sphere', 'cube', 'disc', 'pancake']

let failures = 0
const fail = (label: string) => {
	failures++
	console.log(`FAIL  ${label}`)
}

// ---- combo list: 2^5 corners + 30 seeded mixed picks, deduped ----

const lens = [
	EDITOR_OPTIONS.length.length,
	EDITOR_OPTIONS.hills.length,
	EDITOR_OPTIONS.water.length,
	EDITOR_OPTIONS.sand.length,
	EDITOR_OPTIONS.wind.length,
]
const combos: number[][] = []
const seen = new Set<string>()
const push = (c: number[]) => {
	const key = c.join(',')
	if (!seen.has(key)) {
		seen.add(key)
		combos.push(c)
	}
}
for (let mask = 0; mask < 32; mask++) {
	push(lens.map((n, i) => (((mask >> i) & 1) === 1 ? n - 1 : 0)))
}
const mixRng = mulberry32(20_260_816)
while (combos.length < 32 + 30) {
	push(lens.map((n) => Math.floor(mixRng() * n)))
}

// ---- checks ----

function validate(hole: HoleSpec, tag: string): void {
	const first = hole.terrain[0]
	const last = hole.terrain[hole.terrain.length - 1]
	if (!first || !last) {
		fail(`${tag}: empty terrain`)
		return
	}
	for (let i = 1; i < hole.terrain.length; i++) {
		if ((hole.terrain[i]?.[0] ?? 0) <= (hole.terrain[i - 1]?.[0] ?? 0))
			fail(`${tag}: terrain x not ascending at point ${i}`)
	}
	if (first[0] !== 0) fail(`${tag}: terrain does not start at x=0`)
	if (hole.cupX !== hole.length) fail(`${tag}: cupX ${hole.cupX} != length ${hole.length}`)
	if (surfaceAt(hole, hole.cupX) !== 'green') fail(`${tag}: cup not on green`)
	const green = hole.zones.find((z) => z.surface === 'green')
	if (!green) fail(`${tag}: no green zone`)
	else if (hole.cupX - green.from < 8 || green.to - hole.cupX < 8 || green.to - green.from < 18)
		fail(`${tag}: green not ~20 m around the cup (${green.from}–${green.to}, cup ${hole.cupX})`)
	const sorted = [...hole.zones].sort((a, b) => a.from - b.from)
	for (let i = 0; i < sorted.length; i++) {
		const z = sorted[i]
		if (!z) continue
		if (z.from >= z.to || z.from < 0 || z.to > last[0])
			fail(`${tag}: zone ${z.surface} ${z.from}–${z.to} outside terrain [0, ${last[0]}]`)
		const next = sorted[i + 1]
		if (next && z.to > next.from)
			fail(
				`${tag}: zones overlap (${z.surface} ${z.from}–${z.to} vs ${next.surface} ${next.from}–${next.to})`,
			)
		if (z.surface === 'water') {
			if (z.from < 40) fail(`${tag}: water ${z.from}–${z.to} too close to the tee`)
			if (green && z.to > green.from - 20)
				fail(
					`${tag}: water ${z.from}–${z.to} leaves < 20 m landing strip before green ${green.from}`,
				)
		}
	}
	if (surfaceAt(hole, 0) === 'water') fail(`${tag}: tee is in water`)
}

function completeRate(hole: HoleSpec, comboIdx: number): { rate: number; shape: ShapeId } {
	// Unique alias per combo — solveSpeed caches aim by hole name, and every
	// composed hole is named 'My Hole'.
	const alias: HoleSpec = { ...hole, name: `check-${comboIdx}` }
	let bestRate = 0
	let bestShape: ShapeId = TRY_SHAPES[0] ?? 'sphere'
	TRY_SHAPES.forEach((id, si) => {
		let holed = 0
		for (let i = 0; i < SEEDS; i++) {
			const rng = mulberry32(800_000 + comboIdx * 1_000 + si * 100_000 + i)
			let ball: BallState = { x: 0, lie: 'fairway' }
			for (let stroke = 1; stroke <= MAX_STROKES; stroke++) {
				const out = strikeShape(alias, ball, SHAPES[id], rng)
				if (out.holed) {
					holed++
					break
				}
				ball = out.end
			}
		}
		const rate = holed / SEEDS
		if (rate > bestRate) {
			bestRate = rate
			bestShape = id
		}
	})
	return { rate: bestRate, shape: bestShape }
}

// ---- run ----

console.log(`editor-check: ${combos.length} combos (32 corners + ${combos.length - 32} mixed)\n`)
let maxParMs = 0
let sumParMs = 0

combos.forEach((c, ci) => {
	const params: EditorParams = {
		length: c[0] ?? 0,
		hills: c[1] ?? 0,
		water: c[2] ?? 0,
		sand: c[3] ?? 0,
		wind: c[4] ?? 0,
	}
	const hole = composeHole(params)
	const tag = `combo [${c.join(',')}] (${hole.length} m, wind ${hole.wind})`
	validate(hole, tag)
	const t0 = performance.now()
	const par = estimatePar(hole)
	const ms = performance.now() - t0
	maxParMs = Math.max(maxParMs, ms)
	sumParMs += ms
	if (par < 2 || par > 6) fail(`${tag}: estimatePar ${par} outside [2, 6]`)
	const { rate, shape } = completeRate(hole, ci)
	if (rate < MIN_RATE)
		fail(
			`${tag}: best single-shape completion ${(rate * 100).toFixed(0)}% (${shape}) < ${MIN_RATE * 100}%`,
		)
	console.log(
		`  ${rate >= MIN_RATE && par >= 2 && par <= 6 ? 'ok ' : 'BAD'} [${c.join(',')}] par ${par} (${ms.toFixed(0)} ms)  complete ${(rate * 100).toFixed(0)}% (${shape})  ${hole.intro}`,
	)
})

console.log(
	`\n  estimatePar timing: mean ${(sumParMs / combos.length).toFixed(0)} ms, max ${maxParMs.toFixed(0)} ms (budget ${PAR_MS_BUDGET} ms)`,
)
if (maxParMs > PAR_MS_BUDGET)
	fail(`estimatePar max ${maxParMs.toFixed(0)} ms > ${PAR_MS_BUDGET} ms`)

console.log(failures === 0 ? '\neditor-check: ALL PASS' : `\neditor-check: ${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
