// The game state machine. One scanner drives every screen; the context menu
// swaps the scan list and restores the underlying screen's highlight on close
// (focus restoration per DESIGN.md). Auto-saves on every state-changing selection.
//
// Modes: 1P and pass-and-play 2P rounds over a picked course, single-hole rounds
// on holes built in the editor, and the practice range (no cup, no score).

import { flatReach } from '../sim/physics'
import { mulberry32 } from '../sim/rng'
import {
	COURSES,
	DWELL_MS,
	EDITOR_OPTIONS,
	INPUT_COOLDOWN_MS,
	MAX_CUSTOM_HOLES,
	MAX_STROKES,
	nextScanMs,
	RANGE,
	SHAPE_ORDER,
} from '../tuning'
import type {
	BallState,
	CustomHole,
	EditorParams,
	FlightPoint,
	HoleSpec,
	Renderer,
	RoundSave,
	SaveAPI,
	Scanner,
	Settings,
	SFX,
	ShapeId,
	Sim,
	SwitchEvent,
	TTS,
} from '../types'
import type { Hud, HudItemSpec } from '../ui/hud'
import { composeHole, estimatePar } from './composer'
import * as L from './lines'

interface Deps {
	hud: Hud
	scanner: Scanner
	tts: TTS
	sfx: SFX
	renderer: Renderer
	sim: Sim
	save: SaveAPI
}

interface Round {
	players: 1 | 2
	player: number
	course: number // -1 = custom single-hole round
	customHole?: HoleSpec
	holeIdx: number
	strokes: number[][] // [player][holeIdx]
	ball: BallState
	seed: number
	highlight: number
}

type ScreenKind =
	| 'title'
	| 'help'
	| 'settings'
	| 'courses'
	| 'myholes'
	| 'holemenu'
	| 'editor'
	| 'range'
	| 'rack'
	| 'flight'
	| 'summary'

export interface Flow {
	start(): void
	onSwitch(e: SwitchEvent): void
}

const TEE: BallState = { x: 0, lie: 'fairway' }
const DEFAULT_DRAFT: EditorParams = { length: 1, hills: 0, water: 0, sand: 0, wind: 2 }

export function createFlow(deps: Deps): Flow {
	const { hud, scanner, tts, sfx, renderer, sim, save } = deps

	const loaded = save.load()
	let settings: Settings = loaded.settings
	const customHoles: CustomHole[] = loaded.customHoles ?? []
	let editorDraft: EditorParams = loaded.editorDraft ?? { ...DEFAULT_DRAFT }
	let best: Record<string, number> = loaded.best ?? {}

	let round: Round | null = null
	let screen: ScreenKind = 'title'
	let selectHandler: (id: string, index: number) => void = () => {}
	let overlaySelect: (id: string, index: number) => void = () => {}
	let announceOverride: string | null = null
	let underlayRestore: (() => void) | null = null
	let rebuildCurrent: (index: number) => void = () => title()
	let flightToken = 0
	let flightPaused = false
	let rangeRng = 1
	let armedDeleteAt = 0 // see armedAt in openMenu: a confirm is not a bounce
	// The previous stroke's story: its flight path stays as a faded ghost, and
	// the resting ball keeps the shape you chose until you choose again.
	let lastTrail: FlightPoint[] | null = null
	let lastShape: ShapeId | null = null

	const reachOf = new Map<ShapeId, number>()
	const reach = (id: ShapeId): number => {
		let r = reachOf.get(id)
		if (r === undefined) {
			r = flatReach(id)
			reachOf.set(id, r)
		}
		return r
	}

	// ---------- plumbing ----------

	const holesOf = (r: Round): HoleSpec[] =>
		r.customHole ? [r.customHole] : (COURSES[r.course]?.holes ?? [])

	const curHole = (): HoleSpec | undefined => (round ? holesOf(round)[round.holeIdx] : undefined)

	const curStrokes = (): number => round?.strokes[round.player]?.[round.holeIdx] ?? 0

	const applySettings = (): void => {
		hud.applySettings(settings)
		tts.setEnabled(settings.ttsOn)
		tts.setRate(settings.ttsRate)
		tts.setVolume(settings.ttsVolume)
		sfx.setEnabled(settings.audioCues)
		scanner.setScanMs(settings.scanMs)
		scanner.setDwell(settings.dwell === 'off' ? null : DWELL_MS[settings.dwell])
		scanner.setAutoScan(settings.autoScan)
		renderer.setTheme(settings.theme)
	}

	/** ballOverride: persist a known end state (strike time) without mutating the
	 *  in-memory ball, so a tab close mid-flight resumes at the true position. */
	const persist = (ballOverride?: BallState): void => {
		const data: Parameters<SaveAPI['save']>[0] = {
			settings,
			customHoles,
			editorDraft,
			best,
		}
		if (round) {
			const ball = ballOverride ?? round.ball
			const r: RoundSave = {
				players: round.players,
				player: round.player,
				course: round.course,
				hole: round.holeIdx,
				strokes: round.strokes,
				ballX: ball.x,
				lie: ball.lie,
				highlight: round.highlight,
				seed: round.seed,
			}
			if (round.customHole) r.customHole = round.customHole
			data.round = r
		} else {
			const stored = save.load().round
			if (stored) data.round = stored // never clobber a stored round from menus
		}
		save.save(data)
	}

	/** Set the scan list. The first focus announcement can be overridden (hole
	 *  intro, shot result) — after that, focus speaks each item normally.
	 *  queued: the announcement waits for current speech instead of cutting it
	 *  (the two-beat hole-out: the cheer finishes, THEN the next intro). */
	const show = (
		kind: ScreenKind,
		specs: HudItemSpec[],
		onSelect: (id: string, index: number) => void,
		opts?: {
			announce?: string
			queued?: boolean
			startIndex?: number
			rebuild?: (index: number) => void
		},
	): void => {
		screen = kind
		selectHandler = onSelect
		announceOverride = opts?.announce ?? null
		announceQueued = opts?.queued === true
		if (opts?.rebuild) rebuildCurrent = opts.rebuild
		const items = hud.scanList(specs)
		hud.showPanel(true)
		scanner.setItems(items, { startIndex: opts?.startIndex ?? 0 })
	}

	let announceQueued = false

	scanner.onFocus((item, index) => {
		if (item === null) {
			hud.footerFocus('')
			return
		}
		hud.footerFocus(item.label)
		if (announceOverride !== null) {
			tts.speak(announceOverride, { interrupt: !announceQueued })
			announceOverride = null
			announceQueued = false
			return
		}
		sfx.play('focus', { index }) // pitch walks up the scale with the list
		// Ordinary labels must not gate the scan, or speech length would replace
		// the player's chosen speed. Warnings are the exception: an armed
		// "this will throw your round away" must be heard in full.
		tts.speak(item.speak, { hold: item.hold === true })
	})

	scanner.onSelect((item, index) => {
		sfx.play('select', { index })
		if (hud.overlayOpen()) overlaySelect(item.id, index)
		else selectHandler(item.id, index)
	})

	// ---------- title / help ----------

	const title = (startIndex = 0, welcome = false): void => {
		round = null
		const saved = save.load().round
		hud.setScreen('') // the title IS the screen name — no duplicate slot
		hud.setMode('Menu')
		const firstHole = COURSES[0]?.holes[0]
		if (firstHole) renderer.drawIdle(firstHole, TEE, 'sphere')
		const specs: HudItemSpec[] = []
		if (saved) specs.push({ id: 'continue', label: L.MENU.continue, speak: L.MENU.continueSpeak })
		specs.push(
			{ id: 'play', label: L.MENU.play, speak: L.MENU.playSpeak },
			{ id: 'friend', label: L.MENU.friend, speak: L.MENU.friendSpeak },
			{ id: 'practice', label: L.MENU.practice, speak: L.MENU.practiceSpeak },
			{ id: 'editor', label: L.MENU.makeHole, speak: L.MENU.makeHoleSpeak },
			{ id: 'help', label: L.MENU.help, speak: L.MENU.helpSpeak },
			{ id: 'settings', label: L.MENU.settings, speak: L.MENU.settingsSpeak },
		)
		const opts: { announce?: string; startIndex?: number; rebuild?: (i: number) => void } = {
			startIndex,
			rebuild: (i) => title(i),
		}
		if (welcome) opts.announce = L.WELCOME
		const back = (id: string): number => specs.findIndex((s) => s.id === id)
		show(
			'title',
			specs,
			(id) => {
				if (id === 'continue' && saved) resumeRound(saved)
				else if (id === 'play') coursePick(1)
				else if (id === 'friend') coursePick(2)
				else if (id === 'practice') range()
				else if (id === 'editor') editor()
				else if (id === 'help') help(() => title(back('help')))
				else if (id === 'settings') settingsScreen(() => title(back('settings')))
			},
			opts,
		)
	}

	let helpGoBack: () => void = () => title()

	const help = (goBack?: () => void, startIndex = 0): void => {
		if (goBack) helpGoBack = goBack
		hud.setScreen('How to Play')
		hud.setMode('Help')
		const pages = L.helpPages(settings.characters)
		const specs: HudItemSpec[] = pages.map((p, i) => ({
			id: `page-${i}`,
			label: p.label,
			speak: `${p.label}. Press Enter to hear it.`,
		}))
		specs.push({ id: 'back', label: L.MENU.back, speak: L.MENU.backSpeak })
		show(
			'help',
			specs,
			(id, index) => {
				if (id === 'back') {
					helpGoBack()
					return
				}
				const page = pages[index]
				if (page) tts.speak(page.speak)
			},
			{ startIndex, rebuild: (i) => help(undefined, i) },
		)
	}

	// ---------- settings ----------

	interface Row {
		id: string
		label: string
		value: () => string
		cycle: () => void
	}

	let settingsGoBack: () => void = () => title()

	const settingsScreen = (goBack: () => void, startIndex = 0): void => {
		settingsGoBack = goBack
		hud.setScreen('Settings')
		hud.setMode('Settings')
		const rows: Row[] = [
			{
				id: 'tts',
				label: L.SETTINGS_LABELS.tts,
				value: () => (settings.ttsOn ? 'on' : 'off'),
				cycle: () => {
					settings = { ...settings, ttsOn: !settings.ttsOn }
				},
			},
			{
				id: 'rate',
				label: L.SETTINGS_LABELS.rate,
				value: () =>
					settings.ttsRate <= 0.8 ? 'slow' : settings.ttsRate >= 1.3 ? 'fast' : 'normal',
				cycle: () => {
					const next = settings.ttsRate <= 0.8 ? 1 : settings.ttsRate >= 1.3 ? 0.8 : 1.3
					settings = { ...settings, ttsRate: next }
				},
			},
			{
				id: 'volume',
				label: L.SETTINGS_LABELS.volume,
				value: () => (settings.ttsVolume < 1 ? 'soft' : 'full'),
				cycle: () => {
					settings = { ...settings, ttsVolume: settings.ttsVolume < 1 ? 1 : 0.5 }
				},
			},
			{
				id: 'characters',
				label: L.SETTINGS_LABELS.characters,
				value: () => (settings.characters ? 'on' : 'off'),
				cycle: () => {
					settings = { ...settings, characters: !settings.characters }
				},
			},
			{
				id: 'scan',
				label: L.SETTINGS_LABELS.scan,
				value: () => {
					const s = settings.scanMs / 1000
					const n = Number.isInteger(s) ? String(s) : s.toFixed(1)
					return `${n} ${settings.scanMs === 1000 ? 'second' : 'seconds'}`
				},
				cycle: () => {
					settings = { ...settings, scanMs: nextScanMs(settings.scanMs) }
				},
			},
			{
				id: 'auto',
				label: L.SETTINGS_LABELS.auto,
				value: () => (settings.autoScan ? 'on — one switch' : 'off — two switches'),
				cycle: () => {
					settings = { ...settings, autoScan: !settings.autoScan }
				},
			},
			{
				id: 'dwell',
				label: L.SETTINGS_LABELS.dwell,
				value: () => settings.dwell,
				cycle: () => {
					const order = ['off', 'slow', 'fast'] as const
					const i = order.indexOf(settings.dwell)
					settings = { ...settings, dwell: order[(i + 1) % order.length] ?? 'off' }
				},
			},
			{
				id: 'font',
				label: L.SETTINGS_LABELS.font,
				value: () => `${settings.fontScale} percent`,
				cycle: () => {
					const order = [100, 125, 150, 175, 200] as const
					const i = order.indexOf(settings.fontScale)
					settings = { ...settings, fontScale: order[(i + 1) % order.length] ?? 125 }
				},
			},
			{
				id: 'theme',
				label: L.SETTINGS_LABELS.theme,
				value: () =>
					settings.theme === 'high-contrast'
						? 'high contrast'
						: settings.theme === 'warm'
							? 'warm colors'
							: settings.theme,
				cycle: () => {
					const order = ['high-contrast', 'light', 'dark', 'warm'] as const
					const i = order.indexOf(settings.theme)
					settings = { ...settings, theme: order[(i + 1) % order.length] ?? 'high-contrast' }
				},
			},
			{
				id: 'highlight',
				label: L.SETTINGS_LABELS.highlight,
				value: () => settings.highlightThick,
				cycle: () => {
					const order = ['thin', 'medium', 'thick'] as const
					const i = order.indexOf(settings.highlightThick)
					settings = { ...settings, highlightThick: order[(i + 1) % order.length] ?? 'medium' }
				},
			},
			{
				id: 'audio',
				label: L.SETTINGS_LABELS.audio,
				value: () => (settings.audioCues ? 'on' : 'off'),
				cycle: () => {
					settings = { ...settings, audioCues: !settings.audioCues }
				},
			},
			{
				id: 'tone',
				label: L.SETTINGS_LABELS.tone,
				value: () => (settings.flightTone ? 'on' : 'off'),
				cycle: () => {
					settings = { ...settings, flightTone: !settings.flightTone }
				},
			},
			{
				id: 'motion',
				label: L.SETTINGS_LABELS.motion,
				value: () => (settings.reduceMotion ? 'off' : 'on'),
				cycle: () => {
					settings = { ...settings, reduceMotion: !settings.reduceMotion }
				},
			},
		]
		const specs: HudItemSpec[] = rows.map((r) => {
			const speakFn = L.settingValueSpeak[r.id]
			const spoken = speakFn ? speakFn(r.value()) : r.value()
			return {
				id: r.id,
				label: `${r.label}: ${r.value()}`,
				speak: `${spoken} Press Enter to change this setting.`,
			}
		})
		specs.push({ id: 'back', label: L.MENU.back, speak: L.MENU.backSpeak })
		show(
			'settings',
			specs,
			(id, index) => {
				if (id === 'back') {
					goBack()
					return
				}
				const row = rows[index]
				if (!row) return
				row.cycle()
				applySettings()
				persist()
				settingsScreen(goBack, index) // re-render; focus re-announces the new value
			},
			{ startIndex, rebuild: (i) => settingsScreen(settingsGoBack, i) },
		)
	}

	// ---------- course / custom-hole pickers ----------

	const coursePick = (players: 1 | 2, startIndex = 0): void => {
		hud.setScreen(players === 2 ? 'Two players' : 'Pick a course')
		hud.setMode('Menu')
		const specs: HudItemSpec[] = COURSES.map((c, i) => ({
			id: `course-${i}`,
			label: c.name,
			speak: L.courseFocus(c.name, c.blurb, players === 1 ? best[c.name] : undefined),
		}))
		if (customHoles.length > 0)
			specs.push({ id: 'myholes', label: L.MENU.myHoles, speak: L.MENU.myHolesSpeak })
		specs.push({ id: 'back', label: L.MENU.back, speak: L.MENU.backSpeak })
		show(
			'courses',
			specs,
			(id, index) => {
				if (id === 'back') {
					title()
					return
				}
				if (id === 'myholes') {
					myHoles(players)
					return
				}
				newRound(players, index)
			},
			{ startIndex, rebuild: (i) => coursePick(players, i) },
		)
	}

	const myHoles = (players: 1 | 2, startIndex = 0): void => {
		hud.setScreen('My Holes')
		hud.setMode('Menu')
		const specs: HudItemSpec[] = customHoles.map((h, i) => ({
			id: `hole-${i}`,
			label: h.name,
			speak: `${h.name}. Press Enter for choices.`,
		}))
		specs.push({ id: 'back', label: L.MENU.back, speak: L.MENU.backSpeak })
		show(
			'myholes',
			specs,
			(id, index) => {
				if (id === 'back') {
					coursePick(players)
					return
				}
				holeMenu(players, index)
			},
			{ startIndex, rebuild: (i) => myHoles(players, i) },
		)
	}

	// armDelete: a hole someone built by hand is the only player-made thing in
	// the game, and it was going away on one select. Two-step, like New round.
	const holeMenu = (players: 1 | 2, holeIdx: number, startIndex = 0, armDelete = false): void => {
		const custom = customHoles[holeIdx]
		if (!custom) {
			myHoles(players)
			return
		}
		hud.setScreen(custom.name)
		hud.setMode('Menu')
		const specs: HudItemSpec[] = [
			{ id: 'play', label: L.MENU.playThis, speak: L.MENU.playThisSpeak },
			armDelete
				? {
						id: 'delete',
						label: L.MENU.deleteArmed,
						speak: L.MENU.deleteArmedSpeak,
						hold: true,
					}
				: { id: 'delete', label: L.MENU.deleteThis, speak: L.MENU.deleteThisSpeak },
			{ id: 'back', label: L.MENU.back, speak: L.MENU.backSpeak },
		]
		show(
			'holemenu',
			specs,
			(id, index) => {
				if (id === 'play') {
					playCustom(players, custom)
				} else if (id === 'delete') {
					if (!armDelete) {
						armedDeleteAt = Date.now()
						holeMenu(players, holeIdx, index, true)
						return
					}
					if (Date.now() - armedDeleteAt < INPUT_COOLDOWN_MS) return
					customHoles.splice(holeIdx, 1)
					persist()
					tts.speak(L.holeDeleted(custom.name))
					myHoles(players)
				} else {
					myHoles(players, holeIdx)
				}
			},
			{ startIndex, rebuild: (i) => holeMenu(players, holeIdx, i, armDelete) },
		)
	}

	const playCustom = (players: 1 | 2, custom: CustomHole): void => {
		tts.speak(L.ESTIMATING)
		setTimeout(() => {
			const hole = composeHole(custom.params)
			hole.name = custom.name
			hole.par = estimatePar(hole)
			newRound(players, -1, hole)
		}, 50)
	}

	// ---------- the editor ----------

	const editor = (startIndex = 0): void => {
		hud.setScreen('Make a Hole')
		hud.setMode('Editor')
		renderer.drawIdle(composeHole(editorDraft), TEE, null) // live preview
		const keys = ['length', 'hills', 'water', 'sand', 'wind'] as const
		const optionLabel = (k: (typeof keys)[number]): string => {
			const table = EDITOR_OPTIONS[k] as ReadonlyArray<{ label: string }>
			const i = editorDraft[k] % table.length
			return table[i]?.label ?? ''
		}
		const specs: HudItemSpec[] = keys.map((k) => ({
			id: `opt-${k}`,
			label: `${L.EDITOR_ROW_LABELS[k]}: ${optionLabel(k)}`,
			speak: `${L.EDITOR_ROW_LABELS[k]}: ${optionLabel(k)}. Press Enter to change it.`,
		}))
		specs.push(
			{ id: 'hear', label: L.MENU.hearHole, speak: L.MENU.hearHoleSpeak },
			{ id: 'play', label: L.MENU.playMyHole, speak: L.MENU.playMyHoleSpeak },
			{ id: 'save', label: L.MENU.saveMyHole, speak: L.MENU.saveMyHoleSpeak },
			{ id: 'back', label: L.MENU.back, speak: L.MENU.backSpeak },
		)
		show(
			'editor',
			specs,
			(id, index) => {
				if (id.startsWith('opt-')) {
					const k = id.slice(4) as (typeof keys)[number]
					const table = EDITOR_OPTIONS[k] as ReadonlyArray<{ label: string }>
					editorDraft = { ...editorDraft, [k]: (editorDraft[k] + 1) % table.length }
					persist()
					editor(index)
					return
				}
				if (id === 'hear') {
					tts.speak(L.editorDescribe(keys.map((k) => optionLabel(k))))
					return
				}
				if (id === 'play') {
					tts.speak(L.ESTIMATING)
					setTimeout(() => {
						const hole = composeHole(editorDraft)
						hole.par = estimatePar(hole)
						newRound(1, -1, hole)
					}, 50)
					return
				}
				if (id === 'save') {
					if (customHoles.length >= MAX_CUSTOM_HOLES) {
						tts.speak(L.BOOK_FULL)
						return
					}
					const name = `My Hole ${customHoles.length + 1}`
					customHoles.push({ name, params: { ...editorDraft } })
					persist()
					tts.speak(L.holeSaved(name))
					return
				}
				title()
			},
			{ startIndex, rebuild: (i) => editor(i) },
		)
	}

	// ---------- the practice range ----------

	const range = (announce?: string, startIndex = 0): void => {
		round = null
		if (announce === undefined) {
			lastTrail = null
			lastShape = null
		}
		hud.setScreen('The Range')
		hud.setMode('Practice')
		renderer.drawIdle(RANGE, TEE, lastShape, lastTrail ?? undefined)
		const specs: HudItemSpec[] = [
			{ id: 'back', label: L.MENU.back, speak: L.MENU.backSpeak },
			...SHAPE_ORDER.map((id) => ({
				id,
				label: L.shapeName(id, settings.characters),
				speak: L.shapeFocus(id, reach(id), settings.characters),
				glyph: id,
			})),
			// The range is gameplay, so §12's scannable pause applies here too.
			// It was in the round rack only, which made the "no screen needs a
			// hold" claim false for everyone who cannot sustain one — in the mode
			// most likely to be someone's FIRST screen.
			{ id: 'menu', label: L.MENU.openMenu, speak: L.MENU.openMenuSpeakNoRound },
		]
		const opts: { announce?: string; startIndex?: number; rebuild?: (i: number) => void } = {
			startIndex,
			rebuild: (i) => range(undefined, i),
		}
		opts.announce = announce ?? RANGE.intro
		show(
			'range',
			specs,
			(id) => {
				if (id === 'back') {
					title()
					return
				}
				if (id === 'menu') {
					openMenu()
					return
				}
				rangeStrike(id as ShapeId)
			},
			opts,
		)
	}

	const rangeStrike = (id: ShapeId): void => {
		screen = 'flight'
		flightPaused = false
		scanner.clear()
		hud.showPanel(false)
		hud.setMode('Watch!')
		tts.speak(L.shapeConfirm(id, settings.characters))
		sfx.play('swing')
		rangeRng = (rangeRng + 1) | 0
		const rng = mulberry32((Date.now() ^ (rangeRng * 2654435761)) >>> 0)
		const out = sim.strike(RANGE, TEE, id, rng)
		const token = ++flightToken
		renderer.animateFlight(RANGE, out, id, {
			reduceMotion: settings.reduceMotion,
			onEvent: (e) => {
				if (token !== flightToken) return
				if (e.kind === 'bounce') sfx.play('bounce', { strength: e.strength ?? 0.5, shape: id })
				else if (e.kind === 'land') sfx.play('roll')
			},
			onFrame: (x, y, phase) => {
				if (token !== flightToken) return
				flightSound(RANGE, x, y, phase)
			},
			onDone: () => {
				sfx.tone(null)
				if (token !== flightToken) return
				lastTrail = out.points
				lastShape = id
				range(L.rangeNarrate(out, id, settings.characters))
			},
		})
	}

	// ---------- rounds ----------

	const newRound = (players: 1 | 2, course: number, customHole?: HoleSpec): void => {
		const r: Round = {
			players,
			player: 0,
			course,
			holeIdx: 0,
			strokes: Array.from({ length: players }, () => [0]),
			ball: { ...TEE },
			seed: Date.now() % 2147483647,
			highlight: 1,
		}
		if (customHole) r.customHole = customHole
		round = r
		persist()
		holeStart(players === 2 ? L.playerTurn(1) : undefined)
	}

	const resumeRound = (saved: RoundSave): void => {
		const r: Round = {
			players: saved.players,
			player: Math.min(saved.player, saved.players - 1),
			course: saved.course,
			holeIdx: saved.hole,
			strokes: saved.strokes,
			ball: { x: saved.ballX, lie: saved.lie },
			seed: saved.seed,
			highlight: saved.highlight,
		}
		if (saved.customHole) r.customHole = saved.customHole
		round = r
		const hole = curHole()
		if (!hole) {
			title()
			return
		}
		rack(L.whereAmI(hole, round.holeIdx, round.ball, curStrokes()), saved.highlight)
	}

	const holeStart = (prefix?: string): void => {
		if (!round) return
		const hole = curHole()
		if (!hole) return
		lastTrail = null
		lastShape = null
		renderer.drawIdle(hole, round.ball, null)
		const intro = round.customHole ? L.customIntro(hole) : L.holeIntro(hole, round.holeIdx)
		rack(prefix ? `${prefix} ${intro}` : intro)
	}

	const rack = (announce: string, startIndex = 0, queued = false): void => {
		if (!round) return
		const hole = curHole()
		if (!hole) return
		const shot = curStrokes() + 1
		round.highlight = startIndex // resume restores THIS frame's highlight
		hud.setScreen(hole.name)
		const who = round.players === 2 ? `P${round.player + 1} · ` : ''
		hud.setMode(`${who}Hole ${round.holeIdx + 1} · Shot ${shot}`)
		renderer.drawIdle(hole, round.ball, lastShape, lastTrail ?? undefined)
		const specs: HudItemSpec[] = [
			{ id: 'where', label: L.MENU.whereAmI, speak: L.MENU.whereAmISpeak },
			...SHAPE_ORDER.map((id) => ({
				id,
				label: L.shapeName(id, settings.characters),
				speak: L.shapeFocus(id, reach(id), settings.characters),
				glyph: id,
			})),
			// A scannable route to the menu. Holding Enter also opens it, but a
			// player who cannot sustain a 3 s hold would otherwise have no way to
			// reach settings or leave a round — §12 calls that a locked door.
			// §12 also notes the cost: this row is another stop on every pass,
			// which is why it sits last.
			{ id: 'menu', label: L.MENU.openMenu, speak: L.MENU.openMenuSpeak },
		]
		show(
			'rack',
			specs,
			(id, index) => {
				if (!round) return
				if (id === 'where') {
					tts.speak(L.whereAmI(hole, round.holeIdx, round.ball, curStrokes()))
					return
				}
				if (id === 'menu') {
					openMenu()
					return
				}
				strike(id as ShapeId, index)
			},
			{
				announce,
				queued,
				startIndex,
				rebuild: (i) => {
					if (round) rack(L.whereAmI(hole, round.holeIdx, round.ball, curStrokes()), i)
				},
			},
		)
	}

	/** Flight sonification: pitch follows height above the ground. */
	const flightSound = (hole: HoleSpec, x: number, y: number, phase: string): void => {
		if (!settings.flightTone || phase === 'roll') {
			sfx.tone(null)
			return
		}
		const groundY = groundAt(hole, x)
		sfx.tone(Math.min(1, Math.max(0, (y - groundY) / 35)))
	}

	const groundAt = (hole: HoleSpec, x: number): number => {
		const pts = hole.terrain
		const first = pts[0]
		const last = pts[pts.length - 1]
		if (!first || !last) return 0
		if (x <= first[0]) return first[1]
		if (x >= last[0]) return last[1]
		for (let i = 1; i < pts.length; i++) {
			const a = pts[i - 1]
			const b = pts[i]
			if (a && b && x <= b[0]) {
				const f = b[0] === a[0] ? 0 : (x - a[0]) / (b[0] - a[0])
				return a[1] + f * (b[1] - a[1])
			}
		}
		return last[1]
	}

	const strike = (id: ShapeId, rackIndex: number): void => {
		if (!round) return
		const hole = curHole()
		if (!hole) return
		round.highlight = rackIndex
		const strokeNo = curStrokes() + 1
		const row = round.strokes[round.player]
		if (row) row[round.holeIdx] = strokeNo
		screen = 'flight'
		flightPaused = false
		scanner.clear()
		hud.showPanel(false)
		hud.setMode('Watch!')
		hud.footerFocus('')
		tts.speak(L.shapeConfirm(id, settings.characters))
		sfx.play('swing')
		const rng = mulberry32(round.seed + round.player * 500 + round.holeIdx * 1000 + strokeNo)
		const out = sim.strike(hole, round.ball, id, rng)
		// Persist the TRUE end state now (in-memory ball updates in resolve()), so
		// exiting or closing the tab mid-flight never rolls back a counted stroke.
		persist(out.water ? round.ball : out.end)
		const token = ++flightToken
		let lastBeep = 0
		renderer.animateFlight(hole, out, id, {
			reduceMotion: settings.reduceMotion,
			onEvent: (e) => {
				if (token !== flightToken) return
				if (e.kind === 'bounce') sfx.play('bounce', { strength: e.strength ?? 0.5, shape: id })
				else if (e.kind === 'splash') sfx.play('splash')
				else if (e.kind === 'land') sfx.play('roll')
				else if (e.kind === 'holed') {
					// Penny's tap is a character's cheer (CAST.md), so it follows the
					// cast setting. It used to fire unconditionally.
					if (id === 'pancake' && settings.characters) sfx.play('tap')
					sfx.play('holed')
				}
			},
			onFrame: (x, y, phase) => {
				if (token !== flightToken) return
				flightSound(hole, x, y, phase)
				if (phase !== 'roll') return
				// The cup beeper: faster as the rolling ball closes in.
				const d = Math.abs(hole.cupX - x)
				if (d > 20) return
				const interval = 180 + (d / 20) * 720
				const now = performance.now()
				if (now - lastBeep >= interval) {
					lastBeep = now
					sfx.play('beep')
				}
			},
			onDone: () => {
				sfx.tone(null)
				if (token !== flightToken) return
				resolve(out, id)
			},
		})
	}

	const resolve = (out: ReturnType<Sim['strike']>, id: ShapeId): void => {
		if (!round) return
		const hole = curHole()
		if (!hole) return
		round.ball = out.end
		lastTrail = out.points
		lastShape = id
		persist()
		const strokes = curStrokes()
		if (out.holed) {
			endHoleForPlayer(
				`${L.narrate(out, id, hole, settings.characters)} ${L.scoreLine(strokes, hole.par)}`,
			)
			return
		}
		if (strokes >= MAX_STROKES) {
			endHoleForPlayer(`${L.narrate(out, id, hole, settings.characters)} ${L.REST_LINE}`)
			return
		}
		rack(L.narrate(out, id, hole, settings.characters))
	}

	/** The current player finished the hole (holed or rested). In 2P the other
	 *  player now plays the SAME hole from the tee; then the hole advances. */
	const endHoleForPlayer = (announce: string): void => {
		if (!round) return
		if (round.players === 2 && round.player === 0) {
			round.player = 1
			round.ball = { ...TEE }
			const row = round.strokes[1]
			if (row && row[round.holeIdx] === undefined) row[round.holeIdx] = 0
			persist()
			lastTrail = null
			lastShape = null
			const hole = curHole()
			if (hole) renderer.drawIdle(hole, round.ball, null)
			// Two beats: the cheer stands alone, the handoff waits its turn.
			tts.speak(announce)
			rack(L.playerTurn(2), 0, true)
			return
		}
		nextHole(announce)
	}

	const nextHole = (announce: string): void => {
		if (!round) return
		round.player = 0
		round.holeIdx += 1
		if (round.holeIdx >= holesOf(round).length) {
			summary(announce)
			return
		}
		for (const row of round.strokes) row.push(0)
		round.ball = { ...TEE }
		persist()
		lastTrail = null
		lastShape = null
		const hole = curHole()
		if (!hole) return
		renderer.drawIdle(hole, round.ball, null)
		// Two beats: celebrate first; the next hole's logistics wait their turn.
		tts.speak(announce)
		const turn = round.players === 2 ? `${L.playerTurn(1)} ` : ''
		rack(`${turn}${L.holeIntro(hole, round.holeIdx)}`, 0, true)
	}

	// ---------- summary ----------

	interface SummarySnapshot {
		players: 1 | 2
		strokes: number[][]
		holes: HoleSpec[]
		courseName: string | null
	}

	let lastSummary: SummarySnapshot | null = null

	const summary = (announce?: string, startIndex = 0): void => {
		if (round) {
			lastSummary = {
				players: round.players,
				strokes: round.strokes.map((r) => [...r]),
				holes: holesOf(round),
				courseName: round.course >= 0 ? (COURSES[round.course]?.name ?? null) : null,
			}
		}
		const snap = lastSummary
		round = null
		save.clearRound()
		if (!snap) {
			title()
			return
		}
		hud.setScreen('Round done')
		hud.setMode('Summary')
		const p1 = snap.strokes[0] ?? []
		const p2 = snap.strokes[1] ?? []
		const specs: HudItemSpec[] = snap.holes.map((h, i) => ({
			id: `hole-${i}`,
			label:
				snap.players === 2
					? `${h.name}: ${p1[i] ?? 0} / ${p2[i] ?? 0}`
					: `${h.name}: ${p1[i] ?? 0} / par ${h.par}`,
			speak:
				snap.players === 2
					? L.summaryHole2(h, i, p1[i] ?? 0, p2[i] ?? 0)
					: L.summaryHole(h, i, p1[i] ?? 0),
		}))
		specs.push(
			{ id: 'again', label: L.MENU.playAgain, speak: L.MENU.playAgainSpeak },
			{ id: 'exit', label: L.MENU.exit, speak: L.MENU.exitSpeak },
		)
		let line: string
		if (snap.players === 2) {
			line = L.summaryLine2(
				p1.reduce((s, v) => s + v, 0),
				p2.reduce((s, v) => s + v, 0),
			)
		} else {
			const total = p1.reduce((s, v) => s + v, 0)
			line = L.summaryLine(
				p1,
				snap.holes.map((h) => h.par),
			)
			if (snap.courseName) {
				const prev = best[snap.courseName]
				if (prev === undefined || total < prev) {
					best = { ...best, [snap.courseName]: total }
					persist()
					line = `${line} ${L.BEST_LINE}`
				}
			}
		}
		const opts: { announce?: string; startIndex?: number; rebuild?: (i: number) => void } = {
			startIndex,
			rebuild: (i) => summary(undefined, i),
		}
		if (announce !== undefined) opts.announce = `${announce} ${line}`
		show(
			'summary',
			specs,
			(id, index) => {
				if (id === 'again') coursePick(snap.players)
				else if (id === 'exit') title()
				else tts.speak(specs[index]?.speak ?? '') // per-hole rows re-speak on select
			},
			opts,
		)
	}

	// ---------- context menu ----------

	const closeMenu = (): void => {
		hud.hideOverlay()
		if (screen === 'flight') {
			if (flightPaused) {
				flightPaused = false
				renderer.resume()
			}
			scanner.clear()
			hud.footerFocus('') // the overlay's last label must not outlive it
			return
		}
		underlayRestore?.()
		underlayRestore = null
	}

	const openMenu = (): void => {
		sfx.play('menu')
		sfx.tone(null)
		const inFlight = screen === 'flight'
		if (inFlight && !flightPaused) {
			flightPaused = true
			renderer.pause()
		}
		const prevIndex = scanner.focusIndex()
		const prevRebuild = rebuildCurrent
		const wasTitle = screen === 'title'
		if (!inFlight) {
			underlayRestore = () => prevRebuild(Math.max(prevIndex, 0))
		}
		// New round and Exit throw away a round in progress. Both arm on the first
		// pick and only act on a second — a mis-timed select, which is the normal
		// failure mode of scanning, must never cost the player their game.
		let armed: 'new' | 'exit' | null = null
		// When the arm happened. The confirm must be a separate act, not a bounce:
		// the pointer and switch guards keep independent clocks, so a click that
		// armed and an Enter 30 ms later slipped through both.
		let armedAt = 0
		const menuSpecs = (): HudItemSpec[] => {
			const specs: HudItemSpec[] = [
				{ id: 'resume', label: L.MENU.resume, speak: L.MENU.resumeSpeak },
			]
			if (round) specs.push({ id: 'where', label: L.MENU.whereAmI, speak: L.MENU.whereAmISpeak })
			if (!inFlight)
				specs.push({ id: 'settings', label: L.MENU.settings, speak: L.MENU.settingsSpeak })
			if (round)
				specs.push(
					armed === 'new'
						? {
								id: 'new',
								label: L.MENU.newRoundArmed,
								speak: L.MENU.newRoundArmedSpeak,
								hold: true,
							}
						: { id: 'new', label: L.MENU.newRound, speak: L.MENU.newRoundSpeak },
				)
			if (!wasTitle)
				specs.push(
					armed === 'exit'
						? { id: 'exit', label: L.MENU.exitArmed, speak: L.MENU.exitArmedSpeak, hold: true }
						: { id: 'exit', label: L.MENU.exit, speak: L.MENU.exitSpeak },
				)
			return specs
		}
		const showMenu = (startIndex: number): void => {
			const items = hud.overlay(menuSpecs())
			scanner.setItems(items, { startIndex })
		}
		overlaySelect = (id, index) => {
			if (id === 'new' || id === 'exit') {
				if (armed !== id) {
					armed = id
					armedAt = Date.now()
					showMenu(index) // re-render armed; the focus handler speaks the warning
					return
				}
				if (Date.now() - armedAt < INPUT_COOLDOWN_MS) return // too fast to be a decision
			} else armed = null
			if (id === 'resume') {
				closeMenu()
				return
			}
			if (id === 'where' && round) {
				const hole = curHole()
				if (hole) tts.speak(L.whereAmI(hole, round.holeIdx, round.ball, curStrokes()))
				return
			}
			if (id === 'settings') {
				hud.hideOverlay()
				const back = underlayRestore ?? (() => title())
				underlayRestore = null
				settingsScreen(() => back())
				return
			}
			if (id === 'new' && round) {
				flightToken++ // orphan any in-flight animation
				if (flightPaused) {
					flightPaused = false
					renderer.resume() // else every later idle scene stays frozen
				}
				sfx.tone(null)
				hud.hideOverlay()
				underlayRestore = null
				newRound(round.players, round.course, round.customHole)
				return
			}
			if (id === 'exit') {
				flightToken++
				if (flightPaused) {
					flightPaused = false
					renderer.resume()
				}
				sfx.tone(null)
				hud.hideOverlay()
				underlayRestore = null
				title()
			}
		}
		showMenu(0)
	}

	// ---------- public ----------

	return {
		start() {
			applySettings()
			title(0, true)
		},
		onSwitch(e) {
			// Speak the mode change: an eyes-closed player needs to know the
			// direction flipped (Benny's Mini Golf announces this too).
			if (e === 'autostart') tts.speak(L.BACKWARD_SCAN)
			if (e === 'menu') {
				if (hud.overlayOpen()) closeMenu()
				else openMenu()
				return
			}
			scanner.handle(e)
		},
	}
}
