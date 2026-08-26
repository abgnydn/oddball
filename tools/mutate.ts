// Proof that the harnesses are not vacuous: break the shipped code one edit at
// a time and require the suite to go red every time. A green suite over code
// that no longer works is worse than no suite, because it is trusted.
//
// Each mutation is a real regression this project either shipped or nearly
// shipped. Anything that SURVIVES is a hole in the harness, and this exits 1.
//
// This tool WRITES to src/ and restores in a finally, so it refuses to start on
// a dirty tree: `git checkout .` has to stay the correct recovery.
//
// Run:  pnpm mutate

// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the MUTATIONS table
// holds literal source lines to find and replace, not templates to evaluate

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// The bundle runs from node_modules/.cache, so it cannot locate the repo from
// its own path. pnpm always runs a script with the package root as cwd.
const REPO = process.cwd()
const SW = 'src/input/switch.ts'
const SC = 'src/input/scanner.ts'
const FL = 'src/game/flow.ts'
const TT = 'src/speech/tts.ts'
const LN = 'src/game/lines.ts'

interface Mutation {
	name: string
	harness: string
	/** [file, exact text to find, what to put in its place] */
	edits: Array<[string, string, string]>
}

const MUTATIONS: Mutation[] = [
	{
		name: 'switch: drop the canOpenMenu guard',
		harness: 'menu-check',
		edits: [[SW, "\t\t\t\tif (key === 'return' && !canOpenMenu()) return\n", '']],
	},
	{
		name: 'switch: the release that opened the menu selects',
		harness: 'menu-check',
		edits: [
			[
				SW,
				"\t\t\t\tif (key === 'space') emit('autostop')",
				"\t\t\t\temit(key === 'space' ? 'autostop' : 'select')",
			],
		],
	},
	{
		name: 'switch: drop the per-key bounce guard',
		harness: 'input-check',
		edits: [[SW, '\t\t\tif (Date.now() - lastUp[key] < cooldownMs) return\n', '']],
	},
	{
		name: 'scanner: Auto Scan steps into the wrap deadzone',
		harness: 'menu-check',
		edits: [
			[
				SC,
				'else if (index >= items.length - 1) index = auto ? 0 : -1',
				'else if (index >= items.length - 1) index = -1',
			],
		],
	},
	{
		name: 'scanner: drop the pointer-select bounce guard',
		harness: 'menu-check',
		edits: [[SC, '\t\tif (now - lastPointerSelect < INPUT_COOLDOWN_MS) return\n', '']],
	},
	{
		name: 'scanner: Auto Scan ignores the narration hold',
		harness: 'menu-check',
		edits: [[SC, '} else if (autoScanOn && !autoHold) {', '} else if (autoScanOn) {']],
	},
	{
		name: 'tts: no watchdog on a stalled utterance',
		harness: 'menu-check',
		edits: [
			[
				TT,
				'\t\t\tholdWatchdog = setTimeout(() => {\n\t\t\t\tholdWatchdog = null\n\t\t\t\tfireHold(false)\n\t\t\t}, ms)',
				'\t\t\tvoid ms',
			],
		],
	},
	{
		name: 'flow: Delete confirms on a bounce',
		harness: 'menu-check',
		edits: [[FL, '\t\t\t\t\tif (Date.now() - armedDeleteAt < INPUT_COOLDOWN_MS) return\n', '']],
	},
	{
		name: 'flow: New round / Exit confirm on a bounce',
		harness: 'menu-check',
		edits: [
			[
				FL,
				'\t\t\t\tif (Date.now() - armedAt < INPUT_COOLDOWN_MS) return // too fast to be a decision\n',
				'',
			],
		],
	},
	{
		name: 'flow: New round / Exit become one-step',
		harness: 'menu-check',
		edits: [[FL, '\t\t\t\tif (armed !== id) {', '\t\t\t\tif (false as boolean) {']],
	},
	{
		// The anchor MUST include the rack's own preceding comment. Both lists
		// carry a byte-identical menu row, and apply() uses String.replace with a
		// string, which hits the FIRST match — so this mutation used to delete the
		// RANGE's row and pass by failing the range's check, leaving the rack's row
		// covered by nothing while the summary said 15/15. Same class as the
		// index-based PAIR bug fixed below, arriving through source order instead.
		name: 'flow: no scannable Menu row in the rack',
		harness: 'menu-check',
		edits: [
			[
				FL,
				"\t\t\t// which is why it sits last.\n\t\t\t{ id: 'menu', label: L.MENU.openMenu, speak: L.MENU.openMenuSpeak },\n",
				'\t\t\t// which is why it sits last.\n',
			],
		],
	},
	{
		name: 'lines: the shot-deciding yardage goes back to the end of the label',
		harness: 'menu-check',
		edits: [
			[
				LN,
				'\t`${shapeName(id, characters)}. Goes about ${yd(reachM)} yards. ${\n\t\tcharacters ? SHAPES[id].blurb : SHAPES[id].plainBlurb\n\t}`',
				'\t`${shapeName(id, characters)}. ${\n\t\tcharacters ? SHAPES[id].blurb : SHAPES[id].plainBlurb\n\t} Goes about ${yd(reachM)} yards.`',
			],
		],
	},
	{
		name: 'flow: no scannable Menu row in the practice range',
		harness: 'menu-check',
		edits: [
			[
				FL,
				"\t\t\t// The range is gameplay, so §12's scannable pause applies here too.\n\t\t\t// It was in the round rack only, which made the \"no screen needs a\n\t\t\t// hold\" claim false for everyone who cannot sustain one — in the mode\n\t\t\t// most likely to be someone's FIRST screen.\n\t\t\t{ id: 'menu', label: L.MENU.openMenu, speak: L.MENU.openMenuSpeakNoRound },\n",
				'',
			],
		],
	},
	{
		name: 'lines: Auto scan off reads the on explanation',
		harness: 'menu-check',
		edits: [
			[
				LN,
				"\t\tv.startsWith('on')\n\t\t\t? `Auto scan ${v}. The light moves by itself. Enter picks it.`\n\t\t\t: `Auto scan ${v}. Space moves the light. Enter picks it.`,",
				'\t\t`Auto scan ${v}. The light moves by itself. Enter picks it.`,',
			],
		],
	},
]

// Two faults at once must not cancel out into a green run.
// By NAME, not by index: this was `MUTATIONS[3]` and `MUTATIONS[5]`, so
// inserting a mutation above silently re-pointed the pair while it kept the
// name of the one it used to be.
MUTATIONS.push(
	{
		// The cast layer is opt-in, so the DEFAULT reading is the one nobody
		// plays by hand. A half-applied toggle is the likely way it breaks.
		name: 'lines: the cast blurb leaks into the plain reading',
		harness: 'menu-check',
		edits: [
			[LN, '\t\tcharacters ? SHAPES[id].blurb : SHAPES[id].plainBlurb\n', '\t\tSHAPES[id].blurb\n'],
		],
	},
	{
		name: 'lines: the hole-out line ignores the cast setting',
		harness: 'menu-check',
		edits: [
			[
				LN,
				"\tif (out.holed) return characters ? `In the cup! ${HOLED_FLAVOR[id]}` : 'In the cup!'",
				'\tif (out.holed) return `In the cup! ${HOLED_FLAVOR[id]}`',
			],
		],
	},
	{
		name: 'lines: the course best score goes back after the flavour',
		harness: 'menu-check',
		edits: [
			[
				LN,
				"\t`${name}.${best !== undefined ? ` Your best here: ${best} shots.` : ''} ${blurb}`",
				"\t`${name}. ${blurb}${best !== undefined ? ` Your best here: ${best} shots.` : ''}`",
			],
		],
	},
)

const byName = (name: string): Mutation['edits'] => {
	const m = MUTATIONS.find((x) => x.name === name)
	if (m === undefined) throw new Error(`no mutation named ${JSON.stringify(name)}`)
	return m.edits
}

MUTATIONS.push({
	name: 'PAIR: both Auto Scan stepping faults together',
	harness: 'menu-check',
	edits: [
		...byName('scanner: Auto Scan steps into the wrap deadzone'),
		...byName('scanner: Auto Scan ignores the narration hold'),
	],
})

const run = (harness: string): { code: number; out: string } => {
	try {
		execFileSync('pnpm', [harness], { cwd: REPO, encoding: 'utf8', stdio: 'pipe' })
		return { code: 0, out: '' }
	} catch (err) {
		const e = err as { status?: number; stdout?: string; stderr?: string }
		return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
	}
}

const apply = (edits: Mutation['edits']): Map<string, string> => {
	const saved = new Map<string, string>()
	for (const [f, old, next] of edits) {
		const path = join(REPO, f)
		if (!saved.has(path)) saved.set(path, readFileSync(path, 'utf8'))
		const s = readFileSync(path, 'utf8')
		if (!s.includes(old)) {
			for (const [k, v] of saved) writeFileSync(k, v)
			throw new Error(`anchor no longer in ${f}: ${JSON.stringify(old.slice(0, 60))}`)
		}
		writeFileSync(path, s.replace(old, next))
	}
	return saved
}

const restore = (saved: Map<string, string>): void => {
	for (const [k, v] of saved) writeFileSync(k, v)
}

// This tool WRITES to src/. It restores in a finally, but a SIGINT between the
// write and the restore leaves the tree mutated, and a mutated tree that looks
// like your own work is a genuinely bad afternoon. Refuse to start on a dirty
// tree so that `git checkout .` is always the correct recovery.
try {
	const dirty = execFileSync('git', ['status', '--porcelain'], {
		cwd: REPO,
		encoding: 'utf8',
	}).trim()
	if (dirty !== '') {
		console.error(
			'refusing to run: this tool edits src/ in place, and the tree already has\n' +
				'uncommitted changes, so a crash mid-run would be unrecoverable.\n' +
				'Commit or stash first. Dirty paths:\n' +
				dirty,
		)
		process.exit(1)
	}
} catch (err) {
	const e = err as { status?: number }
	if (e.status !== undefined) throw err // git ran and said no
	console.error('refusing to run: could not ask git whether the tree is clean')
	process.exit(1)
}

// Resolve every anchor BEFORE running anything. Two reasons, both learned the
// hard way. A stale anchor used to abort the battery partway through, throwing
// away the minutes of harness runs that had already passed. And an anchor that
// matches TWICE is worse than one that matches zero times: `String.replace`
// silently takes the first hit, so a mutation aimed at the practice range's
// Menu row once deleted the round rack's byte-identical one instead, and the
// mutation "passed" while testing something else entirely.
const anchorErrors: string[] = []
for (const m of MUTATIONS) {
	for (const [f, old] of m.edits) {
		const n = readFileSync(join(REPO, f), 'utf8').split(old).length - 1
		if (n !== 1) {
			anchorErrors.push(`${n === 0 ? 'missing' : `${n} matches`} in ${f} for "${m.name}"`)
		}
	}
}
if (anchorErrors.length > 0) {
	console.error(
		'anchors do not resolve to exactly one site each — the source moved under them:\n' +
			anchorErrors.map((e) => `  ${e}`).join('\n'),
	)
	process.exit(1)
}

const HARNESSES = [...new Set(MUTATIONS.map((m) => m.harness))]
for (const h of HARNESSES) {
	if (run(h).code !== 0) {
		console.error(`baseline ${h} is already red — fix that first`)
		process.exit(1)
	}
}
console.log(`baseline green: ${HARNESSES.join(', ')}\n`)

const survivors: Mutation[] = []
for (const m of MUTATIONS) {
	const saved = apply(m.edits)
	let res: { code: number; out: string }
	try {
		res = run(m.harness)
	} finally {
		restore(saved)
	}
	const fail = res.out.split('\n').find((l) => l.startsWith('FAIL')) ?? ''
	if (res.code === 0) survivors.push(m)
	console.log(
		`${res.code === 0 ? 'SURVIVED' : 'caught  '}  ${m.name}\n            ${m.harness}: ${fail.slice(0, 96) || '(no FAIL line printed)'}`,
	)
}

for (const h of HARNESSES) {
	if (run(h).code !== 0) {
		console.error(`\n${h} did not come back green — the tree may be dirty`)
		process.exit(1)
	}
}

console.log(`\n${MUTATIONS.length - survivors.length}/${MUTATIONS.length} mutations caught`)
if (survivors.length > 0) {
	console.log('SURVIVED — the harness is blind to these:')
	for (const s of survivors) console.log(`  ${s.name}`)
	process.exit(1)
}
console.log('mutate: ALL CAUGHT')
