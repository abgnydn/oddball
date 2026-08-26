// All numbers live here. Values are tuned until `pnpm calibrate` and
// `pnpm holes` pass — never weaken an assertion to make it pass.

import type { CourseSpec, HoleSpec, Settings, ShapeId, ShapeSpec } from './types'

// ---------- physics constants ----------

export const G = 9.81 // m/s^2
export const SIM_DT = 1 / 120 // s
export const GIMME_M = 1.5 // at rest within this of the cup = holed
export const MAX_STROKES = 8 // per hole, then the ball takes a rest
export const LIE_POWER: Record<string, number> = {
	fairway: 1,
	green: 1,
	rough: 0.85,
	sand: 0.6,
	water: 1, // never struck from water
}
export const ROLL_START_SPEED = 3 // m/s — below this a bounce becomes a roll
export const ROLL_DECEL = 1.6 // m/s^2 baseline rolling deceleration (fairway)
export const ROLL_DECEL_GREEN = 1.1
export const ROLL_DECEL_ROUGH = 3.2
export const WIND_ACCEL = 0.35 // m/s^2 of horizontal accel per (m/s wind × windSens)

// ---------- shapes ----------

export const SHAPES: Record<ShapeId, ShapeSpec> = {
	sphere: {
		id: 'sphere',
		name: 'Dot',
		plainName: 'Ball',
		plainBlurb: 'It rolls true, and it rolls a long way.',
		blurb:
			'Dot hears everything. She listens for the beeper at the cup, and rolls right to it. She does not need to see it.',
		maxCarry: 155,
		launchDeg: 14,
		drag: 0.008,
		lift: 0,
		windSens: 0.6,
		carrySigma: 0.05,
		restitution: 0.38,
		bounceJitter: 0.02,
		rollMult: 1,
		homing: { radius: 15, pull: 5 },
	},
	cube: {
		id: 'cube',
		name: 'Brick',
		plainName: 'Cube',
		plainBlurb: 'It lands and it stays. Wind moves it less than any other shape.',
		blurb: 'Brick lands, and he stays. Wind moves him less than any other shape. Brick is deaf.',
		maxCarry: 85,
		launchDeg: 24,
		drag: 0.02,
		lift: 0,
		windSens: 0.4,
		carrySigma: 0.03,
		restitution: 0.04,
		bounceJitter: 0.01,
		rollMult: 0,
	},
	disc: {
		id: 'disc',
		name: 'Glide',
		plainName: 'Disc',
		plainBlurb: 'It flies farther than anything else. The wind pushes it around the most.',
		blurb:
			'Glide flies, and nobody flies farther. The wind pushes them around the most. Glide does not walk.',
		maxCarry: 235,
		launchDeg: 11,
		drag: 0.006,
		lift: 0.5,
		windSens: 2.6,
		carrySigma: 0.06,
		restitution: 0.15,
		bounceJitter: 0.02,
		rollMult: 0.5,
	},
	egg: {
		id: 'egg',
		name: 'Egg',
		plainName: 'Egg',
		plainBlurb: 'Nobody knows where it will go.',
		blurb: 'The egg. Who knows where it will go? Not even the egg.',
		maxCarry: 190,
		launchDeg: 16,
		drag: 0.009,
		lift: 0,
		windSens: 1.4,
		carrySigma: 0.27,
		restitution: 0.3,
		bounceJitter: 0.12,
		rollMult: 0.8,
	},
	star: {
		id: 'star',
		name: 'Boing',
		plainName: 'Star',
		plainBlurb: 'It bounces, and it keeps bouncing.',
		blurb: "Boing just loves to bounce. Boing! Where will he land? Even he doesn't know.",
		maxCarry: 140,
		launchDeg: 20,
		drag: 0.012,
		lift: 0,
		windSens: 0.9,
		carrySigma: 0.1,
		restitution: 0.72,
		bounceJitter: 0.6,
		rollMult: 0.45,
	},
	pancake: {
		id: 'pancake',
		name: 'Penny',
		plainName: 'Pancake',
		plainBlurb: 'It flies high, lands soft, and stays right there.',
		blurb: 'Penny flies high, lands soft, and stays right there. She taps once for yes.',
		maxCarry: 130,
		launchDeg: 38,
		drag: 0.015,
		lift: 0.1,
		windSens: 1.2,
		carrySigma: 0.045,
		restitution: 0,
		bounceJitter: 0,
		rollMult: 0,
	},
}

export const SHAPE_ORDER: ShapeId[] = ['sphere', 'cube', 'disc', 'egg', 'star', 'pancake']

// ---------- calibration bands (asserted by tools/calibrate.ts) ----------
// Flat reference hole, full-range strike, N seeds. [min, max] on the mean total.

export const CAL = {
	seeds: 400,
	meanTotal: {
		sphere: [175, 205] as [number, number],
		cube: [70, 95] as [number, number],
		disc: [225, 265] as [number, number],
		egg: [150, 230] as [number, number],
		star: [110, 170] as [number, number],
		pancake: [115, 140] as [number, number],
	},
	// identity assertions
	cubeMaxRollout: 2, // m, and rest-to-carry gap
	pancakeMaxRollout: 1,
	eggSigmaFactor: 2.5, // egg total σ ≥ factor × every other shape's σ
	discWindSwingFactor: 3, // |disc Δtotal at ±6 m/s wind| ≥ factor × sphere's
	starBounceSpread: 25, // m, star total range (p90−p10) minimum
	// Dot's homing (CAST.md): from a full approach, mean finish-distance improves
	// by 1–6 m vs homing-disabled, and single-stroke hole-out rate stays < 0.6.
	homingGainM: [1, 6] as [number, number],
	homingHoledMax: 0.6,
	// Gamble shapes (egg, star) are never in a best line by design ("fun over
	// function") — instead each must have ≥1 hole where its lucky tail beats the
	// intended line: P(strokes < round(intended mean)) ≥ this rate.
	gambleLuckyRate: 0.03,
}

// ---------- courses ----------
// Terrain: polyline (x, y). Zones: explicit non-fairway spans; rest is fairway.
// Pars are measured by tools/holes.ts — the values here must match its output.

const SUNNY: HoleSpec[] = [
	{
		name: 'The Runway',
		intro: 'A long flat field. An easy start.',
		length: 170,
		par: 2,
		wind: 0,
		windText: 'No wind.',
		terrain: [
			[0, 0],
			[300, 0],
		],
		zones: [
			{ from: 160, to: 180, surface: 'green' },
			{ from: 180, to: 300, surface: 'rough' },
		],
		cupX: 170,
		intendedShapes: ['sphere'],
	},
	{
		name: 'The Pond',
		intro: 'Water sits in the middle. Fly over it, or stop short.',
		length: 150,
		par: 3,
		wind: 0,
		windText: 'No wind.',
		terrain: [
			[0, 0],
			[90, 0],
			[92, -1.5],
			[123, -1.5],
			[125, 0],
			[280, 0],
		],
		zones: [
			{ from: 90, to: 125, surface: 'water' },
			{ from: 140, to: 160, surface: 'green' },
			{ from: 160, to: 280, surface: 'rough' },
		],
		cupX: 150,
		intendedShapes: ['cube', 'pancake'],
	},
	{
		name: 'The Gale',
		intro: 'Keep low and take it one step at a time.',
		length: 210,
		par: 3,
		wind: -6,
		windText: 'A big wind blows against you.',
		terrain: [
			[0, 0],
			[340, 0],
		],
		zones: [
			{ from: 200, to: 220, surface: 'green' },
			{ from: 220, to: 340, surface: 'rough' },
		],
		cupX: 210,
		intendedShapes: ['sphere'],
	},
	{
		name: 'Tiny',
		intro: 'A short hole with sand all around the green.',
		length: 55,
		par: 2,
		wind: 0,
		windText: 'No wind.',
		terrain: [
			[0, 0],
			[130, 0],
		],
		zones: [
			{ from: 35, to: 50, surface: 'sand' },
			{ from: 50, to: 60, surface: 'green' },
			{ from: 60, to: 75, surface: 'sand' },
			{ from: 75, to: 130, surface: 'rough' },
		],
		cupX: 55,
		intendedShapes: ['cube'],
	},
	{
		name: 'The Staircase',
		intro: 'Three big steps go up, up, up.',
		length: 240,
		par: 3,
		wind: 0,
		windText: 'No wind.',
		terrain: [
			[0, 0],
			[60, 0],
			[66, 4],
			[130, 4],
			[136, 8],
			[200, 8],
			[206, 12],
			[320, 12],
		],
		zones: [
			{ from: 230, to: 250, surface: 'green' },
			{ from: 250, to: 320, surface: 'rough' },
		],
		cupX: 240,
		intendedShapes: ['cube', 'pancake'],
	},
	{
		name: 'Home Stretch',
		intro: 'The last hole. It is very long, but the wind helps you.',
		length: 320,
		par: 3,
		wind: 3,
		windText: 'A soft wind pushes you along.',
		terrain: [
			[0, 0],
			[440, 0],
		],
		zones: [
			{ from: 310, to: 330, surface: 'green' },
			{ from: 330, to: 440, surface: 'rough' },
		],
		cupX: 320,
		intendedShapes: ['cube', 'pancake', 'disc'],
	},
]

const CANYON: HoleSpec[] = [
	{
		name: 'The Drop',
		intro: 'You start way up high. Everything flies farther from here.',
		length: 230,
		par: 2,
		wind: 0,
		windText: 'No wind.',
		terrain: [
			[0, 14],
			[8, 14],
			[20, 6],
			[40, 0],
			[380, 0],
		],
		zones: [
			{ from: 220, to: 240, surface: 'green' },
			{ from: 240, to: 380, surface: 'rough' },
		],
		cupX: 230,
		intendedShapes: ['cube', 'sphere', 'disc'],
	},
	{
		name: 'Island Green',
		intro: 'The green is a little island. Land on it, or swim.',
		length: 132,
		par: 2,
		wind: 0,
		windText: 'No wind.',
		terrain: [
			[0, 0],
			[70, 0],
			[72, -1.5],
			[113, -1.5],
			[115, 0],
			[150, 0],
			[152, -1.5],
			[183, -1.5],
			[185, 0],
			[260, 0],
		],
		zones: [
			{ from: 70, to: 115, surface: 'water' },
			{ from: 118, to: 146, surface: 'green' },
			{ from: 150, to: 185, surface: 'water' },
			{ from: 185, to: 260, surface: 'rough' },
		],
		cupX: 132,
		intendedShapes: ['pancake'],
	},
	{
		name: 'The Canyon',
		intro: 'A deep canyon cuts the fairway in two. Fly across it.',
		length: 280,
		par: 3,
		wind: 0,
		windText: 'No wind.',
		terrain: [
			[0, 0],
			[82, 0],
			[90, -18],
			[147, -18],
			[155, 0],
			[400, 0],
		],
		zones: [
			{ from: 90, to: 147, surface: 'water' },
			{ from: 270, to: 290, surface: 'green' },
			{ from: 290, to: 400, surface: 'rough' },
		],
		cupX: 280,
		intendedShapes: ['pancake', 'disc'],
	},
	{
		name: 'Bumpy Road',
		intro: 'Bumpy little hills go up and up. Rolling is hard here.',
		length: 185,
		par: 3,
		wind: 0,
		windText: 'No wind.',
		terrain: [
			[0, 0],
			[70, 0],
			[78, 3.5],
			[86, 1],
			[94, 4.5],
			[102, 2],
			[110, 5.5],
			[118, 3],
			[126, 6.5],
			[134, 4],
			[142, 7.5],
			[150, 5],
			[158, 9],
			[300, 9],
		],
		zones: [
			{ from: 175, to: 195, surface: 'green' },
			{ from: 195, to: 300, surface: 'rough' },
		],
		cupX: 185,
		intendedShapes: ['pancake', 'cube'],
	},
	{
		name: 'The Wall',
		intro: 'A tall wall stands before the green. Go up and over.',
		length: 95,
		par: 2,
		wind: 0,
		windText: 'No wind.',
		terrain: [
			[0, 0],
			[58, 0],
			[60, 10],
			[130, 10],
		],
		zones: [
			{ from: 85, to: 105, surface: 'green' },
			{ from: 105, to: 130, surface: 'rough' },
		],
		cupX: 95,
		intendedShapes: ['pancake'],
	},
	{
		name: 'Home Run',
		intro: 'Wide open and very long. The wind is on your side.',
		length: 350,
		par: 3,
		wind: 5,
		windText: 'A strong wind pushes you along.',
		terrain: [
			[0, 0],
			[470, 0],
		],
		zones: [
			{ from: 340, to: 360, surface: 'green' },
			{ from: 360, to: 470, surface: 'rough' },
		],
		cupX: 350,
		intendedShapes: ['cube', 'pancake', 'disc'],
	},
]

export const COURSES: CourseSpec[] = [
	{ name: 'Sunny Meadows', blurb: 'Six friendly holes. A great place to start.', holes: SUNNY },
	{
		name: 'Wild Canyon',
		blurb: 'Six tricky holes. Cliffs, islands, and a big canyon.',
		holes: CANYON,
	},
]

// Back-compat alias: the renderer keys its time-of-day off an index into this.
export const COURSE: HoleSpec[] = SUNNY

// The practice range: no cup (cupX beyond the terrain), no score — pure play.
export const RANGE: HoleSpec = {
	name: 'The Range',
	intro: 'The practice field. Pick a shape and watch it go. No cup, no score.',
	length: 400,
	par: 2,
	wind: 0,
	windText: 'No wind.',
	terrain: [
		[0, 0],
		[420, 0],
	],
	zones: [],
	cupX: 9999,
	intendedShapes: [],
}

// ---------- hole editor option tables ----------
// Every editor row cycles one of these; the composer (src/game/composer.ts)
// turns a full EditorParams into a playable HoleSpec by construction.

export const EDITOR_OPTIONS = {
	length: [
		{ label: 'Short', m: 60 },
		{ label: 'Medium', m: 130 },
		{ label: 'Long', m: 200 },
		{ label: 'Very long', m: 300 },
	],
	hills: [{ label: 'Flat ground' }, { label: 'Steps going up' }, { label: 'Downhill start' }],
	water: [{ label: 'No water' }, { label: 'Water in the middle' }, { label: 'Water near the cup' }],
	sand: [{ label: 'No sand' }, { label: 'Sand around the green' }, { label: 'Sand patches' }],
	wind: [
		{ label: 'Big wind against you', wind: -6 },
		{ label: 'A little wind against you', wind: -3 },
		{ label: 'No wind', wind: 0 },
		{ label: 'A little wind helping you', wind: 3 },
		{ label: 'Big wind helping you', wind: 5 },
	],
} as const

// ---------- defaults ----------

export const DEFAULT_SETTINGS: Settings = {
	ttsOn: true,
	ttsRate: 1,
	ttsVolume: 1,
	scanMs: 2000, // the hub's shipped default (their shared/scan-manager.js)
	fontScale: 125,
	theme: 'high-contrast',
	highlightThick: 'medium',
	audioCues: true,
	reduceMotion: false,
	flightTone: true,
	dwell: 'off',
	autoScan: false,
	characters: false,
}

export const DWELL_MS = { slow: 2000, fast: 1200 } as const

export const SPACE_HOLD_MS = 3000 // hold-Space → backward scanning (shipped-hub scheme)
// Context-menu threshold. §4 gives the convention as ~3 s to scan backwards and
// ~5 s to pause and asks new games to match, while noting no shared file enforces
// either. This build uses 3 s and so departs from the ~5 s figure; DESIGN.md
// lists it. BENNYSMINIGOLF uses 6 s for
// the same gesture (gameplay only); BENNYSFOOTBALL has no Enter-hold menu at
// all. 3 s is this game's own middle, matching its hold-Space threshold. Long
// enough that a deliberate select is never mistaken for a menu request, and the
// release that opens the menu is consumed, so a misfire opens a menu the player
// closes with one more press rather than picking something they never chose.
export const RETURN_HOLD_MS = 3000
export const INPUT_COOLDOWN_MS = 250

/** px the pointer must travel from where it sat when a list was rebuilt before
 *  hover-to-pick will start again. Any movement at all would be defeated by an
 *  eye tracker's constant jitter, which is the input this guard exists for; a
 *  deliberate move to another row is far larger than this. */
export const DWELL_REARM_PX = 24

/** The scan-speed ladder, and the step the Scan Speed row takes. Exported so the
 *  harness pins THIS function rather than a copy of it: a speed saved by an older
 *  build sits between rungs, and must step UP to the next slower one rather than
 *  snapping to the fastest — the player who saved 1.6 s did it because 1 s was
 *  too fast for them. Values from the hub's shared/scan-manager.js SCAN_SPEEDS. */
export const SCAN_SPEEDS = [1000, 2000, 3000, 4000] as const

/** How many holes someone can keep. The single source: flow.ts's cap, save.ts's
 *  truncation on load, and the spoken "you have ten already" all read it. The
 *  first attempt at this moved only flow.ts and left three hand-written tens
 *  behind — in lines.ts, save.ts and the README — while the comment here
 *  claimed, in the past tense, that the drift was fixed. */
export const MAX_CUSTOM_HOLES = 10

export const nextScanMs = (cur: number): number =>
	SCAN_SPEEDS.find((ms) => ms > cur) ?? SCAN_SPEEDS[0]

export const YARDS_PER_M = 1.09361
export const yd = (m: number): number => Math.round(m * YARDS_PER_M)
