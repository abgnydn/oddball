// Switch input — NARBE grammar (DESIGN.md "Input grammar", do not deviate).
// Space release (held < SPACE_HOLD_MS) = 'next'. Space held to the threshold =
// 'autostart' (fired AT the threshold); its eventual release = 'autostop', not
// 'next'. Return release (held < RETURN_HOLD_MS) = 'select'. Return held to
// the threshold = 'menu' (fired AT the threshold); its eventual release is
// swallowed. Both keys are tracked independently.

import { RETURN_HOLD_MS, SPACE_HOLD_MS } from '../tuning'
import type { SwitchEvent, SwitchInput } from '../types'

type SwitchKey = 'space' | 'return'

export interface SwitchMachine {
	down(key: SwitchKey): void
	up(key: SwitchKey): void
	/** Blur/stop: drop held keys and cancel pending threshold timers without
	 *  firing press events. If auto-scan is active it emits 'autostop' so the
	 *  scanner never keeps stepping after the keyup is lost. */
	cancel(): void
}

interface KeyState {
	held: boolean
	thresholdFired: boolean
	timer: ReturnType<typeof setTimeout> | null
}

/** Timing state machine behind createSwitchInput — exported so headless tests
 *  can drive it with short thresholds. Production uses the tuning defaults. */
export function createSwitchMachine(
	emit: (e: SwitchEvent) => void,
	holdMs: { space: number; return: number } = { space: SPACE_HOLD_MS, return: RETURN_HOLD_MS },
): SwitchMachine {
	const keys: Record<SwitchKey, KeyState> = {
		space: { held: false, thresholdFired: false, timer: null },
		return: { held: false, thresholdFired: false, timer: null },
	}

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
			s.held = true
			s.thresholdFired = false
			s.timer = setTimeout(() => {
				s.timer = null
				s.thresholdFired = true
				emit(key === 'space' ? 'autostart' : 'menu')
			}, holdMs[key])
		},
		up(key) {
			const s = keys[key]
			if (!s.held) return
			clearTimer(s)
			s.held = false
			if (s.thresholdFired) {
				s.thresholdFired = false
				if (key === 'space') emit('autostop')
				// return: the keyup after 'menu' is swallowed
			} else {
				emit(key === 'space' ? 'next' : 'select')
			}
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

export function createSwitchInput(): SwitchInput {
	const cbs: Array<(e: SwitchEvent) => void> = []
	const machine = createSwitchMachine((e) => {
		for (const cb of cbs) cb(e)
	})

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
