// 23 CC0 samples, decoded through a lazily-created AudioContext, plus a
// synthesised flight tone and cup beeper. The context is created on
// the first play() (autoplay policy) and resume()d whenever it is suspended.
// Every entry point is wrapped so this module NEVER throws, headless included.
//
// Beauty pass: everything runs quiet and warm through master → gentle high-shelf
// → soft compressor (no clipping when several sounds overlap). Scanning is
// musical (pentatonic marimba), bounces carry per-character signatures, and
// 'holed' stays the game's one beautiful sound.

import { HOLD_BEEP_F0, HOLD_BEEP_STEP } from '../tuning'
import type { SFX, SfxName, ShapeId } from '../types'

interface ToneOpts {
	freq: number
	freqEnd?: number
	type?: OscillatorType
	dur: number
	gain: number
	when?: number
	attack?: number
}

interface NoiseOpts {
	dur: number
	gain: number
	filter: BiquadFilterType
	freq: number
	freqEnd?: number
	q?: number
	when?: number
	attack?: number
}

const MIN_GAIN = 0.0001 // exponential ramps cannot reach 0

// Flight sonification: ONE quiet sine whose pitch follows the ball's height.
// Exponential Hz mapping so equal height steps sound like equal pitch steps.
const FLIGHT_F0 = 180 // Hz at level 0 (ground)
const FLIGHT_F1 = 900 // Hz at level 1 (apex)
const FLIGHT_GAIN = 0.045
const FLIGHT_GLIDE = 0.04 // s — setTargetAtTime constant for the pitch glide
const FLIGHT_GAIN_TC = 0.025 // s — gain rise/fall constant (~silent in 80 ms)

// C4 major pentatonic — the scanning scale. Focus walks up it by index,
// wrapping an octave up past the top, capped at A5 so it never turns shrill.
const PENTA = [261.63, 293.66, 329.63, 392.0, 440.0]
const PENTA_CAP = PENTA.length * 2 - 1 // top note A5 (880 Hz)

const pentaFreq = (index: number): number => {
	const i = Math.min(Math.max(Math.floor(index), 0), PENTA_CAP)
	const base = PENTA[i % PENTA.length] ?? PENTA[0] ?? 261.63
	return base * 2 ** Math.floor(i / PENTA.length)
}

/** Pentatonic index → playbackRate for the pitched pluck sample. */
const pentaRate = (index: number): number => {
	const f = pentaFreq(index)
	return f / (PENTA[0] ?? 261.63)
}

const cents = (freq: number, c: number): number => freq * 2 ** (c / 1200)

// ---------- recorded samples (public/sfx, all CC0) ----------
// Kenney Interface Sounds + Impact Sounds (kenney.nl, CC0) and two freesound.org
// CC0 recordings (splash 451126, whoosh 419341), converted to mono AAC.
// Samples load in the background after the first user gesture; until a buffer
// is ready (or if decoding fails) the synth below covers the same name.

const SAMPLES: Record<string, string[]> = {
	step: ['step.m4a'],
	pluck: ['pluck.m4a'], // focus — pitched via playbackRate
	select: ['select.m4a'],
	menu: ['menu.m4a'],
	swing: ['swing.m4a'],
	splash: ['splash.m4a'],
	roll: ['roll.m4a'],
	holed: ['holed.m4a'],
	tap: ['tap.m4a'],
	'bounce-sphere': ['bounce-sphere-1.m4a', 'bounce-sphere-2.m4a', 'bounce-sphere-3.m4a'],
	'bounce-cube': ['bounce-cube-1.m4a', 'bounce-cube-2.m4a'],
	'bounce-star': ['bounce-star-1.m4a', 'bounce-star-2.m4a', 'bounce-star-3.m4a'],
	'bounce-egg': ['bounce-egg-1.m4a', 'bounce-egg-2.m4a'],
	'bounce-disc': ['bounce-disc-1.m4a', 'bounce-disc-2.m4a'],
	'bounce-pancake': ['bounce-pancake-1.m4a', 'bounce-pancake-2.m4a'],
}

export const createSFX = (): SFX => {
	let ac: AudioContext | null = null
	let master: GainNode | null = null
	let noiseBuf: AudioBuffer | null = null
	let enabled = true
	let flight: { osc: OscillatorNode; g: GainNode } | null = null // kept for reuse
	let flightOn = false

	const ensure = (): { a: AudioContext; out: GainNode } | null => {
		if (ac && master) return { a: ac, out: master }
		const Ctor = typeof window !== 'undefined' ? window.AudioContext : undefined
		if (!Ctor) return null
		ac = new Ctor()
		master = ac.createGain()
		master.gain.value = 0.7
		// Warmth: shave the top end a little so nothing synthesized sounds glassy.
		const shelf = ac.createBiquadFilter()
		shelf.type = 'highshelf'
		shelf.frequency.value = 4500
		shelf.gain.value = -4
		// Safety: a soft compressor so overlapping sounds squeeze, never clip.
		const comp = ac.createDynamicsCompressor()
		comp.threshold.value = -14
		comp.knee.value = 24
		comp.ratio.value = 5
		comp.attack.value = 0.003
		comp.release.value = 0.25
		master.connect(shelf).connect(comp).connect(ac.destination)
		loadSamples(ac)
		return { a: ac, out: master }
	}

	// ---------- sample layer ----------

	const buffers = new Map<string, AudioBuffer[]>()
	let loading = false

	const loadSamples = (a: AudioContext): void => {
		if (loading || typeof fetch !== 'function') return
		loading = true
		const base =
			typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.BASE_URL : './'
		for (const [key, files] of Object.entries(SAMPLES)) {
			for (const file of files) {
				fetch(`${base}sfx/${file}`)
					.then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
					.then((ab) => a.decodeAudioData(ab))
					.then((buf) => {
						const arr = buffers.get(key) ?? []
						arr.push(buf)
						buffers.set(key, arr)
					})
					.catch(() => {}) // synth fallback keeps covering this name
			}
		}
	}

	/** Play a loaded sample; returns false when none is ready (synth covers). */
	const sample = (
		a: AudioContext,
		out: GainNode,
		key: string,
		opts?: { gain?: number; rate?: number; when?: number },
	): boolean => {
		const arr = buffers.get(key)
		if (!arr || arr.length === 0) return false
		const buf = arr[Math.floor(Math.random() * arr.length)]
		if (!buf) return false
		const src = a.createBufferSource()
		src.buffer = buf
		src.playbackRate.value = opts?.rate ?? 1
		const g = a.createGain()
		g.gain.value = opts?.gain ?? 1
		src.connect(g).connect(out)
		src.start(a.currentTime + (opts?.when ?? 0))
		return true
	}

	const noise = (a: AudioContext): AudioBuffer => {
		if (noiseBuf) return noiseBuf
		const len = a.sampleRate // 1 s of white noise, reused by every noise sound
		noiseBuf = a.createBuffer(1, len, a.sampleRate)
		const d = noiseBuf.getChannelData(0)
		for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
		return noiseBuf
	}

	const tone = (a: AudioContext, out: GainNode, o: ToneOpts): void => {
		const t0 = a.currentTime + (o.when ?? 0)
		const end = t0 + o.dur
		const osc = a.createOscillator()
		osc.type = o.type ?? 'sine'
		osc.frequency.setValueAtTime(o.freq, t0)
		if (o.freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(o.freqEnd, end)
		const g = a.createGain()
		g.gain.setValueAtTime(MIN_GAIN, t0)
		g.gain.exponentialRampToValueAtTime(o.gain, t0 + (o.attack ?? 0.005))
		g.gain.exponentialRampToValueAtTime(MIN_GAIN, end)
		osc.connect(g).connect(out)
		osc.start(t0)
		osc.stop(end + 0.05)
	}

	const noiseBurst = (a: AudioContext, out: GainNode, o: NoiseOpts): void => {
		const t0 = a.currentTime + (o.when ?? 0)
		const end = t0 + o.dur
		const src = a.createBufferSource()
		src.buffer = noise(a)
		const f = a.createBiquadFilter()
		f.type = o.filter
		f.Q.value = o.q ?? 0.8
		f.frequency.setValueAtTime(o.freq, t0)
		if (o.freqEnd !== undefined) f.frequency.exponentialRampToValueAtTime(o.freqEnd, end)
		const g = a.createGain()
		g.gain.setValueAtTime(MIN_GAIN, t0)
		g.gain.exponentialRampToValueAtTime(o.gain, t0 + (o.attack ?? 0.02))
		g.gain.exponentialRampToValueAtTime(MIN_GAIN, end)
		src.connect(f).connect(g).connect(out)
		src.start(t0)
		src.stop(end + 0.05)
	}

	/** Soft marimba hit: fast-decay fundamental + a quieter, quicker octave partial. */
	const marimba = (a: AudioContext, out: GainNode, freq: number, gain: number, when = 0): void => {
		tone(a, out, { freq, dur: 0.2, gain, when, attack: 0.003 })
		tone(a, out, { freq: freq * 2, dur: 0.09, gain: gain * 0.3, when, attack: 0.003 })
	}

	/** Per-character bounce signature. strength (0..1) scales gain and pitch. */
	const bounce = (a: AudioContext, out: GainNode, s: number, shape?: ShapeId): void => {
		switch (shape) {
			case 'cube': {
				// Dead low thud — filtered noise, instant attack, no ring.
				noiseBurst(a, out, {
					dur: 0.07,
					gain: 0.14 + 0.34 * s,
					filter: 'lowpass',
					freq: 140 + 120 * s,
					attack: 0.002,
				})
				break
			}
			case 'star': {
				// Springy upward boing, a hair of random detune so no two hits match.
				const base = (150 + 180 * s) * cents(1, (Math.random() * 2 - 1) * 60)
				tone(a, out, {
					freq: base,
					freqEnd: base * 2.6,
					type: 'triangle',
					dur: 0.16 + 0.1 * s,
					gain: 0.1 + 0.3 * s,
				})
				break
			}
			case 'egg': {
				// Wobbly warble — two detuned oscillators beating (~7 Hz) as they sag.
				const f = 160 + 120 * s
				const g = 0.06 + 0.17 * s
				tone(a, out, { freq: f, freqEnd: f * 0.8, dur: 0.24 + 0.1 * s, gain: g })
				tone(a, out, { freq: f + 7, freqEnd: f * 0.8 + 7, dur: 0.24 + 0.1 * s, gain: g })
				break
			}
			case 'disc': {
				// Short airy shimmer.
				noiseBurst(a, out, {
					dur: 0.12,
					gain: 0.07 + 0.18 * s,
					filter: 'bandpass',
					freq: 3200 + 1800 * s,
					q: 2,
					attack: 0.008,
				})
				break
			}
			case 'pancake': {
				// Soft flump — gentle attack, low and brief.
				noiseBurst(a, out, {
					dur: 0.14,
					gain: 0.09 + 0.2 * s,
					filter: 'lowpass',
					freq: 240,
					freqEnd: 120,
					attack: 0.02,
				})
				break
			}
			default: {
				// sphere (and shapeless callers): the clean thump.
				tone(a, out, {
					freq: 90 + 130 * s,
					freqEnd: 45,
					dur: 0.12 + 0.08 * s,
					gain: 0.12 + 0.4 * s,
				})
			}
		}
	}

	/** A plonk, then ONE clean piano-like note — the only beautiful sound here. */
	const holed = (a: AudioContext, out: GainNode): void => {
		tone(a, out, { freq: 260, freqEnd: 90, dur: 0.13, gain: 0.35 })
		// Felt-hammer thump under the note's onset.
		noiseBurst(a, out, {
			dur: 0.05,
			gain: 0.06,
			filter: 'lowpass',
			freq: 320,
			when: 0.3,
			attack: 0.004,
		})
		const f = 523.25 // C5 — still a single note
		const partials: Array<[number, number, number]> = [
			// [harmonic, gain, duration] — highs decay faster, like a struck string
			[1, 0.3, 2.6],
			[2, 0.13, 1.8],
			[3, 0.08, 1.2],
			[4, 0.05, 0.85],
			[5, 0.03, 0.6],
		]
		for (const [h, gain, dur] of partials) {
			// Stretch tuning: upper partials run slightly sharp, like a real string.
			const pf = f * h * (1 + 0.0004 * h * h)
			tone(a, out, { freq: pf, dur, gain, when: 0.3, attack: 0.01 })
			// A second, barely-detuned unison per partial — the slow chorus of
			// a piano's paired strings. Quieter so the note stays one voice.
			tone(a, out, { freq: cents(pf, 1.5), dur, gain: gain * 0.5, when: 0.3, attack: 0.01 })
		}
	}

	/** The continuous flight tone. Lazy: the oscillator is created on the first
	 *  non-null call and never destroyed — null (or disabled) just eases its
	 *  gain to 0 so stopping mid-glide never clicks. */
	const flightTone = (level: number | null): void => {
		if (level === null || !enabled) {
			if (flight && ac) flight.g.gain.setTargetAtTime(0, ac.currentTime, FLIGHT_GAIN_TC)
			flightOn = false
			return
		}
		const ok = ensure()
		if (!ok) return
		const { a, out } = ok
		if (a.state === 'suspended') a.resume().catch(() => {})
		if (!flight) {
			const osc = a.createOscillator()
			osc.type = 'sine'
			const g = a.createGain()
			g.gain.value = 0
			osc.connect(g).connect(out)
			osc.start()
			flight = { osc, g }
		}
		const l = Math.min(Math.max(level, 0), 1)
		const f = FLIGHT_F0 * (FLIGHT_F1 / FLIGHT_F0) ** l
		const t = a.currentTime
		if (flightOn) {
			flight.osc.frequency.setTargetAtTime(f, t, FLIGHT_GLIDE) // smooth, no zipper
		} else {
			// (re)starting from silence: snap the pitch so it doesn't swoop in
			// from wherever the last flight left it
			flight.osc.frequency.setValueAtTime(f, t)
			flightOn = true
		}
		flight.g.gain.setTargetAtTime(FLIGHT_GAIN, t, FLIGHT_GAIN_TC)
	}

	const trigger = (name: SfxName, strength: number, index?: number, shape?: ShapeId): void => {
		const ok = ensure()
		if (!ok) return
		const { a, out } = ok
		if (a.state === 'suspended') a.resume().catch(() => {})
		switch (name) {
			case 'step':
				if (sample(a, out, 'step', { gain: 0.5 })) break
				tone(a, out, { freq: 620, type: 'triangle', dur: 0.05, gain: 0.12 })
				break
			case 'focus':
				if (index !== undefined) {
					// Scanning walks up the pentatonic — position becomes pitch.
					if (sample(a, out, 'pluck', { gain: 0.55, rate: pentaRate(index) })) break
					marimba(a, out, pentaFreq(index), 0.22)
				} else {
					if (sample(a, out, 'step', { gain: 0.5, rate: 1.35 })) break
					tone(a, out, { freq: 880, type: 'triangle', dur: 0.05, gain: 0.15 })
				}
				break
			case 'select': {
				if (sample(a, out, 'select', { gain: 0.55 })) break
				// A resolved cadence: the focused pitch, then a dyad on its fifth.
				const p = pentaFreq(index ?? 0)
				marimba(a, out, p, 0.2)
				marimba(a, out, p * 1.5, 0.22, 0.1)
				marimba(a, out, p, 0.09, 0.1)
				break
			}
			case 'swing':
				if (sample(a, out, 'swing', { gain: 0.6, rate: 1.1 })) break
				noiseBurst(a, out, {
					dur: 0.5,
					gain: 0.45,
					filter: 'bandpass',
					freq: 250,
					freqEnd: 1600,
					attack: 0.18,
				})
				break
			case 'bounce': {
				// Recorded per-character impacts; strength drives gain + a pitch nudge.
				const jitter = shape === 'star' ? 0.12 : 0.04
				const rate = (0.92 + 0.2 * strength) * (1 + (Math.random() * 2 - 1) * jitter)
				if (
					sample(a, out, `bounce-${shape ?? 'sphere'}`, {
						gain: 0.25 + 0.6 * strength,
						rate,
					})
				)
					break
				bounce(a, out, strength, shape)
				break
			}
			case 'splash':
				if (sample(a, out, 'splash', { gain: 0.7 })) break
				noiseBurst(a, out, {
					dur: 0.65,
					gain: 0.5,
					filter: 'lowpass',
					freq: 3000,
					freqEnd: 250,
				})
				break
			case 'roll':
				if (sample(a, out, 'roll', { gain: 0.3, rate: 0.7 })) break
				noiseBurst(a, out, {
					dur: 0.35,
					gain: 0.16,
					filter: 'lowpass',
					freq: 180,
					attack: 0.04,
				})
				break
			case 'holed':
				// The bell sample is the plonk; the single synthesized piano note
				// underneath stays — it is the game's one composed sound.
				sample(a, out, 'holed', { gain: 0.5, rate: 1.2 })
				holed(a, out)
				break
			case 'menu':
				if (sample(a, out, 'menu', { gain: 0.5 })) break
				tone(a, out, { freq: 520, type: 'triangle', dur: 0.07, gain: 0.15 })
				break
			case 'beep': {
				// The cup beeper. Stateless — the caller sets urgency by rate.
				// ±5 cents so rapid repeats breathe instead of ringing sterile.
				const f = cents(1318.51, (Math.random() * 2 - 1) * 5) // ~E6
				tone(a, out, { freq: f, dur: 0.06, gain: 0.13, attack: 0.012 })
				break
			}
			case 'tap':
				// Penny's yes — one real woodblock tap.
				if (sample(a, out, 'tap', { gain: 0.6 })) break
				tone(a, out, { freq: 690, freqEnd: 640, dur: 0.09, gain: 0.28, attack: 0.002 })
				tone(a, out, { freq: 1380, dur: 0.03, gain: 0.07, attack: 0.001 })
				break
		}
	}

	return {
		play(name: SfxName, opts?: { strength?: number; index?: number; shape?: ShapeId }): void {
			if (!enabled) return
			try {
				const s = Math.min(Math.max(opts?.strength ?? 0.6, 0), 1)
				trigger(name, s, opts?.index, opts?.shape)
			} catch {
				// never throw — audio is a nicety, not a dependency
			}
		},
		tone(level: number | null): void {
			try {
				flightTone(level)
			} catch {
				// never throw — audio is a nicety, not a dependency
			}
		},
		// §4's audible half of the hold gesture: one blip per whole second, each a
		// step higher, so a player with their eyes shut can hear the hold building
		// rather than counting in the dark and concluding the switch is dead.
		holdBeep(step: number): void {
			try {
				if (!enabled) return
				const ok = ensure()
				if (!ok) return
				const { a, out } = ok
				if (a.state === 'suspended') a.resume().catch(() => {})
				tone(a, out, {
					freq: HOLD_BEEP_F0 + Math.max(0, step) * HOLD_BEEP_STEP,
					dur: 0.09,
					gain: 0.1,
					type: 'square',
				})
			} catch {
				// never throw — audio is a nicety, not a dependency
			}
		},
		setEnabled(on: boolean): void {
			enabled = on
			if (!on) {
				try {
					flightTone(null) // silence a running flight tone immediately
				} catch {
					// never throw
				}
			}
		},
	}
}
