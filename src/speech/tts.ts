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

	const synth = (): SpeechSynthesis | null =>
		typeof speechSynthesis === 'undefined' ? null : speechSynthesis

	const stop = () => {
		current = null
		synth()?.cancel()
	}

	return {
		speak(text, opts) {
			console.log(`[tts] ${text}`)
			const queued = opts?.interrupt === false
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
			}
			const u = new SpeechSynthesisUtterance(text)
			u.rate = rate
			u.volume = volume
			const done = () => {
				if (current === u) current = null
			}
			// Queued speech waits its turn — the caption swaps when IT starts,
			// so a celebration's caption is not trampled by the next hole's intro.
			if (queued) u.onstart = fireCaption
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
	}
}
