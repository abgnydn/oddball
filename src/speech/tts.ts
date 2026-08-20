// speechSynthesis wrapper. Every utterance is console.log-ed as `[tts] <text>`
// and mirrored to the caption callbacks even when speech is disabled or
// speechSynthesis is missing (the harnesses grep for the log). Never throws in
// node. One utterance at most — new speech interrupts old, no queue.

import type { TTS } from '../types'

export function createTTS(): TTS {
	let rate = 1
	let volume = 1
	let enabled = true
	// Chrome can garbage-collect an in-flight utterance and cut it off — hold a
	// reference until it ends.
	let current: SpeechSynthesisUtterance | null = null
	const captionCbs: Array<(text: string) => void> = []
	// Auto Scan suspends its timer while a holding utterance is in flight.
	let holding = false
	const holdCbs: Array<(on: boolean) => void> = []
	let holdWatchdog: ReturnType<typeof setTimeout> | null = null
	const fireHold = (on: boolean) => {
		if (holding === on) return
		holding = on
		for (const cb of holdCbs) cb(on)
	}
	/** Raise or drop the scan hold. `text` arms a watchdog sized to the utterance.
	 *  Some browsers fire onstart and then never fire onend — headless Chromium
	 *  does, and Chrome has a long-standing bug for long utterances. Without the
	 *  watchdog the highlight would stop advancing for good and a hands-free
	 *  player would be stranded. Resuming early is recoverable; stranding is not. */
	const setHold = (on: boolean, text = '') => {
		if (holdWatchdog !== null) {
			clearTimeout(holdWatchdog)
			holdWatchdog = null
		}
		if (on) {
			const ms = Math.min(30000, (1500 + text.length * 90) / Math.max(rate, 0.5))
			holdWatchdog = setTimeout(() => {
				holdWatchdog = null
				fireHold(false)
			}, ms)
		}
		fireHold(on)
	}

	const synth = (): SpeechSynthesis | null =>
		typeof speechSynthesis === 'undefined' ? null : speechSynthesis

	const stop = () => {
		current = null
		setHold(false)
		synth()?.cancel()
	}

	return {
		speak(text, opts) {
			console.log(`[tts] ${text}`)
			const queued = opts?.interrupt === false
			const wantHold = opts?.hold !== false
			const fireCaption = () => {
				for (const cb of captionCbs) cb(text)
			}
			const s = synth()
			if (!s || !enabled) {
				fireCaption()
				return
			}
			if (!queued) {
				s.cancel()
				fireCaption()
				if (!wantHold) setHold(false)
			}
			const u = new SpeechSynthesisUtterance(text)
			u.rate = rate
			u.volume = volume
			const done = () => {
				// Guarded on identity: cancel() fires the OUTGOING utterance's onend
				// asynchronously, after `current` already points at this one.
				if (current === u) {
					current = null
					setHold(false)
				}
			}
			// Queued speech waits its turn — the caption swaps when IT starts,
			// so a celebration's caption is not trampled by the next hole's intro.
			if (queued) {
				u.onstart = () => {
					fireCaption()
					if (wantHold) setHold(true, text)
				}
			} else if (wantHold) setHold(true, text)
			u.onend = done
			u.onerror = done
			current = u
			s.speak(u)
			s.resume() // Chrome quirk: the synth can be left paused after cancel()
		},
		stop,
		setRate(r) {
			rate = Math.min(2, Math.max(0.5, r))
		},
		setVolume(v) {
			volume = Math.min(1, Math.max(0, v))
		},
		setEnabled(on) {
			enabled = on
			if (!on) stop()
		},
		onCaption(cb) {
			captionCbs.push(cb)
		},
		onHoldChange(cb) {
			holdCbs.push(cb)
		},
	}
}
