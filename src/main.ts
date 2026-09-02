import { createSFX } from './audio/sfx'
import { createFlow } from './game/flow'
import { createSave } from './game/save'
import { createScanner } from './input/scanner'
import { createSwitchInput } from './input/switch'
import { createRenderer } from './render/draw'
import { createSim } from './sim/physics'
import { createTTS } from './speech/tts'
import { HOLD_SHOW_MS, RETURN_HOLD_MS } from './tuning'
import { createHud } from './ui/hud'

const root = document.getElementById('app')
if (!root) throw new Error('#app missing')

const hud = createHud(root)
const tts = createTTS()
tts.onCaption((text) => hud.caption(text))

const renderer = createRenderer()
renderer.attach(hud.canvas)
window.addEventListener('resize', () => renderer.resize())
// The canvas area also changes size when the scan panel shows/hides.
new ResizeObserver(() => renderer.resize()).observe(hud.canvas)

const scanner = createScanner()
// Hands-free scanning waits for narration: without this the Auto Scan timer
// steps the highlight while a hole intro is still being read, and the next
// focus utterance cancels the intro mid-sentence.
tts.onHoldChange((holding) => scanner.setAutoHold(holding))
const sfx = createSFX()
const flow = createFlow({
	hud,
	scanner,
	tts,
	sfx,
	renderer,
	sim: createSim(),
	save: createSave(),
})

const input = createSwitchInput(() => !hud.overlayOpen())
input.on((e) => flow.onSwitch(e))
input.start()

// Hold-progress ring and rising beep (§4). A hold that shows nothing reads as
// broken, so partway through the gesture a ring appears and fills, and a blip
// a step higher each second makes it audible with eyes closed. Race Tracks is
// the build §4 names; this matches its shape at this build's 3 s threshold.
//
// Driven by one rAF poll rather than a timer per press: the switch machine owns
// the thresholds, and a poll cannot drift out of step with them or leave a
// stray timer behind when a press is cancelled by blur.
let pointerHoldAt = 0 // set while a pointer press is down; 0 when it is not
let holdBeepAt = 0 // last whole second already beeped, per gesture
const holdTick = (): void => {
	// The pointer hold and the Enter hold open the same menu, so whichever is
	// further along drives the ring. Space's backward-scan hold gets it too:
	// it is the same gesture cost, and §4 does not exempt it.
	const held = Math.max(
		input.heldFor('return'),
		input.heldFor('space'),
		pointerHoldAt ? Date.now() - pointerHoldAt : 0,
	)
	if (held <= 0) {
		hud.holdProgress(null)
		holdBeepAt = 0
	} else if (held >= HOLD_SHOW_MS) {
		hud.holdProgress((held - HOLD_SHOW_MS) / (RETURN_HOLD_MS - HOLD_SHOW_MS))
		const secs = Math.floor(held / 1000)
		if (secs > holdBeepAt) {
			holdBeepAt = secs
			sfx.holdBeep(secs)
		}
	}
	requestAnimationFrame(holdTick)
}
requestAnimationFrame(holdTick)

// Pointer parity (per the guide): click selects (the scanner wires that on the
// items); click-and-HOLD anywhere opens the context menu, like holding Enter.
let holdTimer: ReturnType<typeof setTimeout> | null = null
// A hold that opened the menu must swallow its own click, or the pointer path
// repeats the bug the keyboard path fixes: the release lands on the menu (or on
// the item under the finger) and undoes the gesture. Their contract is explicit
// that a press may last four seconds without the player meaning it to.
//
// The window is stamped at the RELEASE, not when the menu opened: a press may
// last any length ("a press might last a fraction of a second or four seconds,
// and that variation is not intentional" — §1), and stamping at open expired
// the guard 1 s later, so a 4 s press opened the menu and then closed it again.
// Still bounded rather than a sticky flag: if the release never produces a click
// (pointercancel from an iOS long-press callout, a scroll takeover), a latched
// flag would sit armed and eat the NEXT click instead — which for an assistive
// pointer could be the player's next real activation.
let holdFiredMenu = false // this press opened the menu; its click is not a pick
let holdOpenedMenuAt = 0 // set on release, so the window covers any hold length
const HOLD_CLICK_WINDOW_MS = 1000
const cancelHold = () => {
	pointerHoldAt = 0 // ring is driven off this; a stale value leaves it stuck on
	if (holdTimer !== null) {
		clearTimeout(holdTimer)
		holdTimer = null
	}
}
document.addEventListener(
	'click',
	(e) => {
		if (Date.now() - holdOpenedMenuAt > HOLD_CLICK_WINDOW_MS) return
		holdOpenedMenuAt = 0
		e.stopPropagation()
		e.preventDefault()
	},
	true, // capture: beat the scan items' and the Pause button's own handlers
)
document.addEventListener('pointerdown', () => {
	cancelHold() // one live timer max — a second finger must not orphan the first
	holdFiredMenu = false
	holdOpenedMenuAt = 0
	pointerHoldAt = Date.now() // feeds the hold-progress ring
	holdTimer = setTimeout(() => {
		holdTimer = null
		if (hud.overlayOpen()) return // already open: this is an ordinary pick
		holdFiredMenu = true
		flow.onSwitch('menu')
	}, RETURN_HOLD_MS)
})
hud.onPause(() => flow.onSwitch('menu'))
// The release closes the press. If that press opened the menu, start the
// swallow window HERE so it covers the click that is about to follow, however
// long the player held.
const endHold = () => {
	cancelHold()
	if (holdFiredMenu) {
		holdFiredMenu = false
		holdOpenedMenuAt = Date.now()
	}
}
// A cancelled press produces no click at all, so leave no window open — a click
// arriving without its own pointerdown (assistive tech) would otherwise be eaten.
const abortHold = () => {
	cancelHold()
	holdFiredMenu = false
	holdOpenedMenuAt = 0
}
document.addEventListener('pointerup', endHold)
document.addEventListener('pointercancel', abortHold)
document.addEventListener('pointerleave', abortHold)
window.addEventListener('blur', abortHold)

flow.start()
