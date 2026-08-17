// Headless check of the scanner + switch-timing state machines (no DOM).
// Run:
//   pnpm exec esbuild tools/input-check.ts --bundle --platform=node --format=esm \
//     --log-level=warning --outfile=node_modules/.cache/input-check.mjs \
//   && node node_modules/.cache/input-check.mjs

import { createScanner } from '../src/input/scanner'
import { createSwitchMachine } from '../src/input/switch'
import type { ScanItem, SwitchEvent } from '../src/types'

let failures = 0
const results: Array<[string, boolean, string]> = []
const check = (name: string, ok: boolean, detail = '') => {
	results.push([name, ok, detail])
	if (!ok) failures++
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---------- scanner ----------

const scannerChecks = async () => {
	const items: ScanItem[] = [
		{ id: 'a', label: 'A', speak: 'A' },
		{ id: 'b', label: 'B', speak: 'B' },
		{ id: 'c', label: 'C', speak: 'C' },
	]
	const sc = createScanner()
	const focusLog: number[] = []
	const selectLog: string[] = []
	sc.onFocus((_item, i) => focusLog.push(i))
	sc.onSelect((item) => selectLog.push(item.id))

	sc.setItems(items)
	check(
		'initial focus reported immediately on item 0',
		focusLog.length === 1 && focusLog[0] === 0 && sc.focusIndex() === 0,
		`focusLog=${focusLog.join()}`,
	)

	sc.handle('select')
	check('select fires for the focused item', selectLog.join() === 'a')

	sc.handle('next')
	sc.handle('next')
	check('next steps forward', sc.focusIndex() === 2 && focusLog.join() === '0,1,2')

	sc.handle('next')
	check('one deadzone step before the wrap', sc.focusIndex() === -1 && focusLog.at(-1) === -1)

	sc.handle('select')
	check('deadzone select does nothing', selectLog.join() === 'a')

	sc.handle('next')
	check('wraps to item 0 after the deadzone', sc.focusIndex() === 0)

	sc.setItems(items, { startIndex: 2 })
	check('startIndex restoration honored', sc.focusIndex() === 2 && focusLog.at(-1) === 2)

	// auto-scan: first step only after one full interval, then steady stepping
	sc.setScanMs(25)
	sc.handle('autostart')
	const before = sc.focusIndex()
	const beforeCount = focusLog.length
	await sleep(8)
	check('no auto step before the first interval', sc.focusIndex() === before)
	await sleep(100)
	const advanced = focusLog.length - beforeCount
	check('auto-scan steps every scanMs', advanced >= 2, `steps in ~108ms @25ms: ${advanced}`)
	sc.handle('autostop')
	const atStop = sc.focusIndex()
	const countAtStop = focusLog.length
	await sleep(80)
	check('autostop stops stepping', sc.focusIndex() === atStop && focusLog.length === countAtStop)

	// Space is still physically held through a rebuild: auto-scan must SURVIVE
	// setItems (the grammar says auto-scan runs until release), then stop on
	// autostop, and clear() must kill it entirely.
	sc.handle('autostart')
	sc.setItems(items)
	const countAfterSet = focusLog.length
	await sleep(80)
	check('setItems keeps a held auto-scan stepping', focusLog.length > countAfterSet)
	sc.handle('autostop')
	const countStopped = focusLog.length
	await sleep(80)
	check('autostop after rebuild stops stepping', focusLog.length === countStopped)

	sc.clear()
	check('clear resets the scanner', sc.focusIndex() === -1)
	sc.handle('next')
	check('next on an empty list is a no-op', sc.focusIndex() === -1)
}

// ---------- switch timing machine (short thresholds: space 100ms, return 40ms) ----------

const switchChecks = async () => {
	const events: SwitchEvent[] = []
	const m = createSwitchMachine((e) => events.push(e), { space: 100, return: 40 })

	m.down('space')
	await sleep(15)
	m.up('space')
	check('short space press = next', events.join() === 'next', events.join())

	events.length = 0
	m.down('space')
	await sleep(140)
	check('space held to threshold fires autostart AT threshold', events.join() === 'autostart')
	m.up('space')
	check('release after auto-scan = autostop, NOT next', events.join() === 'autostart,autostop')

	events.length = 0
	m.down('return')
	await sleep(15)
	m.up('return')
	check('short return press = select', events.join() === 'select', events.join())

	events.length = 0
	m.down('return')
	await sleep(80)
	check('return held to threshold fires menu AT threshold', events.join() === 'menu')
	m.up('return')
	check('keyup after menu is swallowed', events.join() === 'menu')

	// both keys held at once, tracked independently
	events.length = 0
	m.down('space')
	m.down('return')
	await sleep(60) // past return threshold (40), before space threshold (100)
	check('both held: menu fires first, no autostart yet', events.join() === 'menu')
	await sleep(80) // past space threshold
	check('both held: autostart fires independently', events.join() === 'menu,autostart')
	m.up('return')
	m.up('space')
	check('both held: releases resolve per key', events.join() === 'menu,autostart,autostop')

	// blur before the threshold: cancel timers, no events, stale keyup ignored
	events.length = 0
	m.down('space')
	m.down('return')
	await sleep(10)
	m.cancel()
	await sleep(140)
	check('cancel before threshold fires nothing', events.length === 0, events.join())
	m.up('space')
	m.up('return')
	check('keyup after cancel is ignored', events.length === 0, events.join())

	// blur during auto-scan must end it
	events.length = 0
	m.down('space')
	await sleep(140)
	m.cancel()
	check('cancel during auto-scan emits autostop', events.join() === 'autostart,autostop')

	// auto-repeat guard lives in the DOM layer; a duplicate down is also ignored here
	events.length = 0
	m.down('return')
	m.down('return')
	await sleep(15)
	m.up('return')
	check('duplicate down while held is ignored', events.join() === 'select', events.join())
}

await scannerChecks()
await switchChecks()

for (const [name, ok, detail] of results) {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === '' ? '' : ` — ${detail}`}`)
}
console.log(`${results.length - failures}/${results.length} checks passed`)
if (failures > 0) process.exit(1)
