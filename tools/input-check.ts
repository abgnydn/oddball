// Headless check of the scanner + switch-timing state machines (no DOM).
// Run:
//   pnpm exec esbuild tools/input-check.ts --bundle --platform=node --format=esm \
//     --log-level=warning --outfile=node_modules/.cache/input-check.mjs \
//   && node node_modules/.cache/input-check.mjs

import { createScanner } from '../src/input/scanner'
import { createSwitchMachine } from '../src/input/switch'
import {
	INPUT_COOLDOWN_MS,
	nextScanMs,
	RETURN_HOLD_MS,
	SCAN_SPEEDS,
	SPACE_HOLD_MS,
} from '../src/tuning'
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

	// held-Space backward scanning: one immediate step at the threshold, then steady stepping
	sc.setScanMs(25)
	sc.handle('autostart')
	const before = sc.focusIndex()
	const beforeCount = focusLog.length
	await sleep(8)
	check('no auto step before the first interval', sc.focusIndex() === before)
	await sleep(100)
	const advanced = focusLog.length - beforeCount
	check('backward scan steps every scanMs', advanced >= 2, `steps in ~108ms @25ms: ${advanced}`)
	sc.handle('autostop')
	const atStop = sc.focusIndex()
	const countAtStop = focusLog.length
	await sleep(80)
	check('autostop stops stepping', sc.focusIndex() === atStop && focusLog.length === countAtStop)

	// Space is still physically held through a rebuild: backward scanning must
	// SURVIVE setItems (it runs until release), then stop on
	// autostop, and clear() must kill it entirely.
	sc.handle('autostart')
	sc.setItems(items)
	const countAfterSet = focusLog.length
	await sleep(80)
	check('setItems keeps held backward scanning stepping', focusLog.length > countAfterSet)
	sc.handle('autostop')
	const countStopped = focusLog.length
	await sleep(80)
	check('autostop after rebuild stops stepping', focusLog.length === countStopped)

	// hold-Space = BACKWARD scanning: from item 0 it wraps to the last item
	// (no deadzone on the backward wrap) and keeps stepping down.
	sc.setItems(items)
	sc.handle('autostart')
	await sleep(10)
	const afterEngage = sc.focusIndex()
	check('backward scan wraps 0 → last on engage', afterEngage === items.length - 1)
	await sleep(60)
	check('backward scan keeps stepping down', sc.focusIndex() < afterEngage)
	sc.handle('autostop')

	// Auto Scan setting: hands-free forward stepping, no key events at all.
	sc.setAutoScan(true)
	const beforeAuto = focusLog.length
	sc.setItems(items)
	await sleep(80)
	check('Auto Scan advances by itself', focusLog.length > beforeAuto + 1)
	sc.setAutoScan(false)
	const offCount = focusLog.length
	await sleep(60)
	check('Auto Scan off stops the stepping', focusLog.length === offCount)

	sc.clear()
	check('clear resets the scanner', sc.focusIndex() === -1)
	sc.handle('next')
	check('next on an empty list is a no-op', sc.focusIndex() === -1)
}

// ---------- long Enter opens the menu, and that press's release is consumed ----

const longReturnChecks = async () => {
	// The release must NOT also select: it would close the menu on whatever it
	// opened under, and with Auto Scan on the overlay has already stepped, so the
	// player lands somewhere they never chose. BENNYSMINIGOLF gets there another
	// way — opening its pause menu clears the flag its keyup handler needs.
	const events: SwitchEvent[] = []
	const m = createSwitchMachine((e) => events.push(e), { space: 100, return: 40 }, 0)
	m.down('return')
	await sleep(70) // past the threshold: 'menu' fires
	m.up('return')
	check(
		'long Return opens the menu and the release does NOT select',
		events.length === 1 && events[0] === 'menu',
		`got ${events.join(',')}`,
	)

	// A slow release short of the threshold still selects — that is the case the
	// suppression must not catch.
	events.length = 0
	m.down('return')
	await sleep(30) // under the 40 ms threshold, but not instant
	m.up('return')
	check(
		'a slow release short of the threshold still selects',
		events.join() === 'select',
		`got ${events.join(',')}`,
	)
}

// ---------- scan-speed ladder: an off-ladder saved speed steps UP ----------

const ladderChecks = () => {
	// nextScanMs is the SHIPPED function the Scan Speed row calls — not a copy.
	check('legacy 1600 ms steps up to 2000, not down to 1000', nextScanMs(1600) === 2000)
	check('legacy 1200 ms steps up to 2000', nextScanMs(1200) === 2000)
	check('legacy 800 ms steps up to 1000', nextScanMs(800) === 1000)
	check('on-ladder cycle still wraps 4000 -> 1000', nextScanMs(4000) === 1000)
	check('on-ladder cycle 2000 -> 3000', nextScanMs(2000) === 3000)
	check('the ladder is the hub ladder', SCAN_SPEEDS.join() === '1000,2000,3000,4000')
}

// ---------- the SHIPPED constants, not just the test's own values ----------

const shippedConstantChecks = async () => {
	// A prior harness audit found the cooldown tests passed their own value, so
	// zeroing the shipped constant broke nothing. Pin the real ones here.
	check('shipped cooldown is a real guard', INPUT_COOLDOWN_MS >= 150 && INPUT_COOLDOWN_MS <= 400)
	check('backward-scan hold matches the hub convention (~3 s)', SPACE_HOLD_MS === 3000)
	// The contract's pause convention is ~5 s; 3 s is this game's own choice, so
	// this pins the shipped value without claiming it conforms.
	check('menu hold is the shipped 3 s, a disclosed departure', RETURN_HOLD_MS === 3000)
	const events: SwitchEvent[] = []
	const m = createSwitchMachine((e) => events.push(e)) // DEFAULT timings = shipped
	m.down('return')
	m.up('return')
	m.down('return') // immediate bounce — the shipped cooldown must swallow it
	m.up('return')
	check(
		'shipped cooldown swallows an instant bounce',
		events.length === 1,
		`got ${events.join(',')}`,
	)
}

// ---------- post-release cooldown (anti switch-bounce) ----------

const cooldownChecks = async () => {
	const events: SwitchEvent[] = []
	const m = createSwitchMachine((e) => events.push(e), { space: 100, return: 40 }, 60)
	m.down('return')
	m.up('return') // select
	m.down('return') // bounce within 60 ms — must be ignored
	m.up('return')
	check('bounce re-press inside cooldown is ignored', events.length === 1)
	await sleep(80)
	m.down('return')
	m.up('return')
	check('press after cooldown works', events.length === 2 && events[1] === 'select')
}

// ---------- switch timing machine (short thresholds: space 100ms, return 40ms) ----------

const switchChecks = async () => {
	const events: SwitchEvent[] = []
	const m = createSwitchMachine((e) => events.push(e), { space: 100, return: 40 }, 0)

	m.down('space')
	await sleep(15)
	m.up('space')
	check('short space press = next', events.join() === 'next', events.join())

	events.length = 0
	m.down('space')
	await sleep(140)
	check('space held to threshold fires autostart AT threshold', events.join() === 'autostart')
	m.up('space')
	check('release after backward scan = autostop, NOT next', events.join() === 'autostart,autostop')

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
	check('keyup after menu is consumed, so the menu stays open', events.join() === 'menu')

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
	check(
		'both held: releases resolve per key',
		// return's release is consumed (it opened the menu); space's ends the
		// backward scan without stepping
		events.join() === 'menu,autostart,autostop',
		`got ${events.join(',')}`,
	)

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

	// blur during backward scanning must end it
	events.length = 0
	m.down('space')
	await sleep(140)
	m.cancel()
	check('cancel during backward scan emits autostop', events.join() === 'autostart,autostop')

	// auto-repeat guard lives in the DOM layer; a duplicate down is also ignored here
	events.length = 0
	m.down('return')
	m.down('return')
	await sleep(15)
	m.up('return')
	check('duplicate down while held is ignored', events.join() === 'select', events.join())
}

await scannerChecks()
ladderChecks()
await shippedConstantChecks()
await longReturnChecks()
await cooldownChecks()
await switchChecks()

for (const [name, ok, detail] of results) {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === '' ? '' : ` — ${detail}`}`)
}
console.log(`${results.length - failures}/${results.length} checks passed`)
if (failures > 0) process.exit(1)
