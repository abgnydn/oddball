// Scan-list engine (DESIGN.md "Input grammar"). The highlight starts on
// startIndex (default 0) and is announced immediately via onFocus, but nothing
// advances until the first 'next'. Before wrapping from the last item to the
// first there is ONE deadzone step — onFocus fires with (null, -1) and select
// does nothing there. Focus restoration is the caller's job via startIndex.
//
// Dwell-to-select (head/eye-tracking users): when enabled via setDwell(ms),
// resting the pointer on an item fills its --dwell custom property 0 → 1 over
// ms (theme.css paints the fill); reaching 1 acts exactly like a click.
// Pointer leave or press cancels. Independent of the scan/keyboard flow.

import { DEFAULT_SETTINGS } from '../tuning'
import type { ScanItem, Scanner, SwitchEvent } from '../types'

export function createScanner(): Scanner {
	let items: ScanItem[] = []
	let index = -1
	let scanMs = DEFAULT_SETTINGS.scanMs
	let autoTimer: ReturnType<typeof setInterval> | null = null
	let autoHeld = false // Space is physically held in auto-scan; survives setItems
	let dwellMs: number | null = null
	let dwellEl: HTMLElement | null = null // the ONE item currently dwelling
	let dwellRaf = 0
	const focusCbs: Array<(item: ScanItem | null, index: number) => void> = []
	const selectCbs: Array<(item: ScanItem, index: number) => void> = []
	const domHandlers: Array<{ el: HTMLElement; type: string; fn: () => void }> = []

	const updateDom = () => {
		for (let i = 0; i < items.length; i++) {
			const el = items[i]?.el
			if (!el) continue
			if (i === index) {
				el.setAttribute('data-scan-focus', 'true')
				el.setAttribute('aria-selected', 'true')
			} else {
				el.removeAttribute('data-scan-focus')
				el.setAttribute('aria-selected', 'false')
			}
		}
	}

	const fireFocus = () => {
		updateDom()
		const item = index >= 0 ? (items[index] ?? null) : null
		for (const cb of focusCbs) cb(item, index)
	}

	const select = (i: number) => {
		const item = items[i]
		if (!item) return
		for (const cb of selectCbs) cb(item, i)
	}

	const cancelDwell = () => {
		if (dwellRaf !== 0) {
			cancelAnimationFrame(dwellRaf)
			dwellRaf = 0
		}
		if (dwellEl) {
			dwellEl.style.removeProperty('--dwell') // theme.css falls back to 0
			dwellEl = null
		}
	}

	const startDwell = (el: HTMLElement, i: number) => {
		if (dwellMs === null || typeof requestAnimationFrame !== 'function') return
		cancelDwell() // only one item dwells at a time
		dwellEl = el
		const ms = dwellMs
		let start = -1
		const frame = (ts: number) => {
			dwellRaf = 0
			if (dwellEl !== el) return // cancelled, or another item took over
			if (start < 0) start = ts
			const p = Math.min((ts - start) / ms, 1)
			el.style.setProperty('--dwell', p.toFixed(3))
			if (p >= 1) {
				cancelDwell() // fill resets BEFORE select — it may rebuild the list
				// exactly like a click: focus moves first, then select fires
				index = i
				fireFocus()
				select(i)
				return
			}
			dwellRaf = requestAnimationFrame(frame)
		}
		dwellRaf = requestAnimationFrame(frame)
	}

	const step = () => {
		if (items.length === 0) return
		if (index === -1) index = 0
		else if (index >= items.length - 1)
			index = -1 // deadzone before the wrap
		else index += 1
		fireFocus()
	}

	const stopAuto = () => {
		if (autoTimer !== null) {
			clearInterval(autoTimer)
			autoTimer = null
		}
	}

	const startAuto = () => {
		stopAuto()
		autoTimer = setInterval(step, scanMs) // first auto step after one interval
	}

	const detachDom = () => {
		cancelDwell()
		for (const { el, type, fn } of domHandlers) el.removeEventListener(type, fn)
		domHandlers.length = 0
		for (const item of items) {
			const el = item.el
			if (!el) continue
			el.removeAttribute('data-scan-focus')
			el.removeAttribute('aria-selected')
			el.removeAttribute('role')
		}
	}

	return {
		setItems(next, opts) {
			stopAuto()
			detachDom()
			items = next
			for (let i = 0; i < items.length; i++) {
				const el = items[i]?.el
				if (!el) continue
				el.setAttribute('role', 'option')
				el.parentElement?.setAttribute('role', 'listbox')
				const fn = () => {
					// click = select (per the guide); focus moves first so the footer
					// names the clicked item and focusIndex() restores correctly
					index = i
					fireFocus()
					select(i)
				}
				el.addEventListener('click', fn)
				domHandlers.push({ el, type: 'click', fn })
				// dwell: hover starts the fill; leaving or pressing cancels it
				// (pointerdown cancels so a real click never double-fires)
				const enter = () => startDwell(el, i)
				const cancel = () => {
					if (dwellEl === el) cancelDwell()
				}
				el.addEventListener('pointerenter', enter)
				el.addEventListener('pointerleave', cancel)
				el.addEventListener('pointerdown', cancel)
				domHandlers.push({ el, type: 'pointerenter', fn: enter })
				domHandlers.push({ el, type: 'pointerleave', fn: cancel })
				domHandlers.push({ el, type: 'pointerdown', fn: cancel })
			}
			if (items.length === 0) {
				index = -1
				return
			}
			const start = opts?.startIndex ?? 0
			index = Math.min(Math.max(start, 0), items.length - 1)
			fireFocus()
			// Auto-scan runs "until release": a selection that rebuilds the list
			// (settings rows) must not kill it while Space is still held.
			if (autoHeld) startAuto()
		},
		clear() {
			stopAuto()
			autoHeld = false
			detachDom()
			items = []
			index = -1
			for (const cb of focusCbs) cb(null, -1) // consumers clear footer/captions
		},
		onFocus(cb) {
			focusCbs.push(cb)
		},
		onSelect(cb) {
			selectCbs.push(cb)
		},
		focusIndex() {
			return index
		},
		handle(e: SwitchEvent) {
			switch (e) {
				case 'next':
					step()
					break
				case 'select':
					if (index >= 0) select(index) // deadzone select does nothing
					break
				case 'autostart':
					autoHeld = true
					startAuto()
					break
				case 'autostop':
					autoHeld = false
					stopAuto()
					break
				default:
					break // 'menu' is the flow's concern, not the scanner's
			}
		},
		setScanMs(ms) {
			scanMs = ms
			if (autoTimer !== null) startAuto() // apply immediately mid-auto-scan
		},
		setDwell(ms) {
			dwellMs = ms
			if (ms === null) cancelDwell() // disable mid-dwell = clean reset
		},
	}
}
