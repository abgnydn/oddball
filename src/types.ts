// Shared contracts between modules. READ-ONLY during the build phase —
// every module implements exactly these shapes; integration relies on it.

// ---------- shapes ----------

export type ShapeId = 'sphere' | 'cube' | 'disc' | 'egg' | 'star' | 'pancake'

export interface ShapeSpec {
	id: ShapeId
	name: string // spoken + shown name ("Ball", "Cube", ...)
	blurb: string // spoken on focus: what it does, in short common words
	plainName: string // same shape without the cast persona ("The cube")
	plainBlurb: string // same facts, no character voice; used when characters=off
	maxCarry: number // m — cap on the carry the golfer can get with this shape
	launchDeg: number // launch angle above horizontal
	drag: number // quadratic drag coefficient (1/m), applied to airspeed
	lift: number // 0..1 fraction of gravity cancelled while airborne (disc glide)
	windSens: number // multiplier on wind acceleration while airborne
	carrySigma: number // relative sigma on strike speed (dispersion)
	restitution: number // bounce energy retention 0..1
	bounceJitter: number // radians — random perturbation of bounce angle
	rollMult: number // scales rollout distance after bounces settle
	/** Dot (CAST.md): when her roll would stop within `radius` m of the cup, she
	 *  listens and rolls up to `pull` m closer. An edge, never an aimbot. */
	homing?: { radius: number; pull: number }
}

// ---------- course ----------

export type Surface = 'fairway' | 'rough' | 'green' | 'sand' | 'water'

export interface Zone {
	from: number // m, inclusive
	to: number // m, exclusive
	surface: Surface
}

export interface HoleSpec {
	name: string
	intro: string // one flavor sentence, spoken in the hole intro
	length: number // m, tee (x=0) to cup
	par: number // set from harness measurement
	wind: number // m/s; positive blows toward the cup (tailwind)
	windText: string // spoken ("No wind.", "A big wind blows against you.")
	terrain: Array<[number, number]> // heightfield polyline (x, y) m, x ascending
	zones: Zone[] // explicit non-fairway zones; anything else is fairway
	cupX: number // usually == length; beyond the terrain end = no cup (the range)
	intendedShapes: ShapeId[] // design intent; the holes harness plays these
}

export interface CourseSpec {
	name: string // spoken + shown ("Sunny Meadows")
	blurb: string // spoken on focus in the course picker
	holes: HoleSpec[]
}

/** Parameter-combo hole editor (scan-friendly: every row cycles an option).
 *  Each field is an index into the option tables in tuning (EDITOR_OPTIONS). */
export interface EditorParams {
	length: number
	hills: number
	water: number
	sand: number
	wind: number
}

export interface CustomHole {
	name: string // auto-named ("My Hole 1")
	params: EditorParams
}

// ---------- simulation ----------

/** Deterministic RNG in [0, 1). */
export type Rng = () => number

export interface BallState {
	x: number // m downrange; y always derived from terrain
	lie: Surface
}

export type FlightPhase = 'fly' | 'bounce' | 'roll'

export interface FlightPoint {
	x: number
	y: number
	t: number // seconds since strike
	phase: FlightPhase
}

export type FlightEventKind =
	| 'launch'
	| 'peak'
	| 'bounce'
	| 'splash'
	| 'land' // first ground contact that will not bounce again
	| 'rollstop'
	| 'holed'

export interface FlightEvent {
	t: number
	kind: FlightEventKind
	x: number
	strength?: number // 0..1, e.g. bounce hardness — drives sfx
}

export interface StrikeOutcome {
	points: FlightPoint[] // fixed-dt trajectory for the renderer
	events: FlightEvent[]
	end: BallState // final resting state (post water-reset if any)
	holed: boolean
	water: boolean // true if the shot splashed and was reset
	carry: number // m from strike point to first ground contact
	total: number // m from strike point to rest (0 if water reset)
}

export interface Sim {
	/**
	 * Golfer strikes the ball from `ball` on `hole` while it is `shape`.
	 * Aims at the cup: noise-free binary search for strike speed, capped by
	 * the shape's reach; noise applied only to the real strike. Lie penalty
	 * multiplies strike power (sand 0.6, rough 0.85).
	 */
	strike(hole: HoleSpec, ball: BallState, shape: ShapeId, rng: Rng): StrikeOutcome
}

// ---------- input ----------

export type SwitchEvent =
	| 'next' // space release (< long-hold threshold)
	| 'select' // return release short of the menu threshold
	| 'menu' // return held to threshold; that press's release is consumed
	| 'autostart' // space held to threshold → BACKWARD scanning while held
	| 'autostop' // space released after backward scanning

export type SwitchKey = 'space' | 'return'

export interface SwitchInput {
	on(cb: (e: SwitchEvent) => void): void
	start(): void
	stop(): void
	/** ms this key has been held, 0 when released. Drives the hold-progress
	 *  ring and its rising beep (§4). */
	heldFor(key: SwitchKey): number
}

// ---------- scanning ----------

export interface ScanItem {
	id: string
	label: string // shown
	speak: string // spoken on focus
	/** Hold the Auto Scan timer until this item's speech finishes. For warnings
	 *  only: an unspoken warning is no warning. Ordinary labels must NOT set it,
	 *  or speech length would override the player's chosen scan speed. */
	hold?: boolean
	el?: HTMLElement // when present: highlight ring target + click-to-select
}

export interface Scanner {
	/** Replace the scan list. Highlight starts on startIndex (default 0); with
	 *  Auto Scan off it does not advance until the first 'next', and with Auto
	 *  Scan on it begins advancing immediately. Includes the wrap deadzone step. */
	setItems(items: ScanItem[], opts?: { startIndex?: number }): void
	clear(): void
	/** index === -1 for the wrap-deadzone step (no item focused). */
	onFocus(cb: (item: ScanItem | null, index: number) => void): void
	onSelect(cb: (item: ScanItem, index: number) => void): void
	focusIndex(): number
	/** Feed switch events in ('next' | 'select' | 'autostart' | 'autostop'). */
	handle(e: SwitchEvent): void
	setScanMs(ms: number): void
	/** Dwell-to-select for head/eye-tracking users: hovering an item for `ms`
	 *  selects it (visible fill via the item's --dwell custom property, 0..1).
	 *  null disables. Pointer leave cancels and resets the fill. */
	setDwell(ms: number | null): void
	/** Auto Scan (single-switch mode): when on, the highlight steps forward by
	 *  itself at scanMs on every list; Space still steps manually (and resets
	 *  the beat); hold-Space backward scanning takes priority while held. */
	setAutoScan(on: boolean): void
	/** Suspend Auto Scan's timer while narration is speaking. Manual stepping and
	 *  hold-Space backward scanning are unaffected — this only gates the timer. */
	setAutoHold(on: boolean): void
}

// ---------- speech ----------

export interface TTS {
	/** interrupt (default true) cancels current speech first. Never blocks input.
	 *  hold (default true) marks this as narration the scan must wait for — pass
	 *  false for the per-item focus label, which is the scan's own voice.
	 *  Every utterance is console.log-ed as `[tts] <text>` and captioned. */
	speak(text: string, opts?: { interrupt?: boolean; hold?: boolean }): void
	stop(): void
	setRate(rate: number): void // 0.5..2, default 1
	setVolume(v: number): void // 0..1
	setEnabled(on: boolean): void
	/** Caption sink — hud registers this to mirror speech on screen. */
	onCaption(cb: (text: string) => void): void
	/** Fires true while a holding utterance is actually being spoken, false when
	 *  it ends. Auto Scan suspends itself in between so a hands-free player is
	 *  never stepped off an item while the game is still talking to them. */
	onHoldChange(cb: (holding: boolean) => void): void
}

// ---------- audio ----------

export type SfxName =
	| 'step' // scan step
	| 'focus' // highlight lands on an item — pitch walks a pentatonic scale by opts.index
	| 'select'
	| 'swing'
	| 'bounce' // strength via opts.strength; character signature via opts.shape
	| 'splash'
	| 'roll'
	| 'holed' // the plonk + one piano note
	| 'menu'
	| 'beep' // the cup beeper — caller sets the rate by calling it more often
	| 'tap' // Penny's single tap for yes

export interface SFX {
	play(name: SfxName, opts?: { strength?: number; index?: number; shape?: ShapeId }): void
	/** Flight sonification: a quiet continuous tone whose pitch follows `level`
	 *  (0..1, mapped to height). Call every frame while airborne; null stops it.
	 *  Must be interruption-safe (menu pause, flight end, exit all pass null). */
	tone(level: number | null): void
	/** One rising blip for the hold-progress gesture (§4: "a rising beep plays
	 *  each second so it works with eyes closed"). `step` is the whole second
	 *  reached, 1 upward. */
	holdBeep(step: number): void
	setEnabled(on: boolean): void
}

// ---------- rendering ----------

export interface Renderer {
	attach(canvas: HTMLCanvasElement): void
	resize(): void
	/** Static scene: terrain, zones, cup + flag, ball (as its chosen shape) at rest.
	 *  trail: the previous stroke's flight path, kept as a faded ghost so the
	 *  story of the shot survives into the next choice. */
	drawIdle(hole: HoleSpec, ball: BallState, shape: ShapeId | null, trail?: FlightPoint[]): void
	/** Animate the outcome. Calls onEvent as each FlightEvent's time is reached,
	 *  onDone at the end. onFrame (if given) fires every animation frame with the
	 *  ball's current x and phase — the flow uses it for the cup beeper.
	 *  reduceMotion: draw the end state and fire events+done immediately (no
	 *  onFrame). pause()/resume() control the animation (context menu). */
	animateFlight(
		hole: HoleSpec,
		outcome: StrikeOutcome,
		shape: ShapeId,
		opts: {
			reduceMotion: boolean
			onEvent: (e: FlightEvent) => void
			onDone: () => void
			onFrame?: (x: number, y: number, phase: FlightPhase) => void
		},
	): void
	pause(): void
	resume(): void
	setTheme(theme: Theme): void
}

// ---------- settings & save ----------

export type Theme = 'high-contrast' | 'light' | 'dark' | 'warm'
export type FontScale = 100 | 125 | 150 | 175 | 200
export type HighlightThickness = 'thin' | 'medium' | 'thick'

export type DwellSetting = 'off' | 'slow' | 'fast'

export interface Settings {
	ttsOn: boolean
	ttsRate: number
	ttsVolume: number
	scanMs: number // interval between scan steps (auto and held-backward alike)
	fontScale: FontScale
	theme: Theme
	highlightThick: HighlightThickness
	audioCues: boolean
	reduceMotion: boolean
	flightTone: boolean // sonify the ball's height while it flies
	dwell: DwellSetting // hover-to-select for head/eye-tracking users
	/** Single-switch mode: the highlight advances by itself at scanMs, so the
	 *  player only ever presses Enter (the hub's one-switch scheme). */
	autoScan: boolean
	/** Cast layer (CAST.md): shapes get names and a voice. Off by default —
	 *  a first-time player hears what the shape DOES before who it is. */
	characters: boolean
}

export interface RoundSave {
	players: 1 | 2 // pass-and-play: each hole is played out by P1, then P2
	player: number // whose turn (0-based)
	course: number // index into COURSES; -1 = custom single-hole round
	customHole?: HoleSpec // embedded when course === -1 so Continue works
	hole: number // 0-based index into the course
	strokes: number[][] // [player][holeIdx]; current hole = in-progress count
	ballX: number
	lie: Surface
	highlight: number // scan index within the shape rack frame
	seed: number // stroke rng = mulberry32(seed + player*500 + hole*1000 + stroke)
}

export interface SaveData {
	settings: Settings
	round?: RoundSave
	customHoles?: CustomHole[] // the editor's saved holes (auto-named)
	editorDraft?: EditorParams // the editor remembers where you left off
	best?: Record<string, number> // best 1P total per course name
}

export interface SaveAPI {
	load(): SaveData
	save(d: SaveData): void
	clearRound(): void
	/** §10's Reset Progress: everything the game has stored — settings, the round
	 *  in progress, saved holes, the editor draft and best scores. Two-step in the
	 *  UI, because a mis-timed pick is the normal failure mode of scanning. */
	clearAll(): void
}
