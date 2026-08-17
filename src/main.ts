import { createSFX } from './audio/sfx'
import { createFlow } from './game/flow'
import { createSave } from './game/save'
import { createScanner } from './input/scanner'
import { createSwitchInput } from './input/switch'
import { createRenderer } from './render/draw'
import { createSim } from './sim/physics'
import { createTTS } from './speech/tts'
import { RETURN_HOLD_MS } from './tuning'
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
const flow = createFlow({
	hud,
	scanner,
	tts,
	sfx: createSFX(),
	renderer,
	sim: createSim(),
	save: createSave(),
})

const input = createSwitchInput()
input.on((e) => flow.onSwitch(e))
input.start()

// Pointer parity (per the guide): click selects (the scanner wires that on the
// items); click-and-HOLD anywhere opens the context menu, like holding Return.
let holdTimer: ReturnType<typeof setTimeout> | null = null
const cancelHold = () => {
	if (holdTimer !== null) {
		clearTimeout(holdTimer)
		holdTimer = null
	}
}
document.addEventListener('pointerdown', () => {
	cancelHold() // one live timer max — a second finger must not orphan the first
	holdTimer = setTimeout(() => {
		holdTimer = null
		flow.onSwitch('menu')
	}, RETURN_HOLD_MS)
})
document.addEventListener('pointerup', cancelHold)
document.addEventListener('pointercancel', cancelHold)
document.addEventListener('pointerleave', cancelHold)
window.addEventListener('blur', cancelHold)

flow.start()
