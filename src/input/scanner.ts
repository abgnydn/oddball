// Scan-list engine (DESIGN.md "Input grammar"). The highlight starts on
// startIndex (default 0) and is announced immediately via onFocus; with Auto
// Scan off nothing advances until the first 'next'. Before wrapping to the
// first there is ONE deadzone step — onFocus fires with (null, -1) and select
// does nothing there. Focus restoration is the caller's job via startIndex.
//
// Dwell-to-select (head/eye-tracking users): when enabled via setDwell(ms),
// resting the pointer on an item fills its --dwell custom property 0 → 1 over
// ms (theme.css paints the fill); reaching 1 acts exactly like a click.
// Pointer leave or press cancels. Independent of the scan/keyboard flow.
//
// Two timer modes (house-style calibration against the shipped NARBE hub):
// hold-Space = BACKWARD scanning while held (steps at scanMs, no deadzone on
// the backward wrap, release ends without stepping); Auto Scan setting =
// forward stepping by itself at scanMs so a single-switch player only presses
// Enter. Backward-hold takes priority while Space is down.

import { DEFAULT_SETTINGS, DWELL_REARM_PX, INPUT_COOLDOWN_MS } from '../tuning'
import type { ScanItem, Scanner, SwitchEvent } from '../types'

export function createScanner(): Scanner {
	let items: ScanItem[] = []
	let index = -1
	let scanMs = DEFAULT_SETTINGS.scanMs
	let autoTimer: ReturnType<typeof setInterval> | null = null
	let autoHeld = false // Space is physically held (backward scan); survives setItems
	let autoScanOn = false // the Auto Scan setting (forward, hands-free)
	let autoHold = false // narration in flight — Auto Scan's timer waits for it
	let dwellMs: number | null = null
	let dwellEl: HTMLElement | null = null // the ONE item currently dwelling
	// null until the pointer actually moves after a list rebuild. A rebuild
	// re-fires pointerenter under a stationary pointer, which would otherwise
	// let dwell confirm its own confirmation prompt.
	let dwellArmedAt: number | null = 0
	let hoverEl: HTMLElement | null = null // the row the pointer is over
	let hoverIdx = -1
	let lastPointer: { x: number; y: number } | null = null
	let rearmFrom: { x: number; y: number } | null = null // pointer at last rebuild
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
		const el = index >= 0 ? items[index]?.el : undefined
		const item = index >= 0 ? (items[index] ?? null) : null
		// Callbacks first: they set the caption, and a long caption grows the
		// caption bar, which shrinks the panel from the bottom. Scrolling before
		// that computes a position the very next layout invalidates.
		for (const cb of focusCbs) cb(item, index)
		// Without this the highlight can sit below the fold: the panel scrolls,
		// but nothing ever scrolled the focused row into it. The rack is taller
		// than the panel at every viewport tested.
		el?.scrollIntoView?.({ block: 'nearest' })
		if (typeof requestAnimationFrame === 'function') {
			requestAnimationFrame(() => el?.scrollIntoView?.({ block: 'nearest' }))
		}
	}

	const select = (i: number) => {
		const item = items[i]
		if (!item) return
		for (const cb of selectCbs) cb(item, i)
	}

	// Pointer-driven selects (click and dwell) get the same post-select cooldown
	// the switch machine gives key presses. Without it a bounce or a tremor
	// double-fires: the first pick arms a destructive item and the second
	// confirms it, which is exactly what the two-step confirm exists to stop.
	let lastPointerSelect = -1e9
	const pointerSelect = (i: number) => {
		const now = Date.now()
		if (now - lastPointerSelect < INPUT_COOLDOWN_MS) return
		lastPointerSelect = now
		index = i
		fireFocus()
		select(i)
	}

	// One document-level listener: deliberate pointer movement re-arms dwell and
	// starts it on whatever row is under the pointer. pointerenter fires BEFORE
	// pointermove, so arming alone would never start the first dwell.
	if (typeof document !== 'undefined') {
		document.addEventListener(
			'pointermove',
			(e) => {
				lastPointer = { x: e.clientX, y: e.clientY }
				if (dwellArmedAt === null) {
					if (rearmFrom === null) dwellArmedAt = 0
					else if (Math.hypot(e.clientX - rearmFrom.x, e.clientY - rearmFrom.y) >= DWELL_REARM_PX) {
						dwellArmedAt = 0
					} else return // tracker jitter, not a decision
				}
				if (hoverEl !== null && dwellEl !== hoverEl) startDwell(hoverEl, hoverIdx)
			},
			true,
		)
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
		if (dwellArmedAt === null) return // list rebuilt: wait for a real move
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
				pointerSelect(i) // exactly like a click, cooldown included
				return
			}
			dwellRaf = requestAnimationFrame(frame)
		}
		dwellRaf = requestAnimationFrame(frame)
	}

	/** auto=true when the scan timer is driving. The wrap deadzone is a beat to
	 *  reconsider before looping, which only makes sense for a deliberate press:
	 *  under Auto Scan it is a silent interval where nothing is focused and
	 *  Enter does nothing, and Enter is the whole interface. */
	const step = (auto = false) => {
		if (items.length === 0) return
		if (index === -1) index = 0
		else if (index >= items.length - 1) index = auto ? 0 : -1
		else index += 1
		fireFocus()
	}

	const stepBack = () => {
		if (items.length === 0) return
		// backward has no deadzone — matches the shipped hub games
		index = index <= 0 ? items.length - 1 : index - 1
		fireFocus()
	}

	const stopAuto = () => {
		if (autoTimer !== null) {
			clearInterval(autoTimer)
			autoTimer = null
		}
	}

	/** (Re)start the timer for whichever mode is active. Backward-hold wins. */
	const syncTimer = (immediateBack = false) => {
		stopAuto()
		if (autoHeld) {
			if (immediateBack) stepBack() // feedback that backward mode engaged
			autoTimer = setInterval(stepBack, scanMs)
		} else if (autoScanOn && !autoHold) {
			autoTimer = setInterval(() => step(true), scanMs) // first step after one interval
		}
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
			dwellArmedAt = null // a rebuild must not let a still pointer keep dwelling
			rearmFrom = lastPointer === null ? null : { ...lastPointer }
			hoverEl = null
			hoverIdx = -1
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
					pointerSelect(i)
				}
				el.addEventListener('click', fn)
				domHandlers.push({ el, type: 'click', fn })
				// dwell: hover starts the fill; leaving or pressing cancels it
				// (pointerdown cancels so a real click never double-fires)
				const enter = () => {
					hoverEl = el
					hoverIdx = i
					startDwell(el, i) // no-op until a real move re-arms it
				}
				const cancel = () => {
					if (hoverEl === el) hoverEl = null
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
			// A rebuild must not kill an active mode: backward scanning runs
			// "until release", and Auto Scan runs whenever a list is showing.
			syncTimer()
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
					if (autoScanOn && !autoHeld) syncTimer() // manual step resets the beat
					break
				case 'select':
					if (index >= 0) select(index) // deadzone select does nothing
					break
				case 'autostart':
					autoHeld = true
					syncTimer(true)
					break
				case 'autostop':
					autoHeld = false
					syncTimer() // falls back to Auto Scan if the setting is on
					break
				default:
					break // 'menu' is the flow's concern, not the scanner's
			}
		},
		setScanMs(ms) {
			scanMs = ms
			if (autoTimer !== null) syncTimer() // apply immediately mid-scan
		},
		setAutoHold(on) {
			if (autoHold === on) return
			autoHold = on
			// Resuming restarts the interval, so the player gets a full reaction
			// budget on the item they were left on rather than a truncated one.
			if (!autoHeld) syncTimer()
		},
		setAutoScan(on) {
			autoScanOn = on
			if (!autoHeld) syncTimer()
		},
		setDwell(ms) {
			dwellMs = ms
			if (ms === null) cancelDwell() // disable mid-dwell = clean reset
		},
	}
}
