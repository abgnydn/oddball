// Proof that the harnesses are not vacuous: break the shipped code one edit at
// a time and require the suite to go red every time. A green suite over code
// that no longer works is worse than no suite, because it is trusted.
//
// Each mutation is a real regression this project either shipped or nearly
// shipped. Anything that SURVIVES is a hole in the harness, and this exits 1.
//
// Run:  pnpm mutate

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
		name: 'flow: no scannable Menu row in the rack',
		harness: 'menu-check',
		edits: [
			[FL, "\t\t\t{ id: 'menu', label: L.MENU.openMenu, speak: L.MENU.openMenuSpeak },\n", ''],
		],
	},
	{
		name: 'lines: Auto scan off reads the on explanation',
		harness: 'menu-check',
		// biome-ignore-start lint/suspicious/noTemplateCurlyInString: these are the
		// literal source lines being searched for and replaced, not templates
		edits: [
			[
				LN,
				"\t\tv.startsWith('on')\n\t\t\t? `Auto scan ${v}. The light moves by itself. Enter picks it.`\n\t\t\t: `Auto scan ${v}. Space moves the light. Enter picks it.`,",
				'\t\t`Auto scan ${v}. The light moves by itself. Enter picks it.`,',
			],
		],
		// biome-ignore-end lint/suspicious/noTemplateCurlyInString: end of the literals
	},
]

// Two faults at once must not cancel out into a green run.
MUTATIONS.push({
	name: 'PAIR: both Auto Scan stepping faults together',
	harness: 'menu-check',
	edits: [...(MUTATIONS[3]?.edits ?? []), ...(MUTATIONS[5]?.edits ?? [])],
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
