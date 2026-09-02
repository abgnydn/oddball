// Switch input — the hub's input contract (DESIGN.md "Input grammar").
// Space release (held < SPACE_HOLD_MS) = 'next'. Space held to the threshold =
// 'autostart' (fired AT the threshold); its eventual release = 'autostop', not
// 'next'. Enter release = 'select' — unless that press already opened the menu.
// Holding Enter past RETURN_HOLD_MS fires 'menu' at the threshold and the
// release is then consumed, so the menu stays open on the item it opened under.
// BENNYSMINIGOLF ends up in the same place by another route: opening its pause
// menu calls Input.setMode('MENU'), which clears the `enterPressed` flag its
// keyup handler needs, so that handler bails out before selecting. A slow
// release is still safe here: any release short of RETURN_HOLD_MS selects.
// Both keys are tracked independently, each with its own release cooldown.

import { INPUT_COOLDOWN_MS, RETURN_HOLD_MS, SPACE_HOLD_MS } from '../tuning'
import type { SwitchEvent, SwitchInput, SwitchKey } from '../types'

export interface SwitchMachine {
	down(key: SwitchKey): void
	up(key: SwitchKey): void
	/** Blur/stop: drop held keys and cancel pending threshold timers without
	 *  firing press events. If backward scanning is active it emits 'autostop' so
	 *  the scanner never keeps stepping after the keyup is lost. */
	cancel(): void
	/** ms this key has been held, or 0 when it is not held. Polled by the
	 *  hold-progress ring (§4); the machine keeps no timer of its own for it, so
	 *  a headless test can drive `down`/`up` without a frame loop running. */
	heldFor(key: SwitchKey): number
}

interface KeyState {
	held: boolean
	thresholdFired: boolean
	timer: ReturnType<typeof setTimeout> | null
	downAt: number
}

/** Timing state machine behind createSwitchInput — exported so headless tests
 *  can drive it with short thresholds. Production uses the tuning defaults. */
export function createSwitchMachine(
	emit: (e: SwitchEvent) => void,
	holdMs: { space: number; return: number } = { space: SPACE_HOLD_MS, return: RETURN_HOLD_MS },
	cooldownMs: number = INPUT_COOLDOWN_MS,
	/** False while the menu is already open: the Enter hold then does nothing
	 *  special, so a slow deliberate pick inside the menu still selects. */
	canOpenMenu: () => boolean = () => true,
): SwitchMachine {
	const keys: Record<SwitchKey, KeyState> = {
		space: { held: false, thresholdFired: false, timer: null, downAt: 0 },
		return: { held: false, thresholdFired: false, timer: null, downAt: 0 },
	}
	// Post-release cooldown: a switch that bounces (or a tremor) re-presses
	// within this window; ignore it (the shipped hub's anti-bounce guard).
	const lastUp: Record<SwitchKey, number> = { space: -1e9, return: -1e9 }

	const clearTimer = (s: KeyState) => {
		if (s.timer !== null) {
			clearTimeout(s.timer)
			s.timer = null
		}
	}

	return {
		down(key) {
			const s = keys[key]
			if (s.held) return
			if (Date.now() - lastUp[key] < cooldownMs) return
			s.held = true
			s.thresholdFired = false
			s.downAt = Date.now()
			s.timer = setTimeout(() => {
				s.timer = null
				// Leaving thresholdFired false is the point: the release then
				// selects, instead of being consumed by a menu already open.
				if (key === 'return' && !canOpenMenu()) return
				s.thresholdFired = true
				emit(key === 'space' ? 'autostart' : 'menu')
			}, holdMs[key])
		},
		up(key) {
			const s = keys[key]
			if (!s.held) return
			clearTimer(s)
			s.held = false
			lastUp[key] = Date.now()
			if (s.thresholdFired) {
				s.thresholdFired = false
				// space: the release ends backward scanning without stepping.
				// return: this press already opened the menu, so the release is
				// consumed. Emitting 'select' here would close the menu on whatever
				// it opened under, and with Auto Scan on the overlay has already
				// stepped — the player would be dropped somewhere they never chose.
				if (key === 'space') emit('autostop')
			} else {
				emit(key === 'space' ? 'next' : 'select')
			}
		},
		heldFor(key) {
			const s = keys[key]
			return s.held ? Date.now() - s.downAt : 0
		},
		cancel() {
			for (const key of ['space', 'return'] as const) {
				const s = keys[key]
				clearTimer(s)
				if (s.held && s.thresholdFired && key === 'space') emit('autostop')
				s.held = false
				s.thresholdFired = false
			}
		},
	}
}

export function createSwitchInput(canOpenMenu?: () => boolean): SwitchInput {
	const cbs: Array<(e: SwitchEvent) => void> = []
	const machine = createSwitchMachine(
		(e) => {
			for (const cb of cbs) cb(e)
		},
		undefined,
		undefined,
		canOpenMenu,
	)

	const keyOf = (e: KeyboardEvent): SwitchKey | null => {
		if (e.code === 'Space') return 'space'
		if (e.code === 'Enter' || e.code === 'NumpadEnter') return 'return'
		return null
	}

	const onKeydown = (e: KeyboardEvent) => {
		const key = keyOf(e)
		if (key === null) return
		e.preventDefault() // the page must never scroll or re-click a focused button
		if (e.repeat) return // ignore keyboard auto-repeat
		machine.down(key)
	}

	const onKeyup = (e: KeyboardEvent) => {
		const key = keyOf(e)
		if (key === null) return
		e.preventDefault()
		machine.up(key)
	}

	const onBlur = () => machine.cancel()

	return {
		on(cb) {
			cbs.push(cb)
		},
		heldFor(key) {
			return machine.heldFor(key)
		},
		start() {
			window.addEventListener('keydown', onKeydown)
			window.addEventListener('keyup', onKeyup)
			window.addEventListener('blur', onBlur)
		},
		stop() {
			window.removeEventListener('keydown', onKeydown)
			window.removeEventListener('keyup', onKeyup)
			window.removeEventListener('blur', onBlur)
			machine.cancel()
		},
	}
}
