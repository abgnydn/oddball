// Headless check of the context menu, driven through the REAL switch machine,
// the REAL scanner and the REAL flow. Everything the player touches on that
// path is the shipped code; only the DOM-facing collaborators are faked.
//
// This harness exists because three input regressions shipped past four other
// harnesses: none of them imported flow.ts, so nothing could see that holding
// Enter opened the menu and the release immediately closed it again.
//
// Run:
//   pnpm exec esbuild tools/menu-check.ts --bundle --platform=node --format=esm \
//     --log-level=warning --outfile=node_modules/.cache/menu-check.mjs \
//   && node node_modules/.cache/menu-check.mjs

import { createFlow } from '../src/game/flow'
import * as L from '../src/game/lines'
import { createScanner } from '../src/input/scanner'
import { createSwitchMachine } from '../src/input/switch'
import { createSim } from '../src/sim/physics'
import { createTTS } from '../src/speech/tts'
import { SHAPE_ORDER } from '../src/tuning'
import type { CustomHole, Renderer, SaveAPI, SaveData, ScanItem, Settings, SFX } from '../src/types'
import type { Hud, HudItemSpec } from '../src/ui/hud'

let failures = 0
const results: Array<[string, boolean, string]> = []
const check = (name: string, ok: boolean, detail = '') => {
	results.push([name, ok, detail])
	if (!ok) failures++
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const BASE_SETTINGS: Settings = {
	ttsOn: false,
	ttsRate: 1,
	ttsVolume: 1,
	scanMs: 2000,
	fontScale: 100,
	theme: 'high-contrast',
	highlightThick: 'medium',
	audioCues: false,
	reduceMotion: true, // flights resolve instantly: no animation frames in node
	flightTone: false,
	dwell: 'off',
	autoScan: false,
}

// ---------- fakes for the DOM-facing collaborators only ----------

interface Harness {
	hud: Hud
	listIds: () => string[]
	overlayIds: () => string[]
	overlayLabels: () => string[]
	overlaySpecs: () => HudItemSpec[]
	listSpecs: () => HudItemSpec[]
	listLabels: () => string[]
	stored: () => SaveData
}

const makeHarness = (settings: Settings, customHoles?: CustomHole[]) => {
	let overlayShown = false
	let list: HudItemSpec[] = []
	let over: HudItemSpec[] = []
	let stored: SaveData = customHoles ? { settings, customHoles } : { settings }

	const toItems = (specs: HudItemSpec[]): ScanItem[] =>
		specs.map((s) => ({
			id: s.id,
			label: s.label,
			speak: s.speak,
			...(s.hold === true ? { hold: true } : {}),
		}))

	const hud: Hud = {
		canvas: null as unknown as HTMLCanvasElement,
		setScreen() {},
		setMode() {},
		onPause() {},
		scanList(items) {
			list = items
			return toItems(items)
		},
		showPanel() {},
		caption() {},
		footerFocus() {},
		overlay(items) {
			over = items
			overlayShown = true
			return toItems(items)
		},
		hideOverlay() {
			overlayShown = false
		},
		overlayOpen: () => overlayShown,
		applySettings() {},
	}

	const renderer: Renderer = {
		attach() {},
		resize() {},
		drawIdle() {},
		animateFlight(_hole, outcome, _shape, opts) {
			for (const e of outcome.events) opts.onEvent(e)
			opts.onDone()
		},
		pause() {},
		resume() {},
		setTheme() {},
	}

	const sfx: SFX = { play() {}, tone() {}, setEnabled() {} }

	const save: SaveAPI = {
		load: () => stored,
		save(d) {
			stored = d
		},
		clearRound() {
			const { round: _drop, ...rest } = stored
			stored = rest
		},
	}

	const tts = createTTS()
	tts.setEnabled(false) // no speechSynthesis in node; the [tts] log still fires

	const scanner = createScanner()
	const flow = createFlow({ hud, scanner, tts, sfx, renderer, sim: createSim(), save })
	const machine = createSwitchMachine(
		(e) => flow.onSwitch(e),
		{ space: 300, return: 40 },
		0,
		() => !hud.overlayOpen(), // same gate main.ts installs
	)

	const h: Harness = {
		hud,
		listIds: () => list.map((s) => s.id),
		overlayIds: () => over.map((s) => s.id),
		overlayLabels: () => over.map((s) => s.label),
		overlaySpecs: () => over,
		listSpecs: () => list,
		listLabels: () => list.map((s) => s.label),
		stored: () => stored,
	}

	/** Step the highlight onto `id` and select it, the way a player would. */
	const pick = (id: string, ids: () => string[]) => {
		for (let guard = 0; guard < 40; guard++) {
			const cur = ids()
			const want = cur.indexOf(id)
			if (want === -1) throw new Error(`no item "${id}" in [${cur.join()}]`)
			if (scanner.focusIndex() === want) {
				scanner.handle('select')
				return
			}
			scanner.handle('next')
		}
		throw new Error(`could not reach "${id}"`)
	}

	return {
		...h,
		flow,
		scanner,
		machine,
		pickList: (id: string) => pick(id, h.listIds),
		pickOverlay: (id: string) => pick(id, h.overlayIds),
	}
}

const over = (t: ReturnType<typeof makeHarness>, id: string) =>
	t.overlaySpecs().find((s) => s.id === id)

/** Start a 1P round and play one stroke, so there is progress worth losing.
 *  Asserts the stroke actually landed: an earlier version looked for a
 *  'shape-' prefix that does not exist, so every "the round survives" check
 *  compared the state at the tee against itself. */
const startRound = (t: ReturnType<typeof makeHarness>) => {
	t.flow.start()
	t.pickList('play')
	t.pickList('course-0')
	const shape = t.listIds().find((id) => (SHAPE_ORDER as readonly string[]).includes(id))
	if (shape === undefined) throw new Error(`no shape in rack [${t.listIds().join()}]`)
	t.pickList(shape)
	const strokes = t.stored().round?.strokes?.[0]?.[0]
	if (strokes !== 1) throw new Error(`stroke did not land: strokes[0][0]=${String(strokes)}`)
}

// ---------- 1. the menu latches ----------

const latchChecks = async () => {
	const t = makeHarness({ ...BASE_SETTINGS })
	startRound(t)

	t.machine.down('return')
	await sleep(70) // past the 40 ms menu threshold
	check('holding Enter opens the menu', t.hud.overlayOpen())
	t.machine.up('return')
	check(
		'the menu STAYS OPEN after the release that opened it',
		t.hud.overlayOpen(),
		'a select on that keyup closes the menu on the item it opened under',
	)

	// and a short press inside the menu still selects normally
	t.pickOverlay('resume')
	check('a short Enter inside the menu still selects', !t.hud.overlayOpen())
}

// A SLOW press inside an already-open menu is still a deliberate pick. It used
// to fire the menu gesture again, which toggled the menu shut and consumed the
// release — the same failure as the opening press, one path further in.
const slowPickInsideMenuChecks = async () => {
	const t = makeHarness({ ...BASE_SETTINGS })
	startRound(t)
	t.machine.down('return')
	await sleep(70)
	t.machine.up('return') // menu opens and latches
	// walk to Settings, then pick it with a press far longer than the threshold
	while (t.overlayIds()[t.scanner.focusIndex()] !== 'settings') t.scanner.handle('next')
	t.machine.down('return')
	await sleep(120) // well past the 40 ms menu threshold
	t.machine.up('return')
	check(
		'a slow pick inside the open menu still selects it',
		!t.hud.overlayOpen() && t.listIds().includes('tts'),
		`overlayOpen=${t.hud.overlayOpen()} list=[${t.listIds().join()}]`,
	)
}

// ---------- 2. Auto Scan cannot pick a menu item on the opening release ----

const autoScanMenuChecks = async () => {
	const t = makeHarness({ ...BASE_SETTINGS, autoScan: true, scanMs: 50 })
	startRound(t)
	const before = JSON.stringify(t.stored().round)

	t.machine.down('return')
	// Hold until Auto Scan has walked the overlay onto the most destructive item.
	// An earlier version just slept 300 ms and happened to land on the wrap
	// deadzone, where select is a no-op — so the check passed even with the fix
	// removed. Release on a NAMED item or the test proves nothing.
	let walkedTo = ''
	for (let i = 0; i < 200 && walkedTo !== 'new'; i++) {
		await sleep(25)
		walkedTo = t.overlayIds()[t.scanner.focusIndex()] ?? ''
	}
	check(
		'Auto Scan walks the open menu onto New round (one-switch users need it to)',
		walkedTo === 'new',
		`stopped at "${walkedTo}"`,
	)
	t.machine.up('return')

	check('a long Enter with Auto Scan on selects nothing on release', t.hud.overlayOpen())
	check(
		'the round in progress survives a long Enter with Auto Scan on',
		JSON.stringify(t.stored().round) === before,
		`before=${before} after=${JSON.stringify(t.stored().round)}`,
	)
}

// ---------- 3. the destructive items are two-step ----------

const confirmChecks = async () => {
	const t = makeHarness({ ...BASE_SETTINGS })
	startRound(t)
	const before = JSON.stringify(t.stored().round)

	t.machine.down('return')
	await sleep(70)
	t.machine.up('return')

	t.pickOverlay('new')
	check('one pick of New round does NOT start over', JSON.stringify(t.stored().round) === before)
	check('the menu stays open, armed', t.hud.overlayOpen())
	check(
		'New round re-labels itself once armed',
		t.overlayLabels().includes(L.MENU.newRoundArmed) &&
			!t.overlayLabels().includes(L.MENU.newRound),
		t.overlayLabels().join(' | '),
	)

	check(
		'the armed New round warning holds the scan',
		over(t, 'new')?.hold === true,
		'an unspoken warning is no warning at all',
	)

	t.pickOverlay('new')
	check(
		'a second pick of New round DOES start over',
		JSON.stringify(t.stored().round) !== before,
		`still ${JSON.stringify(t.stored().round)}`,
	)
}

const exitConfirmChecks = async () => {
	const t = makeHarness({ ...BASE_SETTINGS })
	startRound(t)

	t.machine.down('return')
	await sleep(70)
	t.machine.up('return')

	t.pickOverlay('exit')
	check('one pick of Exit does not leave the round', t.hud.overlayOpen())
	check(
		'Exit re-labels itself once armed',
		t.overlayLabels().includes(L.MENU.exitArmed) && !t.overlayLabels().includes(L.MENU.exit),
		t.overlayLabels().join(' | '),
	)
	check(
		'the armed Exit warning holds the scan',
		over(t, 'exit')?.hold === true,
		'an unspoken warning is no warning at all',
	)
	t.pickOverlay('exit')
	check('a second pick of Exit leaves', !t.hud.overlayOpen())
}

// ---------- 3b. a switch user can reach the menu without a hold ----------

const scannableMenuChecks = () => {
	const t = makeHarness({ ...BASE_SETTINGS })
	startRound(t)
	check(
		'the rack has a scannable Menu row',
		t.listIds().includes('menu'),
		`rack = [${t.listIds().join()}]`,
	)
	if (t.listIds().includes('menu')) {
		t.pickList('menu')
		check('picking it opens the menu without any hold', t.hud.overlayOpen())
	} else check('picking it opens the menu without any hold', false, 'no Menu row to pick')
}

// ---------- 3c. deleting a hole someone built is two-step ----------

const deleteChecks = () => {
	const t = makeHarness({ ...BASE_SETTINGS }, [
		{ name: 'My Hole 1', params: { length: 1, hills: 0, water: 0, sand: 0, wind: 2 } },
	])
	t.flow.start()
	t.pickList('play')
	t.pickList('myholes')
	t.pickList('hole-0')
	t.pickList('delete')
	check(
		'one pick of Delete does NOT delete the hole',
		(t.stored().customHoles ?? []).length === 1,
		`${(t.stored().customHoles ?? []).length} left`,
	)
	const armed = t.listIds().includes('delete')
	check('Delete stays on screen, armed', armed, `list = [${t.listIds().join()}]`)
	check(
		'the armed Delete warning holds the scan',
		t.listSpecs().find((s) => s.id === 'delete')?.hold === true,
		'an unspoken warning is no warning at all',
	)
	check(
		'the armed Delete label is the armed one',
		t.listLabels().includes(L.MENU.deleteArmed),
		t.listLabels().join(' | '),
	)
	if (armed) {
		t.pickList('delete')
		check(
			'a second pick DOES delete it',
			(t.stored().customHoles ?? []).length === 0,
			`${(t.stored().customHoles ?? []).length} left`,
		)
	} else check('a second pick DOES delete it', false, 'never reached — it was already gone')
}

// ---------- 4. Auto Scan waits for narration ----------

const holdChecks = async () => {
	const sc = createScanner()
	const focusLog: number[] = []
	sc.onFocus((_i, idx) => focusLog.push(idx))
	sc.setItems([
		{ id: 'a', label: 'A', speak: 'A' },
		{ id: 'b', label: 'B', speak: 'B' },
		{ id: 'c', label: 'C', speak: 'C' },
	])
	sc.setScanMs(40)
	sc.setAutoScan(true)
	sc.setAutoHold(true)
	const atHold = focusLog.length
	await sleep(160)
	check('Auto Scan does not step while narration holds it', focusLog.length === atHold)
	sc.setAutoHold(false)
	await sleep(120)
	check('Auto Scan resumes when the narration ends', focusLog.length > atHold)
	sc.clear()
}

// TTS must raise the hold for narration and NOT for the per-item focus label.
const ttsHoldChecks = async () => {
	interface FakeUtterance {
		text: string
		onstart?: () => void
		onend?: () => void
		onerror?: () => void
	}
	const live: FakeUtterance[] = []
	const g = globalThis as Record<string, unknown>
	g.SpeechSynthesisUtterance = class {
		text: string
		rate = 1
		volume = 1
		onstart?: () => void
		onend?: () => void
		onerror?: () => void
		constructor(text: string) {
			this.text = text
		}
	}
	g.speechSynthesis = {
		speak(u: FakeUtterance) {
			live.push(u)
		},
		cancel() {
			const u = live.pop()
			u?.onend?.()
		},
		resume() {},
	}

	const tts = createTTS()
	const holds: boolean[] = []
	tts.onHoldChange((on) => holds.push(on))

	tts.speak('A hole intro, which is long.')
	check('narration raises the scan hold', holds.join() === 'true', holds.join())
	live.at(-1)?.onend?.()
	check('the hold drops when narration ends', holds.join() === 'true,false', holds.join())

	holds.length = 0
	tts.speak('Play.', { hold: false })
	check(
		'the per-item focus label does NOT hold the scan',
		holds.length === 0,
		'holding on focus labels would make speech, not the player, set the scan rate',
	)

	g.speechSynthesis = undefined
	g.SpeechSynthesisUtterance = undefined
}

// A browser can accept an utterance and never report that it ENDED. Headless
// Chromium does exactly that: onstart arrives (measured between 8 and 33 ms
// across runs) and onend never does, and Chrome has a long-standing bug for
// long utterances. Without the watchdog the hold never drops and a hands-free
// player is stranded on one item for good.
const watchdogChecks = async () => {
	const g = globalThis as Record<string, unknown>
	g.SpeechSynthesisUtterance = class {
		text: string
		rate = 1
		volume = 1
		constructor(text: string) {
			this.text = text
		}
	}
	g.speechSynthesis = { speak() {}, cancel() {}, resume() {} } // never fires anything

	const tts = createTTS()
	tts.setRate(2) // shortens the watchdog estimate; the mechanism is the same
	const holds: boolean[] = []
	tts.onHoldChange((on) => holds.push(on))
	tts.speak('Hi')
	check('a stalled utterance still raises the hold', holds.join() === 'true', holds.join())
	await sleep(1500)
	check(
		'the watchdog drops a hold whose utterance never ends',
		holds.join() === 'true,false',
		`holds=[${holds.join()}] — without this the player is stranded`,
	)

	g.speechSynthesis = undefined
	g.SpeechSynthesisUtterance = undefined
}

// A settings row that explains the ON behaviour while reading "off" tells a
// caregiver the opposite of what they just did. This shipped once on Auto scan,
// which is the control-scheme selector — the row it matters most on.
const settingsSpeechChecks = () => {
	const say = (id: string, v: string) => L.settingValueSpeak[id]?.(v) ?? ''
	const cases: Array<[string, string, string, string]> = [
		// id, on-value, off-value, phrase that may only appear in the ON reading
		['auto', 'on — one switch', 'off — two switches', 'light moves by itself'],
		['tone', 'on', 'off', 'sings higher'],
		['dwell', 'slow', 'off', 'hold still to choose'],
	]
	for (const [id, onV, offV, onlyWhenOn] of cases) {
		const on = say(id, onV)
		const off = say(id, offV)
		check(`${id}: the on reading explains what on does`, on.includes(onlyWhenOn), on)
		check(
			`${id}: the off reading does NOT describe the on behaviour`,
			!off.includes(onlyWhenOn),
			off,
		)
		check(
			`${id}: both readings name their own value`,
			on.includes(onV) && off.includes(offV),
			`${on} / ${off}`,
		)
	}
}

const main = async () => {
	await latchChecks()
	await slowPickInsideMenuChecks()
	await autoScanMenuChecks()
	await confirmChecks()
	scannableMenuChecks()
	deleteChecks()
	await exitConfirmChecks()
	await holdChecks()
	await ttsHoldChecks()
	await watchdogChecks()
	settingsSpeechChecks()

	for (const [name, ok, detail] of results) {
		console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`)
	}
	console.log(`${results.length - failures}/${results.length} checks passed`)
	process.exit(failures === 0 ? 0 : 1)
}

main()
