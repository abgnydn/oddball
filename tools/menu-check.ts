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
import { createSim } from '../src/sim/physics'
import { createTTS } from '../src/speech/tts'
import {
	COURSES,
	DEFAULT_SETTINGS,
	INPUT_COOLDOWN_MS,
	MAX_CUSTOM_HOLES,
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
	StrikeOutcome,
} from '../src/types'
import type { Hud, HudItemSpec } from '../src/ui/hud'

let failures = 0
// The bundle runs from node_modules/.cache; pnpm runs a script with the
// package root as cwd, so that is the only reliable anchor.
const REPO_ROOT = process.cwd()
const SRC = join(REPO_ROOT, 'src')

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
	characters: false, // the shipped default; the cast layer is opt-in
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

	// Recording, not silent: Penny's tap is a cast element delivered as a SOUND,
	// so the only way to assert it follows the setting is to watch what plays.
	const played: string[] = []
	const sfx: SFX = {
		play(name: string) {
			played.push(name)
		},
		tone() {},
		setEnabled() {},
	}

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
		played,
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
		['characters', 'on', 'off', 'a name and a story'],
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
// that window; the character blurb does not and can be cut off.
const focusOrderChecks = () => {
	const WPM = 160 // conservative default rate for a system voice
	// Budgeted against the DEFAULT rung, not the fastest. At the 1 s rung
	// nothing useful fits — a name and a distance is ~1.9 s — and §9 says so
	// itself ("at a 1 s scan speed a long label becomes a drone"). Asserting
	// the impossible would just get the assertion weakened later. DESIGN.md
	// discloses the 1 s case in the departures table instead.
	const budgetWords = (DEFAULT_SETTINGS.scanMs / 1000 / 60) * WPM
	// Both cast modes, because the plain names are LONGER than the character
	// names ("The pancake" vs "Penny") and the default mode is the plain one.
	for (const characters of [false, true]) {
		const mode = characters ? 'characters on' : 'characters off'
		for (const id of SHAPE_ORDER) {
			const line = L.shapeFocus(id, 150, characters)
			const blurb = characters ? SHAPES[id].blurb : SHAPES[id].plainBlurb
			const end = line.indexOf('yards.')
			check(
				`${id} (${mode}): the yardage is spoken before the blurb`,
				end !== -1 && end < line.indexOf(blurb),
				line,
			)
			const words = line.slice(0, end + 6).split(/\s+/).length
			check(
				`${id} (${mode}): the yardage fits the default scan rung`,
				words <= budgetWords,
				`${words} words vs ~${budgetWords.toFixed(1)} at ${DEFAULT_SETTINGS.scanMs}ms/${WPM}wpm`,
			)
		}
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
		['the Scoring help page', L.helpPages(false)[3]?.speak ?? ''],
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

// ---------- 5a1. the published markdown actually renders ----------

// A GFM table ends at the first blank line. Inserting a paragraph between two
// rows silently drops every row after it — they render as literal pipe text.
// That shipped in CAST.md: half the cast table, in the file the README points
// at, on the page that argues the layer was written carefully. Nobody read the
// rendered output, because nothing rendered it.
const markdownChecks = () => {
	const docs = readdirSync(REPO_ROOT).filter((f) => f.endsWith('.md'))
	check('there are markdown documents to check', docs.length >= 3, docs.join(', '))
	// ...and at least one of them must actually contain a table, or every
	// per-file assertion below is vacuously true. README has none.
	const withTables = docs.filter((d) =>
		readFileSync(join(REPO_ROOT, d), 'utf8')
			.split('\n')
			.some((l) => l.trimStart().startsWith('|')),
	)
	check(
		'at least two documents contain tables to check',
		withTables.length >= 2,
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

// CAST.md reprints all six blurbs verbatim, and a hand-copied string is a
// string that drifts. Every round so far a lens has had to check these by hand;
// this makes the file hold itself to the code.
const HOLED_FLAVOR_TEXT: Partial<Record<string, string>> = Object.fromEntries(
	SHAPE_ORDER.map((id) => {
		const holed: StrikeOutcome = {
			points: [],
			events: [],
			end: { x: 100, lie: 'green' },
			holed: true,
			water: false,
			carry: 100,
			total: 100,
		}
		const line = L.narrate(holed, id, COURSES[0]?.holes[0] as HoleSpec, true)
		return [id, line.replace(/^In the cup!\s*/, '')]
	}),
)

const castDocQuoteChecks = () => {
	const doc = readFileSync(join(REPO_ROOT, 'CAST.md'), 'utf8')
	const section = doc.split('## Rack blurbs')[1]?.split('\n## ')[0] ?? ''
	const quoted = [...section.matchAll(/^- \w+: "(.+)"$/gm)].map((m) => m[1] as string)
	check('CAST.md reprints all six blurbs', quoted.length === SHAPE_ORDER.length, `${quoted.length}`)

	// The WHOLE file, not just the blurb list. The narrator's hole-out line was
	// quoted in "Narration rules" with a clause the code had dropped — the third
	// time that exact sentence came back, and the section check could not see it
	// because it was scoped to "## Rack blurbs". Any quoted string in CAST.md
	// that starts like a shipped cup line must BE the shipped cup line.
	const allQuotes = [...doc.matchAll(/"([^"\n]{12,})"/g)].map((m) => m[1] as string)
	// One assertion per shape, ALWAYS. The previous version only fired when a
	// quote shared 15+ characters and half the shipped line — so growing the
	// shipped line dropped the assertion instead of failing it, and a reviewer
	// put a narrator gloss back into Penny's cup line with the suite green at
	// 190/190. A check that can decline to run is not a check.
	//
	// The rule is narrow on purpose: CAST.md must contain no quote that EXTENDS
	// a shipped cup line. That is exactly the drift that happened twice — "Penny
	// taps once." became "Penny taps once. That means yes." — and it does not
	// fire on "Brick is deaf", which is a fragment of a blurb rather than an
	// extension of a cup line.
	for (const id of SHAPE_ORDER) {
		const shipped = HOLED_FLAVOR_TEXT[id] ?? ''
		// BOTH directions. The doc growing past the code is one drift; the code
		// growing past the doc is the other, and it is the one that actually
		// happened — a reviewer lengthened HOLED_FLAVOR and CAST.md's shorter
		// quote stopped matching while the first version of this rule, which
		// only looked for a longer quote, stayed green.
		const drifted = allQuotes.filter(
			(q) =>
				q !== shipped && (q.startsWith(shipped.slice(0, -1)) || shipped.startsWith(q.slice(0, -1))),
		)
		check(
			`CAST.md's quote of ${id}'s cup line matches the code`,
			shipped !== '' && drifted.length === 0,
			`${drifted.join(' | ')} (shipped: ${shipped})`,
		)
	}
	for (const id of SHAPE_ORDER) {
		check(
			`${id}: CAST.md's blurb is byte-identical to tuning.ts`,
			quoted.includes(SHAPES[id].blurb),
			SHAPES[id].blurb,
		)
	}
}

// ---------- 5a2. no ungated reader of a cast string ----------

// This one reads the SOURCE, not the behaviour, and it exists because the
// behavioural checks below could not have caught what they were written for.
// The cast setting shipped with two ungated readers — `rangeNarrate` (the
// practice range, the mode most likely to be a first screen) and a
// module-level `HELP_PAGES` const that spoke "Brick is deaf" to players who
// had the layer off. Both were invisible here because a behavioural check can
// only test the call sites its author remembered, and the whole failure was
// forgetting two. A grep cannot forget.
//
// The rule: `.name` and `.blurb` on a SHAPES entry are the cast strings, and
// the ONLY code allowed to read them is the two accessors that take the
// setting. Anything else must go through shapeName()/shapeBlurb(). Adding a
// reader is fine — gate it, or add it to ALLOWED deliberately and say why.
const castSourceChecks = () => {
	const ALLOWED = new Set([
		'characters ? SHAPES[id].name : SHAPES[id].plainName',
		'characters ? SHAPES[id].blurb : SHAPES[id].plainBlurb',
	])
	// EVERY .ts under src/, walked recursively. It used to be src/game/*.ts plus
	// two files, while three documents said it greps "src/" — so render/draw.ts,
	// which already draws each shape's glyph and is the obvious home for a
	// painted label, was outside it. The argument for this check is that a grep
	// cannot forget; a hand-listed subset can.
	const walk = (dir: string): string[] =>
		readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
			e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : [],
		)
	const files = walk(SRC)
	const leaks: string[] = []
	for (const file of files) {
		const lines = readFileSync(file, 'utf8').split('\n')
		lines.forEach((line, i) => {
			// both access syntaxes: SHAPES[id].name and SHAPES.sphere.name.
			// The first version of this check only had the bracket form, which
			// is exactly how the HELP_PAGES leak survived a grep.
			if (!/SHAPES(\[[^\]]+\]|\.\w+)\.(name|blurb)\b/.test(line)) return
			if ([...ALLOWED].some((a) => line.includes(a))) return
			leaks.push(`${file.replace(SRC, 'src')}:${i + 1}: ${line.trim()}`)
		})
	}
	check(
		'no code outside shapeName()/shapeBlurb() reads a cast string',
		leaks.length === 0,
		leaks.join(' | '),
	)
	check(
		'the source check actually walked the whole tree',
		files.length >= 12 &&
			files.some((f) => f.includes('render/')) &&
			files.some((f) => f.includes('input/')),
		`${files.length} files scanned`,
	)

	// Reading a cast string is not the only way to speak one. The third and
	// fourth leaks found in this file were literals: a menu row that said
	// "meet the team" in both modes, and a help line that called the shapes
	// "friends". A name-reader check is structurally blind to a typed-out
	// phrase, so the phrases get their own list.
	const CAST_PHRASES = [/meet the team/i, /\bfriends?\b/i]
	// "Play with a friend" is the two-player mode. It is a person, not a shape.
	const PHRASE_ALLOWED = [/play with a friend/i, /friendly/i]
	const phraseLeaks: string[] = []
	for (const file of files) {
		readFileSync(file, 'utf8')
			.split('\n')
			.forEach((line, i) => {
				const t = line.trim()
				if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return
				if (t.includes('characters')) return
				// Only what is inside a quote can be spoken. Without this the check
				// fires on `id === 'friend'`, which is a mode id in a switch.
				const literals = line.match(/'[^']*'|"[^"]*"|`[^`]*`/g) ?? []
				for (const lit of literals) {
					if (lit.length < 12) continue // an id, not a sentence
					if (!CAST_PHRASES.some((r) => r.test(lit))) continue
					if (PHRASE_ALLOWED.some((r) => r.test(lit))) continue
					phraseLeaks.push(`${file.replace(SRC, 'src')}:${i + 1}: ${lit}`)
				}
			})
	}
	check(
		'no ungated cast phrase in a player-facing string',
		phraseLeaks.length === 0,
		phraseLeaks.join(' | '),
	)
	// ...and the check is worthless if the accessors moved, so prove it can see them.
	const seen = readFileSync(join(SRC, 'game', 'lines.ts'), 'utf8')
	check(
		'the two allowed readers are still present (this check is not vacuous)',
		[...ALLOWED].every((a) => seen.includes(a)),
		'shapeName/shapeBlurb no longer match the allowlist',
	)
}

// Two cast elements that are NOT strings, so neither grep above can see them.
// The tap is a sound effect and a tap-bounce animation; it fired with the cast
// layer off, and it was found by reading the code rather than by any check.
const castNonTextChecks = () => {
	// Source-level, like the cast greps, because the behavioural route needs a
	// pancake to hole out and a check that only asserts "no tap yet" is true for
	// the wrong reason. Both non-text cast elements must sit behind the setting.
	const flowSrc = readFileSync(join(SRC, 'game', 'flow.ts'), 'utf8')
	const tapLine = flowSrc.split('\n').find((l) => l.includes("sfx.play('tap')")) ?? ''
	check(
		"Penny's tap sound is behind the cast setting",
		tapLine.includes('settings.characters'),
		tapLine.trim() || '(no tap call found)',
	)
	const drawSrc = readFileSync(join(SRC, 'render', 'draw.ts'), 'utf8')
	const hopLine = drawSrc.split('\n').find((l) => l.includes("s.shape === 'pancake'")) ?? ''
	check(
		"Penny's tap-bounce is behind the cast setting",
		hopLine.includes('charactersNow()'),
		hopLine.trim() || '(no tap-bounce found)',
	)
	// ...and the grep is worthless if the call moved, so prove both were found.
	check(
		'both non-text cast elements were located in the source',
		tapLine !== '' && hopLine !== '',
		`tap=${tapLine !== ''} hop=${hopLine !== ''}`,
	)
	// The narrator's hole-out line for Penny must not translate the tap. It used
	// to say "That means yes." — a hearing player being told what a nonspeaking
	// character's single output means.
	const holedOut: StrikeOutcome = {
		points: [],
		events: [],
		end: { x: 100, lie: 'green' },
		holed: true,
		water: false,
		carry: 100,
		total: 100,
	}
	const anyHole = COURSES[0]?.holes[0] as HoleSpec
	const line = L.narrate(holedOut, 'pancake', anyHole, true)
	check(
		"the hole-out line does not gloss Penny's tap",
		!/means/i.test(line) && line.includes('taps once'),
		line,
	)
}

// ---------- 5b. the cast layer is all-or-nothing ----------

// Settings.characters is off by default, so the DEFAULT experience is the one
// least exercised by hand. A half-applied toggle — plain blurb under a
// character name, or "In the cup! Brick is very pleased." for a player who
// never opted into Brick — reads as a bug rather than a style.
const castLayerChecks = () => {
	// The Help page shipped as a module-level const, evaluated once at import
	// with no way to consult the setting, so it read out the whole cast —
	// including "Brick is deaf" and "Glide does not walk" — to a player who had
	// the layer off. It is the one screen where the disability framing is
	// delivered in full, which makes it the worst place for it to leak.
	const helpOff = L.helpPages(false)
	const helpOn = L.helpPages(true)
	const teamOff = helpOff.find((p) => /shapes|team/i.test(p.label))
	const teamOn = helpOn.find((p) => /shapes|team/i.test(p.label))
	// '' rather than a guard on every line: a missing page then fails every
	// assertion below instead of silently skipping them.
	const speakOff = teamOff?.speak ?? ''
	const speakOn = teamOn?.speak ?? ''
	check('the Help page has a shapes page in both modes', speakOff !== '' && speakOn !== '', '')
	for (const id of SHAPE_ORDER) {
		check(
			`${id}: the Help shapes page follows the cast setting`,
			speakOff.includes(SHAPES[id].plainBlurb) && !speakOff.includes(SHAPES[id].blurb),
			speakOff,
		)
	}
	check(
		'no character pronoun anywhere in the plain Help page',
		speakOff !== '' && !/\b(she|he|her|him|his|hers)\b/i.test(speakOff),
		speakOff,
	)
	check(
		'the Help page names the cast when the cast is on',
		SHAPE_ORDER.every((id) => speakOn.includes(SHAPES[id].name)),
		speakOn,
	)

	// The cast is written with gendered pronouns and disability-coded detail
	// (CAST.md); plain mode is written entirely in "it". That makes a pronoun
	// the cheapest reliable tell that a character line leaked into plain mode.
	const PRONOUN = /\b(she|he|her|him|his|hers)\b/i
	for (const id of SHAPE_ORDER) {
		const off = L.shapeFocus(id, 150, false)
		const on = L.shapeFocus(id, 150, true)
		check(
			`${id}: plain focus uses the plain name and the plain blurb`,
			off.includes(SHAPES[id].plainName) && off.includes(SHAPES[id].plainBlurb),
			off,
		)
		check(`${id}: plain focus carries no character pronoun`, !PRONOUN.test(off), off)
		// The NAME must be in the opening clause, not merely somewhere in the
		// line: `on.includes(name)` was satisfied by the blurb, so this passed for
		// five of six shapes with shapeName() hard-wired to the plain name.
		check(
			`${id}: character focus uses the character name and blurb`,
			on.startsWith(`${SHAPES[id].name}.`) && on.includes(SHAPES[id].blurb),
			on,
		)
		check(`${id}: the two modes differ`, off !== on, `${off} // ${on}`)
		check(
			`${id}: the swing confirmation follows the same mode`,
			L.shapeConfirm(id, false).includes(SHAPES[id].plainName) &&
				L.shapeConfirm(id, true).includes(SHAPES[id].name),
			`${L.shapeConfirm(id, false)} // ${L.shapeConfirm(id, true)}`,
		)

		// The hole-out line is the one place a character speaks unprompted, and
		// it fires at the emotional peak of a hole — the leak a player would
		// most notice, and the one a settings-screen check cannot see.
		const holedOut: StrikeOutcome = {
			points: [],
			events: [],
			end: { x: 100, lie: 'green' },
			holed: true,
			water: false,
			carry: 100,
			total: 100,
		}
		const anyHole = COURSES[0]?.holes[0] as HoleSpec
		// The practice range shipped ungated: a player picking a row labelled
		// "Cube" heard "Brick went 82 yards!". It is also the mode this game's
		// own flow.ts calls "most likely to be someone's FIRST screen".
		const rangeOff = L.rangeNarrate(holedOut, id, false)
		const rangeOn = L.rangeNarrate(holedOut, id, true)
		check(
			`${id}: the practice range follows the cast setting`,
			rangeOff.includes(SHAPES[id].plainName) && !PRONOUN.test(rangeOff),
			rangeOff,
		)
		check(
			`${id}: the practice range uses the character name when the cast is on`,
			rangeOn.includes(SHAPES[id].name),
			rangeOn,
		)

		const cupOff = L.narrate(holedOut, id, anyHole, false)
		const cupOn = L.narrate(holedOut, id, anyHole, true)
		check(`${id}: plain hole-out says only that it went in`, cupOff === 'In the cup!', cupOff)
		check(
			`${id}: character hole-out adds the character's line`,
			cupOn.length > cupOff.length,
			cupOn,
		)
	}
}

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
	forwardPromiseChecks()
	markdownChecks()
	checklistTallyChecks()
	castDocQuoteChecks()
	castSourceChecks()
	castLayerChecks()
	castNonTextChecks()
	focusOrderChecks()

	for (const [name, ok, detail] of results) {
		console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`)
	}
	console.log(`${results.length - failures}/${results.length} checks passed`)

	// A check that VANISHES is worse than one that always passes. `CAST.md's
	// quote of pancake's cup line matches the code` only ran when the quoted
	// string shared a long enough prefix with the shipped line — so growing the
	// shipped line dropped the assertion entirely, the suite went 191/191 to
	// 190/190, and the regression it guards shipped green. A reviewer found it
	// by putting a narrator gloss back into Penny's line and watching the check
	// disappear rather than fail.
	// Pinning the count is the general fix: any assertion that stops running
	// takes the suite down with it. Raise this deliberately when adding checks.
	const EXPECTED_CHECKS = 206
	if (results.length !== EXPECTED_CHECKS) {
		console.log(
			`menu-check: expected ${EXPECTED_CHECKS} checks, ran ${results.length}. A check that stops running is a check that stopped guarding something; find out which before changing this number.`,
		)
		process.exit(1)
	}
	process.exit(failures === 0 ? 0 : 1)
}

main()
