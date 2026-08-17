// Shape-identity calibration. Runs real strikes headlessly on reference holes and
// asserts every band and identity in CAL. Exit 1 on any failure.
// Run: pnpm calibrate

import { strikeShape } from '../src/sim/physics'
import { mulberry32 } from '../src/sim/rng'
import { CAL, GIMME_M, SHAPE_ORDER, SHAPES } from '../src/tuning'
import type { BallState, HoleSpec, ShapeSpec } from '../src/types'

let failures = 0
const check = (ok: boolean, label: string) => {
	if (!ok) failures++
	console.log(`${ok ? '  ok ' : 'FAIL '} ${label}`)
}

const flatHole = (wind: number): HoleSpec => ({
	name: `flat(wind ${wind})`,
	intro: '',
	length: 900,
	par: 3,
	wind,
	windText: '',
	terrain: [
		[-50, 0],
		[900, 0],
	],
	zones: [],
	cupX: 900, // far away: no capture, no homing — pure ballistics
	intendedShapes: [],
})

const TEE: BallState = { x: 0, lie: 'fairway' }

interface Stats {
	meanCarry: number
	meanTotal: number
	sigma: number
	rollout: number
	p10: number
	p90: number
}

function measure(shape: ShapeSpec, wind: number, seedBase: number): Stats {
	const hole = flatHole(wind)
	const totals: number[] = []
	let carrySum = 0
	for (let i = 0; i < CAL.seeds; i++) {
		const r = strikeShape(hole, TEE, shape, mulberry32(seedBase + i))
		totals.push(r.total)
		carrySum += r.carry
	}
	totals.sort((a, b) => a - b)
	const mean = totals.reduce((s, v) => s + v, 0) / totals.length
	const sigma = Math.sqrt(totals.reduce((s, v) => s + (v - mean) ** 2, 0) / totals.length)
	const q = (p: number) => totals[Math.min(totals.length - 1, Math.floor(p * totals.length))] ?? 0
	return {
		meanCarry: carrySum / totals.length,
		meanTotal: mean,
		sigma,
		rollout: mean - carrySum / totals.length,
		p10: q(0.1),
		p90: q(0.9),
	}
}

console.log('— full-range strikes on flat, calm ground —')
console.log('shape     carry   total   sigma   roll    p10–p90')
const stats = {} as Record<string, Stats>
for (const id of SHAPE_ORDER) {
	const s = measure(SHAPES[id], 0, 1000)
	stats[id] = s
	console.log(
		`${id.padEnd(8)} ${s.meanCarry.toFixed(0).padStart(5)} ${s.meanTotal
			.toFixed(0)
			.padStart(7)} ${s.sigma.toFixed(1).padStart(7)} ${s.rollout
			.toFixed(1)
			.padStart(6)}   ${s.p10.toFixed(0)}–${s.p90.toFixed(0)}`,
	)
}

console.log('\n— bands —')
for (const id of SHAPE_ORDER) {
	const [lo, hi] = CAL.meanTotal[id]
	const m = stats[id]?.meanTotal ?? 0
	check(m >= lo && m <= hi, `${id} mean total ${m.toFixed(0)} in [${lo}, ${hi}]`)
}

console.log('\n— identities —')
const cube = stats.cube
const pancake = stats.pancake
const egg = stats.egg
const star = stats.star
if (cube && pancake && egg && star) {
	check(
		cube.rollout <= CAL.cubeMaxRollout,
		`cube stops dead (rollout ${cube.rollout.toFixed(1)} ≤ ${CAL.cubeMaxRollout})`,
	)
	check(
		pancake.rollout <= CAL.pancakeMaxRollout,
		`pancake sits (rollout ${pancake.rollout.toFixed(1)} ≤ ${CAL.pancakeMaxRollout})`,
	)
	const otherSigmas = SHAPE_ORDER.filter((s) => s !== 'egg').map((s) => stats[s]?.sigma ?? 0)
	const maxOther = Math.max(...otherSigmas)
	check(
		egg.sigma >= CAL.eggSigmaFactor * maxOther,
		`egg is the gamble (sigma ${egg.sigma.toFixed(1)} ≥ ${CAL.eggSigmaFactor} × max-other ${maxOther.toFixed(1)})`,
	)
	check(
		star.p90 - star.p10 >= CAL.starBounceSpread,
		`star chaos (p90−p10 ${(star.p90 - star.p10).toFixed(0)} ≥ ${CAL.starBounceSpread})`,
	)
}

console.log('\n— wind (±6 m/s) —')
const discW = Math.abs(
	measure(SHAPES.disc, 6, 2000).meanTotal - measure(SHAPES.disc, -6, 3000).meanTotal,
)
const sphereW = Math.abs(
	measure(SHAPES.sphere, 6, 2000).meanTotal - measure(SHAPES.sphere, -6, 3000).meanTotal,
)
console.log(`  disc swing ${discW.toFixed(0)} m, sphere swing ${sphereW.toFixed(0)} m`)
check(
	discW >= CAL.discWindSwingFactor * sphereW,
	`wind owns the disc (${discW.toFixed(0)} ≥ ${CAL.discWindSwingFactor} × ${sphereW.toFixed(0)})`,
)

console.log('\n— Dot’s homing (approach from 150 m, green 140–160, cup 150) —')
const homingHole: HoleSpec = {
	name: 'homing-ref',
	intro: '',
	length: 150,
	par: 3,
	wind: 0,
	windText: '',
	terrain: [
		[-50, 0],
		[300, 0],
	],
	zones: [{ from: 140, to: 160, surface: 'green' }],
	cupX: 150,
	intendedShapes: [],
}
const dotOn = SHAPES.sphere
const { homing: _drop, ...rest } = dotOn
const dotOff: ShapeSpec = rest
function homingRun(shape: ShapeSpec, seedBase: number) {
	let distSum = 0
	let holed = 0
	for (let i = 0; i < CAL.seeds; i++) {
		const r = strikeShape(homingHole, TEE, shape, mulberry32(seedBase + i))
		distSum += r.holed ? 0 : Math.abs(r.end.x - homingHole.cupX)
		if (r.holed) holed++
	}
	return { meanDist: distSum / CAL.seeds, holedRate: holed / CAL.seeds }
}
const on = homingRun(dotOn, 5000)
const off = homingRun(dotOff, 5000)
const gain = off.meanDist - on.meanDist
console.log(
	`  homing on: ${on.meanDist.toFixed(1)} m to cup, holed ${(on.holedRate * 100).toFixed(0)}%  |  off: ${off.meanDist.toFixed(1)} m, holed ${(off.holedRate * 100).toFixed(0)}%`,
)
check(
	gain >= CAL.homingGainM[0] && gain <= CAL.homingGainM[1],
	`homing helps but is bounded (gain ${gain.toFixed(1)} m in [${CAL.homingGainM[0]}, ${CAL.homingGainM[1]}])`,
)
check(
	on.holedRate < CAL.homingHoledMax,
	`homing is not an aimbot (holed ${(on.holedRate * 100).toFixed(0)}% < ${CAL.homingHoledMax * 100}%)`,
)
check(GIMME_M <= 2, `gimme stays honest (${GIMME_M} ≤ 2)`)

console.log(failures === 0 ? '\ncalibrate: ALL PASS' : `\ncalibrate: ${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
