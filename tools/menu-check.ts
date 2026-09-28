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

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createFlow } from '../src/game/flow'
import * as L from '../src/game/lines'
import { createScanner } from '../src/input/scanner'
import { createSwitchMachine } from '../src/input/switch'
import { AFTER_TOTAL_S, MAX_PLAY_S, MIN_PLAY_S, PRE_S } from '../src/render/draw'
import { createSim } from '../src/sim/physics'
import { createTTS } from '../src/speech/tts'
import {
	COURSES,
	DEFAULT_SETTINGS,
	HOLD_BEEP_STEP,
	HOLD_SHOW_MS,
	INPUT_COOLDOWN_MS,
	MAX_CUSTOM_HOLES,
	RETURN_HOLD_MS,
	SHAPE_ORDER,
	SHAPES,
} from '../src/tuning'
import type {
	CustomHole,
	HoleSpec,
	Renderer,
	SaveAPI,
	SaveData,
	ScanItem,
	Settings,
	SFX,
} from '../src/types'
import type { Hud, HudItemSpec } from '../src/ui/hud'

let failures = 0
// The bundle runs from node_modules/.cache; pnpm runs a script with the
// package root as cwd, so that is the only reliable anchor.
const REPO_ROOT = process.cwd()

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
		holdProgress() {},
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
			// Holding the flight open is how a real animation behaves for 3-8 s.
			// Resolving instantly made the in-flight state untestable, which is
			// why nothing caught that a short Enter did nothing there.
			if (holdFlight) {
				pendingDone = opts.onDone
				return
			}
			opts.onDone()
		},
		pause() {},
		resume() {},
		setTheme() {},
	}

	// Recording, not silent: the pancake's tap is a sound, so the check watches
	// what plays.
	// Set by a test that needs the flight to stay open; `pendingDone` resolves it.
	let clearedAll = false
	let holdFlight = false
	let pendingDone: (() => void) | null = null
	const played: string[] = []
	const sfx: SFX = {
		play(name: string) {
			played.push(name)
		},
		tone() {},
		holdBeep() {},
		setEnabled() {},
	}

	const save: SaveAPI = {
		load: () => stored,
		save(d) {
			stored = d
		},
		clearAll() {
			stored = { settings: { ...DEFAULT_SETTINGS } }
			clearedAll = true
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
		played,
		clearedAll: () => clearedAll,
		holdFlight: (on: boolean) => {
			holdFlight = on
		},
		endFlight: () => {
			pendingDone?.()
			pendingDone = null
		},
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

	// A confirm must be a separate act. A click that arms and a keypress a few ms
	// later slipped through both bounce guards, because they keep separate clocks.
	t.pickOverlay('new')
	check(
		'a second pick INSIDE the bounce window does not act',
		JSON.stringify(t.stored().round) === before,
		'that is a bounce, not a decision',
	)

	await sleep(INPUT_COOLDOWN_MS + 60)
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
	await sleep(INPUT_COOLDOWN_MS + 60)
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

	// The practice range is gameplay too, and it had no Menu row — the round
	// rack was the only list that did, so the check above passed while a
	// hold-free player had no pause in the mode most likely to be their first.
	// Checking one screen and generalising to "every screen" is what let that
	// sit; this asserts every gameplay list by name.
	const r = makeHarness({ ...BASE_SETTINGS })
	r.flow.start()
	r.pickList('practice')
	check(
		'the practice range has a scannable Menu row',
		r.listIds().includes('menu'),
		`range = [${r.listIds().join()}]`,
	)
	if (r.listIds().includes('menu')) {
		r.pickList('menu')
		check('picking it in the range opens the menu without any hold', r.hud.overlayOpen())
	} else {
		check('picking it in the range opens the menu without any hold', false, 'no Menu row')
	}
}

// ---------- 3c. deleting a hole someone built is two-step ----------

const deleteChecks = async () => {
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
			'a second Delete inside the bounce window does not delete',
			(t.stored().customHoles ?? []).length === 1,
			'that is a bounce, not a decision',
		)
		await sleep(INPUT_COOLDOWN_MS + 60)
		// Guarded: if the bounce guard above is broken the hole is already gone
		// and the row with it, and picking a row that is not there throws — which
		// aborts the run and swallows every check after this one.
		if (t.listIds().includes('delete')) {
			t.pickList('delete')
			check(
				'a second pick DOES delete it',
				(t.stored().customHoles ?? []).length === 0,
				`${(t.stored().customHoles ?? []).length} left`,
			)
		} else {
			check(
				'a second pick DOES delete it',
				false,
				`no Delete row left to pick — list = [${t.listIds().join()}]`,
			)
		}
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
// Chromium does exactly that: onstart arrives and onend never does, and Chrome
// has a long-standing bug for long utterances. Without the watchdog the hold
// never drops and a hands-free player is stranded on one item for good.
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

// ---------- 4b. Auto Scan wraps without a silent step ----------

// The wrap deadzone is deliberate under a deliberate press and deliberately
// SKIPPED under Auto Scan: an automatic timer landing on a slot where nothing
// is focused and Enter does nothing reads as the app having died, and Enter is
// the whole interface for a one-switch player. Both harnesses were blind to
// this until a mutation that made Auto Scan step into the deadzone left the
// entire suite green.
const autoWrapChecks = async () => {
	const sc = createScanner()
	const log: number[] = []
	sc.onFocus((_i, idx) => log.push(idx))
	sc.setItems([
		{ id: 'a', label: 'A', speak: 'A' },
		{ id: 'b', label: 'B', speak: 'B' },
		{ id: 'c', label: 'C', speak: 'C' },
	])
	sc.setScanMs(30)
	sc.setAutoScan(true)
	await sleep(30 * 6 + 40)
	sc.setAutoScan(false)
	// snapshot BEFORE clear(): clear() legitimately fires (null, -1) to blank the
	// footer, and letting that land in the log would mask the very thing checked
	const seen = log.slice()
	sc.clear()
	check(
		'Auto Scan never focuses the wrap deadzone',
		seen.length > 3 && !seen.includes(-1),
		`focus order = [${seen.join()}]`,
	)
	check(
		'Auto Scan wraps from the last item straight to the first',
		seen.join(',').includes('2,0'),
		`focus order = [${seen.join()}]`,
	)

	// ...and a deliberate press still gets the beat to reconsider.
	const sc2 = createScanner()
	const log2: number[] = []
	sc2.onFocus((_i, idx) => log2.push(idx))
	sc2.setItems([
		{ id: 'a', label: 'A', speak: 'A' },
		{ id: 'b', label: 'B', speak: 'B' },
	])
	sc2.handle('next')
	sc2.handle('next')
	const seen2 = log2.slice() // same reason
	sc2.clear()
	check(
		'a deliberate press still lands on the deadzone before wrapping',
		seen2.includes(-1),
		`focus order = [${seen2.join()}]`,
	)
}

// ---------- 4c. a pointer select obeys the same 250 ms bounce window ----------

// §4 of the hub contract puts the debounce on EVERY input, not just the keys:
// "You do not need to write your own debounce, and you should not". A switch
// wired to a mouse button, and a head-tracker's dwell, both arrive here.
interface FakeEl {
	click: () => void
	style: { setProperty: () => void; removeProperty: () => void }
	setAttribute: () => void
	removeAttribute: () => void
	addEventListener: (type: string, fn: () => void) => void
	removeEventListener: () => void
	parentElement: { setAttribute: () => void }
	scrollIntoView: () => void
}

const fakeEl = (): FakeEl => {
	const handlers: Record<string, () => void> = {}
	return {
		click: () => handlers.click?.(),
		style: { setProperty: () => {}, removeProperty: () => {} },
		setAttribute: () => {},
		removeAttribute: () => {},
		addEventListener: (type, fn) => {
			handlers[type] = fn
		},
		removeEventListener: () => {},
		parentElement: { setAttribute: () => {} },
		scrollIntoView: () => {},
	}
}

const pointerBounceChecks = async () => {
	const sc = createScanner()
	const picked: number[] = []
	sc.onSelect((_i, idx) => picked.push(idx))
	const els = [fakeEl(), fakeEl()]
	sc.setItems(
		els.map((el, i) => ({
			id: `i${i}`,
			label: `I${i}`,
			speak: `I${i}`,
			el: el as unknown as HTMLElement,
		})),
	)
	els[0]?.click()
	els[1]?.click()
	check(
		'a second click inside the bounce window does not select',
		picked.length === 1,
		`selected [${picked.join()}]`,
	)
	await sleep(INPUT_COOLDOWN_MS + 60)
	els[1]?.click()
	check(
		'a click after the window selects normally',
		picked.length === 2 && picked[1] === 1,
		`selected [${picked.join()}]`,
	)
	sc.clear()
}

// ---------- 4d. the shot-deciding number is heard before the scan moves on ----------

// §9: a focus label "is read aloud at every scan step, and at a 1 s scan speed
// a long label becomes a drone". These labels run 4-10 s and do NOT hold the
// scan timer, so whatever comes after the first couple of seconds is not heard
// by an auto-scanning player. The yardage decides the shot, so it has to be in
// that window; the shape blurb does not and can be cut off.
// ---------- confirm dialogs take §10's shape ----------
// §10: a confirm sits behind "Cancel first in the scan order and the scan
// trapped in the dialog". These confirms used to leave the whole menu on
// screen with the cancel route LAST, which is the wrong way round for a
// scanning player: over-scanning by one landed on the destructive answer, and
// wrapping reached it from the other side too.
const confirmShapeChecks = async () => {
	const t = makeHarness({ ...BASE_SETTINGS }, [
		{ name: 'My Hole 1', params: { length: 1, hills: 0, water: 0, sand: 0, wind: 2 } },
	])
	t.flow.start()
	t.pickList('play')
	t.pickList('myholes')
	t.pickList('hole-0')
	t.pickList('delete')
	const ids = t.listIds()
	check(
		'armed delete: the scan is trapped between exactly two answers',
		ids.length === 2,
		`list = [${ids.join()}]`,
	)
	check(
		'armed delete: cancel is FIRST in the scan order',
		ids[0] === 'back',
		`list = [${ids.join()}]`,
	)
	check(
		'armed delete: the destructive answer is second',
		ids[1] === 'delete',
		`list = [${ids.join()}]`,
	)
	check(
		'armed delete: the cancel row is worded as an answer, not "Back"',
		t.listLabels()[0] === L.MENU.cancel,
		t.listLabels().join(' | '),
	)
	check(
		'armed delete: focus opens on the cancel row',
		t.scanner.focusIndex() === 0,
		`focus = ${t.scanner.focusIndex()}`,
	)
	check(
		'armed delete: cancelling leaves the hole alone',
		(() => {
			t.pickList('back')
			return (t.stored().customHoles ?? []).length === 1
		})(),
		'cancel must not delete',
	)

	// the pause menu's two destructive rows take the same shape
	const t2 = makeHarness({ ...BASE_SETTINGS })
	t2.flow.start()
	t2.pickList('play')
	t2.pickList('course-0')
	t2.flow.onSwitch('menu')
	t2.pickOverlay('new')
	const nIds = t2.overlayIds()
	check(
		'armed New round: the scan is trapped between exactly two answers',
		nIds.length === 2,
		`overlay = [${nIds.join()}]`,
	)
	check(
		'armed New round: cancel is FIRST in the scan order',
		nIds[0] === 'resume',
		`overlay = [${nIds.join()}]`,
	)
	check(
		'armed New round: the destructive answer is second',
		nIds[1] === 'new',
		`overlay = [${nIds.join()}]`,
	)
}

// ---------- Settings is reachable during the flight animation (§10) ----------
// §10 wants Settings from BOTH the main menu and the pause menu. It was
// dropped in flight because there was no route back out of it; the row is
// worthless if selecting it strands the player, so both halves are checked.
const settingsInFlightChecks = async () => {
	const t = makeHarness(BASE_SETTINGS)
	t.flow.start()
	for (let i = 0; i < 40 && t.listIds()[t.scanner.focusIndex()] !== 'play'; i++)
		t.scanner.handle('next')
	t.scanner.handle('select')
	await sleep(INPUT_COOLDOWN_MS + 20)
	t.scanner.handle('select') // first course
	await sleep(INPUT_COOLDOWN_MS + 20)
	t.holdFlight(true)
	for (let i = 0; i < 40 && t.listIds()[t.scanner.focusIndex()] !== 'cube'; i++)
		t.scanner.handle('next')
	t.scanner.handle('select')
	await sleep(INPUT_COOLDOWN_MS + 20)
	t.flow.onSwitch('menu')
	const ids = t.overlayIds()
	check(
		'Settings is on the pause menu during flight',
		ids.includes('settings'),
		`overlay = [${ids.join()}]`,
	)
	if (ids.includes('settings')) {
		t.pickOverlay('settings')
		check(
			'picking it actually reaches Settings',
			t.listIds().includes('tts'),
			`list = [${t.listIds().join()}]`,
		)
		await sleep(INPUT_COOLDOWN_MS + 20)
		// Back out of Settings: it must land on the paused flight's menu, not on a
		// screen the flight has already left. A row that strands the player is
		// worse than no row, which is why the return route is asserted too.
		if (t.listIds().includes('back')) {
			t.pickList('back')
			check(
				'and Back returns to the paused flight menu, not a dead screen',
				t.overlayIds().includes('resume'),
				`overlay = [${t.overlayIds().join()}]`,
			)
		} else
			check('and Back returns to the paused flight menu, not a dead screen', false, 'no Back row')
	} else {
		check('picking it actually reaches Settings', false, 'no Settings row to pick')
		check('and Back returns to the paused flight menu, not a dead screen', false, 'never reached')
	}
	t.endFlight()
}

// ---------- the hold-progress gesture is measurable (§4) ----------
const holdProgressChecks = async () => {
	const emitted: string[] = []
	const m = createSwitchMachine((e) => emitted.push(e), { space: 120, return: 120 }, 0)
	check('heldFor is 0 before any press', m.heldFor('return') === 0, `${m.heldFor('return')}`)
	m.down('return')
	await sleep(60)
	const mid = m.heldFor('return')
	check('heldFor grows while the key is down', mid >= 40 && mid < 120, `${mid} ms`)
	m.up('return')
	check('heldFor is 0 again after release', m.heldFor('return') === 0, `${m.heldFor('return')}`)
	check(
		'the ring appears partway through, not at the first frame',
		HOLD_SHOW_MS > 0 && HOLD_SHOW_MS < RETURN_HOLD_MS,
		`show ${HOLD_SHOW_MS} of ${RETURN_HOLD_MS}`,
	)
	check(
		'the beep rises rather than repeating one pitch',
		HOLD_BEEP_STEP > 0,
		`step ${HOLD_BEEP_STEP} Hz`,
	)
}

const focusOrderChecks = () => {
	const WPM = 160 // conservative default rate for a system voice
	// Budgeted against the DEFAULT rung, not the fastest. At the 1 s rung
	// nothing useful fits — a name and a distance is ~1.9 s — and §9 says so
	// itself ("at a 1 s scan speed a long label becomes a drone"). Asserting
	// the impossible would just get the assertion weakened later. DESIGN.md
	// discloses the 1 s case in the departures table instead.
	const budgetWords = (DEFAULT_SETTINGS.scanMs / 1000 / 60) * WPM
	for (const id of SHAPE_ORDER) {
		const line = L.shapeFocus(id, 150)
		const blurb = SHAPES[id].blurb
		const end = line.indexOf('yards.')
		check(
			`${id}: the yardage is spoken before the blurb`,
			end !== -1 && end < line.indexOf(blurb),
			line,
		)
		const words = line.slice(0, end + 6).split(/\s+/).length
		check(
			`${id}: the yardage fits the default scan rung`,
			words <= budgetWords,
			`${words} words vs ~${budgetWords.toFixed(1)} at ${DEFAULT_SETTINGS.scanMs}ms/${WPM}wpm`,
		)
	}
}

// The course picker carries the same "number before flavour" rule as the shape
// rack and had the same defect. Nothing asserted it until now, so a later edit
// putting the blurb first would have shipped silently.
const courseFocusChecks = () => {
	for (const c of COURSES) {
		const withBest = L.courseFocus(c.name, c.blurb, 7)
		const noBest = L.courseFocus(c.name, c.blurb)
		check(
			`${c.name}: the best score is spoken before the blurb`,
			withBest.indexOf('7 shots') < withBest.indexOf(c.blurb),
			withBest,
		)
		check(`${c.name}: two-player focus states no best score`, !noBest.includes('best'), noBest)
	}
	// The cap is defined once, in tuning. This line used to hard-code "ten" and
	// would have started lying the moment the cap moved.
	check(
		'the full-book line names the real cap',
		L.BOOK_FULL.includes('ten') && MAX_CUSTOM_HOLES === 10,
		`${L.BOOK_FULL} (cap=${MAX_CUSTOM_HOLES})`,
	)
}

// Nothing was checking the spoken text for "1 shots in 1 holes", which a player
// hears after holing out in one on a saved single hole. Every count the game
// speaks gets checked at n=1, because 1 is the value every plural gets wrong and
// the one a harness driving a full round never produces.
const pluralChecks = () => {
	const one = L.summaryLine([1], [2])
	check('the round summary is grammatical at one shot', !/\b1 shots\b/.test(one), one)
	check('the round summary is grammatical at one hole', !/\b1 holes\b/.test(one), one)
	const many = L.summaryLine([3, 4], [2, 2])
	check('and still plural above one', /\b7 shots\b/.test(many) && /\b2 holes\b/.test(many), many)
	// The rest of the spoken surface, at 1, swept for the same shape.
	// summaryLine2 was missed the first time, eleven lines below the function
	// this check was written for, under a comment claiming every count was
	// covered. Two-player on a one-hole custom round reaches it.
	const atOne = [
		L.scoreLine(1, 3),
		L.summaryLine([1], [3]),
		L.summaryLine2(1, 1),
		L.summaryLine2(1, 3),
		L.summaryLine2(3, 1),
		L.holeIntro(COURSES[0]?.holes[0] as HoleSpec, 0),
	]
	for (const line of atOne) {
		// "Player 1 wins this one!" is a player number followed by a verb, not a
		// count followed by a plural. Exclude it rather than loosen the rule.
		check(
			'no "1 <word>s" anywhere in a line spoken at one',
			!/(?<!Player )\b1 \w+s\b/.test(line),
			line,
		)
	}
}

// A spoken line may only promise what the flow always does next. REST_LINE said
// "On to the next hole." and shipped in three cases where that is false: in
// two-player the next turn is the same hole, the last hole goes to a summary,
// and a custom round has one hole. String checks could not see it because the
// string was correct in isolation; what was wrong was the promise.
const forwardPromiseChecks = () => {
	const FORWARD = /next hole|go on to the next|on to the next/i
	// Lines spoken at a point where what comes next depends on state.
	const stateDependent: Array<[string, string]> = [
		['REST_LINE', L.REST_LINE],
		['the Scoring help page', L.helpPages()[3]?.speak ?? ''],
		['scoreLine', L.scoreLine(4, 3)],
		['summaryLine', L.summaryLine([3, 4], [3, 3])],
		['summaryLine2', L.summaryLine2(3, 4)],
	]
	for (const [name, line] of stateDependent) {
		check(`${name} does not promise a next hole`, line !== '' && !FORWARD.test(line), line)
	}
	// ...and the lines that DO announce the next state must still exist, or this
	// check is arguing for silence rather than accuracy.
	check(
		'the flow still announces whose turn and which hole',
		L.playerTurn(2).includes('Player 2') &&
			L.holeIntro(COURSES[0]?.holes[1] as HoleSpec, 1).includes('Hole 2'),
		`${L.playerTurn(2)} / ${L.holeIntro(COURSES[0]?.holes[1] as HoleSpec, 1)}`,
	)
}

// The flight-gap figure is on two public surfaces and had no generator. It was
// wrong for a whole round (3-6 s, taken from two constants without the two
// either side), then wrong again in a different way. This recomputes it from
// the four constants and holds both documents to the result.
const flightGapChecks = () => {
	const lo = (PRE_S + MIN_PLAY_S).toFixed(2)
	const hi = (PRE_S + MAX_PLAY_S + AFTER_TOTAL_S).toFixed(2)
	const noGlow = (PRE_S + MAX_PLAY_S).toFixed(2)
	const range = `${lo}-${hi}`
	for (const doc of ['README.md', 'DESIGN.md']) {
		const text = readFileSync(join(REPO_ROOT, doc), 'utf8')
		if (!/flight|animation runs|panel is gone/i.test(text)) continue
		check(
			`${doc} states the flight gap as ${range} s`,
			text.includes(range) || text.includes(range.replace('-', ' to ')),
			`expected ${range} from PRE_S+MIN_PLAY_S .. PRE_S+MAX_PLAY_S+AFTER_TOTAL_S`,
		)
	}
	const design = readFileSync(join(REPO_ROOT, 'DESIGN.md'), 'utf8')
	check(
		`DESIGN.md states the no-afterglow ceiling as ${noGlow} s`,
		design.includes(`${lo}-${noGlow}`),
		`expected ${lo}-${noGlow} for reduce-motion (no hole-out afterglow)`,
	)
}

// §12 asks for a pause a switch user can reach without a hold. During the flight
// animation the scan list is cleared, so a short Enter fell through to an empty
// scanner and did nothing: the 3 s hold and the pointer-only Pause button were
// the only routes, which §12 calls a locked door. One press now opens the menu.
const flightPauseChecks = async () => {
	const t = makeHarness(BASE_SETTINGS)
	t.flow.start()
	// title -> Play -> first course -> rack
	for (let i = 0; i < 40 && t.listIds()[t.scanner.focusIndex()] !== 'play'; i++)
		t.scanner.handle('next')
	t.scanner.handle('select')
	await sleep(INPUT_COOLDOWN_MS + 20)
	t.scanner.handle('select') // first course
	await sleep(INPUT_COOLDOWN_MS + 20)
	const rack = t.listIds()
	check('reached a shot rack', rack.includes('cube'), rack.join())
	// strike, which clears the scanner and starts the flight
	t.holdFlight(true)
	for (let i = 0; i < 40 && t.listIds()[t.scanner.focusIndex()] !== 'cube'; i++)
		t.scanner.handle('next')
	t.scanner.handle('select')
	await sleep(INPUT_COOLDOWN_MS + 20)
	// The scanner is what a switch talks to; the stub hud keeps its last list, so
	// assert the scanner's own state rather than the stub's bookkeeping.
	check(
		'the scanner is cleared during flight',
		t.scanner.focusIndex() === -1,
		`${t.scanner.focusIndex()}`,
	)
	// ONE press, not a hold
	t.flow.onSwitch('select')
	await sleep(30)
	check(
		'a single Enter opens the pause menu during flight',
		t.overlayIds().includes('resume'),
		t.overlayIds().join(),
	)
	t.holdFlight(false)
	t.endFlight()
}

// §10 asks for a two-step Reset Progress. This build had none at all — the row
// is new, and the two-step matters more here than anywhere: it is the only
// action in Settings that destroys a player's saved holes and best scores, and
// a mis-timed pick is the normal failure mode of scanning.
const resetProgressChecks = async () => {
	const t = makeHarness(BASE_SETTINGS)
	t.flow.start()
	for (let i = 0; i < 40 && t.listIds()[t.scanner.focusIndex()] !== 'settings'; i++)
		t.scanner.handle('next')
	t.scanner.handle('select')
	await sleep(INPUT_COOLDOWN_MS + 20)
	check('Settings has a Reset row', t.listIds().includes('reset'), t.listIds().join())
	check('the reset row is last before Back', t.listIds().at(-2) === 'reset', t.listIds().join())

	// One pick arms and destroys nothing.
	for (let i = 0; i < 40 && t.listIds()[t.scanner.focusIndex()] !== 'reset'; i++)
		t.scanner.handle('next')
	t.scanner.handle('select')
	check('one pick of Reset destroys nothing', !t.clearedAll(), 'cleared on the first pick')
	const armed = t.listSpecs().find((sp) => sp.id === 'reset')
	check('the armed reset row says so', armed?.label === L.MENU.resetArmed, armed?.label ?? '(gone)')
	check('the armed reset row holds the scan', armed?.hold === true, `${armed?.hold}`)

	// A second select INSIDE the cooldown is a bounce, not a decision. No sleep
	// here on purpose — sleeping first was the bug in the first version of this
	// check, and it reported a guard that was not there yet as working.
	t.scanner.handle('select')
	check('a bounce does not confirm the reset', !t.clearedAll(), 'cleared by a bounce')

	// A deliberate second pick does.
	await sleep(INPUT_COOLDOWN_MS + 20)
	for (let i = 0; i < 40 && t.listIds()[t.scanner.focusIndex()] !== 'reset'; i++)
		t.scanner.handle('next')
	t.scanner.handle('select')
	await sleep(INPUT_COOLDOWN_MS + 20)
	check('a second deliberate pick resets', t.clearedAll(), 'not cleared')
	check('reset returns to the title screen', t.listIds().includes('play'), t.listIds().join())
}

// ---------- 5a1. the published markdown actually renders ----------

// A GFM table ends at the first blank line. Inserting a paragraph between two
// rows silently drops every row after it — they render as literal pipe text.
// Nobody read the rendered output, because nothing rendered it.
const markdownChecks = () => {
	const docs = readdirSync(REPO_ROOT).filter((f) => f.endsWith('.md'))
	check('there are markdown documents to check', docs.length >= 2, docs.join(', '))
	// ...and at least one of them must actually contain a table, or every
	// per-file assertion below is vacuously true. README has none.
	const withTables = docs.filter((d) =>
		readFileSync(join(REPO_ROOT, d), 'utf8')
			.split('\n')
			.some((l) => l.trimStart().startsWith('|')),
	)
	check(
		'at least one document contains tables to check',
		withTables.length >= 1,
		withTables.join(', '),
	)
	for (const doc of docs) {
		const lines = readFileSync(join(REPO_ROOT, doc), 'utf8').split('\n')
		const runs: number[][] = []
		let cur: number[] = []
		lines.forEach((l, i) => {
			if (l.trimStart().startsWith('|')) cur.push(i + 1)
			else if (cur.length > 0) {
				runs.push(cur)
				cur = []
			}
		})
		if (cur.length > 0) runs.push(cur)
		const orphans = runs.filter((run) => {
			const second = lines[run[1]! - 1] ?? ''
			// a real table's second line is the delimiter row
			return !/^\s*\|[\s:|-]+\|\s*$/.test(second)
		})
		check(
			`${doc}: every table is one unbroken block`,
			orphans.length === 0,
			orphans.map((r) => `rows starting at line ${r[0]} have no delimiter row`).join('; '),
		)
	}
}

// DESIGN.md states a tally over the §10 checklist table, and a tally in prose
// beside a table it summarises is a number that drifts — this one has been
// wrong twice, once contradicting a paragraph 25 lines below it. The table is
// the source; this parses it and holds the sentence to it.
const checklistTallyChecks = () => {
	const doc = readFileSync(join(REPO_ROOT, 'DESIGN.md'), 'utf8')
	const section = doc.split('### §10, the shipping checklist')[1] ?? ''
	// Only the FIRST contiguous table in the section. Filtering the whole section
	// for pipe lines swept in the departures table below it and reported 25 rows.
	const lines = section.split('\n')
	const start = lines.findIndex((l) => l.startsWith('| §10 item'))
	const rows: string[] = []
	for (let i = start + 1; i < lines.length; i++) {
		const l = lines[i] ?? ''
		if (!l.startsWith('| ')) break
		if (l.startsWith('| ---')) continue
		rows.push(l)
	}
	const notMet = rows.filter((r) => r.includes('not met')).length
	const different = rows.filter(
		(r) => r.includes('different route') && !r.includes('not met'),
	).length
	const met = rows.length - notMet - different
	// A distinctive fragment of each §10 item, transcribed from the contract at
	// bennyshub/ACCESSIBILITY.md §10 (fetched 2026-08-26). This used to be
	// `rows.length === 18` under a label claiming it checked the contract items —
	// a reviewer replaced two real rows with "Free ice cream for every player",
	// kept the count at 18, and the harness certified the table. The label made a
	// claim the check did not test, in the repo whose own DESIGN.md section is
	// about exactly that.
	const CONTRACT_10 = [
		'Space and Enter only',
		'Enter alone',
		'fire on **release**',
		'Holding Space scans backwards',
		'Holding Enter opens pause',
		'on-screen Pause button',
		'Settings reachable from **both**',
		'Auto Scan and Scan Speed present',
		'TTS reads focus, selection and outcomes',
		'`SafeAudio`',
		'Reset Progress is two-step',
		'focusBackButton',
		'no interaction requires a drag',
		'spoken confirm dialog',
		'Progress saves and resumes',
		'Readable at 100 % on a tablet',
		'games.json',
		'one switch, by someone who is not you',
	]
	check('the §10 table has 18 rows', rows.length === CONTRACT_10.length, `${rows.length} rows`)
	for (const item of CONTRACT_10) {
		check(
			`§10 item present in the table: ${item.slice(0, 34)}`,
			rows.some((r) => r.includes(item)),
			'missing',
		)
	}
	// `met` is a residual (rows - notMet - different), so a row with no verdict
	// at all was silently counted as met. Every row must state one.
	const verdictless = rows.filter(
		(r) => !r.includes('not met') && !r.includes('different route') && !/\bmet\b/.test(r),
	)
	check('every §10 row states a verdict', verdictless.length === 0, verdictless.join(' | '))
	const stated = section.match(/\*\*(\d+) met, (\d+) met by a different route, (\d+) not met\*\*/)
	check('DESIGN.md states a §10 tally in the documented form', stated !== null, '')
	if (stated) {
		check(
			'the stated §10 tally matches the table it summarises',
			Number(stated[1]) === met && Number(stated[2]) === different && Number(stated[3]) === notMet,
			`states ${stated[1]}/${stated[2]}/${stated[3]}, table has ${met}/${different}/${notMet}`,
		)
	}
}

// (character layer removed: shapes have neutral names and blurbs only.)

const main = async () => {
	await latchChecks()
	await slowPickInsideMenuChecks()
	await autoScanMenuChecks()
	await confirmChecks()
	scannableMenuChecks()
	await deleteChecks()
	await exitConfirmChecks()
	await holdChecks()
	await autoWrapChecks()
	await pointerBounceChecks()
	await ttsHoldChecks()
	await watchdogChecks()
	settingsSpeechChecks()
	courseFocusChecks()
	pluralChecks()
	flightGapChecks()
	await flightPauseChecks()
	await resetProgressChecks()
	forwardPromiseChecks()
	markdownChecks()
	checklistTallyChecks()
	focusOrderChecks()
	await confirmShapeChecks()
	await settingsInFlightChecks()
	await holdProgressChecks()

	for (const [name, ok, detail] of results) {
		console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`)
	}
	console.log(`${results.length - failures}/${results.length} checks passed`)

	// A check that VANISHES is worse than one that always passes. A removed
	// check that is still expected takes the suite down with it, so the count
	// below is pinned deliberately.
	// Pinning the count is the general fix: any assertion that stops running
	// takes the suite down with it. Raise this deliberately when adding checks.
	const EXPECTED_CHECKS = 137
	if (results.length !== EXPECTED_CHECKS) {
		console.log(
			`menu-check: expected ${EXPECTED_CHECKS} checks, ran ${results.length}. A check that stops running is a check that stopped guarding something; find out which before changing this number.`,
		)
		process.exit(1)
	}
	process.exit(failures === 0 ? 0 : 1)
}

main()
