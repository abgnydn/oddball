// Every player-facing word lives here. Short sentences,
// common words, whole yards. The narrator speaks about the cast matter-of-factly
// — ability first, never pity, never "despite" (CAST.md).

import { MAX_CUSTOM_HOLES, MAX_STROKES, SHAPE_ORDER, SHAPES, yd } from '../tuning'
import type { BallState, HoleSpec, ShapeId, StrikeOutcome, Surface } from '../types'

export const GAME_TITLE = 'Odd Ball'

export const WELCOME =
	'Odd Ball. A golf game where you are the ball. Press Space to look around. Press Enter to choose.'

export const MENU = {
	continue: 'Continue',
	continueSpeak: 'Continue. Go back to the round you were playing.',
	play: 'Play',
	playSpeak: 'Play. Start a new round of six holes.',
	friend: 'Play with a friend',
	friendSpeak: 'Play with a friend. Take turns, hole by hole.',
	practice: 'Practice',
	practiceSpeak: 'Practice. Hit shots on the range. Every shot starts from the tee.',
	makeHole: 'Make a Hole',
	makeHoleSpeak: 'Make a Hole. Build a golf hole and play it.',
	myHoles: 'My Holes',
	myHolesSpeak: 'My Holes. Play the holes you made.',
	hearHole: 'Hear my hole',
	hearHoleSpeak: 'Hear my hole. Listen to what you built.',
	playMyHole: 'Play my hole',
	playMyHoleSpeak: 'Play my hole. Try the hole you built.',
	saveMyHole: 'Save my hole',
	saveMyHoleSpeak: 'Save my hole. Keep it in My Holes.',
	playThis: 'Play',
	playThisSpeak: 'Play this hole.',
	deleteThis: 'Delete',
	deleteThisSpeak: 'Delete this hole.',
	deleteArmed: 'Yes — delete',
	deleteArmedSpeak: 'Delete this hole for good? Pick this again to be sure.',
	help: 'How to Play',
	helpSpeak: 'How to Play. Learn the game and meet the team.',
	settings: 'Settings',
	settingsSpeak: 'Settings. Change the voice, the colors, and more.',
	back: 'Back',
	backSpeak: 'Back. Go to the last screen.',
	playAgain: 'Play again',
	playAgainSpeak: 'Play again. Start a new round.',
	openMenu: 'Menu',
	openMenuSpeak: 'Menu. Settings, a new round, or go back.',
	// The range has no round, so openMenu() omits New round. Reusing the rack's
	// line there told a player who cannot see the screen that an option existed
	// which did not — in a game whose whole interface is speech.
	openMenuSpeakNoRound: 'Menu. Settings, or go back.',
	exit: 'Exit to menu',
	exitSpeak: 'Exit. Go back to the main menu.',
	resume: 'Keep playing',
	resumeSpeak: 'Keep playing. Close this menu.',
	whereAmI: 'Where am I?',
	whereAmISpeak: 'Where am I? Hear about this hole and your ball.',
	newRound: 'New round',
	newRoundSpeak: 'New round. Start over from hole one.',
	// Armed states: both of these throw away a round in progress, so they ask
	// once first. A single mis-timed pick must never cost the player their game.
	newRoundArmed: 'Yes — start over',
	newRoundArmedSpeak: 'Start over? Your score goes away. Pick this again to be sure.',
	exitArmed: 'Yes — exit',
	exitArmedSpeak: 'Leave this round? Pick this again to be sure.',
}

/** A function, not a const: the "Meet the team" page reads the cast strings, and
 *  a module-level const evaluates once at import with no way to consult the
 *  player's setting. It shipped as a const and spoke "Brick is deaf" to players
 *  who had the cast layer turned off. */
export const helpPages = (characters: boolean): Array<{ label: string; speak: string }> => [
	{
		label: 'What is this game?',
		speak:
			'You are a golf ball. A golfer hits you toward the cup. Before every hit, you pick what shape to be. Each shape moves its own way. Pick the right friend for the right moment.',
	},
	{
		label: 'The controls',
		speak:
			'Press Space to move to the next choice. Press Enter to pick it. Hold Space to go backwards. Hold Enter to open the menu. There is a Menu choice at the end of the list too, and a Pause button on the screen. In Settings you can turn on Auto scan, so the light moves by itself.',
	},
	{
		label: characters ? 'Meet the team' : 'The shapes',
		speak: SHAPE_ORDER.map(
			(id) => `${shapeName(id, characters)}. ${shapeBlurb(id, characters)}`,
		).join(' '),
	},
	{
		label: 'Scoring',
		speak:
			'Each hit is one shot. Fewer shots is better. Par is a good score for the hole. Get the ball close to the cup and it counts as in. There is no way to lose. Have fun.',
	},
]

const yds = (n: number): string => `${n} ${n === 1 ? 'yard' : 'yards'}`

const lieWord = (lie: Surface): string => {
	if (lie === 'rough') return 'tall grass'
	if (lie === 'sand') return 'sand'
	if (lie === 'green') return 'green'
	return 'short grass'
}

export const holeIntro = (hole: HoleSpec, index: number): string =>
	`Hole ${index + 1}. ${hole.name}. ${yd(hole.length)} yards. Par ${hole.par}. ${hole.windText} ${hole.intro}`

export const whereAmI = (
	hole: HoleSpec,
	index: number,
	ball: BallState,
	strokes: number,
): string => {
	const remaining = yds(yd(Math.abs(hole.cupX - ball.x)))
	const shots =
		strokes === 0
			? 'You have not been hit yet.'
			: `You have taken ${strokes} ${strokes === 1 ? 'shot' : 'shots'}.`
	return `Hole ${index + 1}, ${hole.name}. ${remaining} to the cup. You are on the ${lieWord(ball.lie)}. ${hole.windText} ${shots}`
}

/** Distance FIRST, character second. §9 warns that a focus label "is read aloud
 *  at every scan step, and at a 1 s scan speed a long label becomes a drone",
 *  and these run 6-10 s. Per-item labels deliberately do not hold the scan
 *  timer, so at the default 2 s an auto-scanning player hears only the opening
 *  — and the yardage used to be at the END, which meant the one number that
 *  decides the shot was the one part they never reached. The blurb is flavour
 *  and can be cut off; the distance cannot. */
/** Spoken text says "ten", not "10" — §9 asks for short sentences and common
 *  words, and a synthesiser reads a digit inconsistently across voices. */
const numWord = (n: number): string =>
	['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][n] ??
	String(n)

/** The cast layer is a setting, off by default (Settings.characters). With it
 *  off a shape is described by what it does and nothing else; with it on the
 *  same shape has a name and a voice. Every spoken line that mentions a shape
 *  goes through here, so the two modes can never half-apply — a plain blurb
 *  under a character name would read as a bug, not a style. */
export const shapeName = (id: ShapeId, characters: boolean): string =>
	characters ? SHAPES[id].name : SHAPES[id].plainName

export const shapeBlurb = (id: ShapeId, characters: boolean): string =>
	characters ? SHAPES[id].blurb : SHAPES[id].plainBlurb

export const shapeFocus = (id: ShapeId, reachM: number, characters: boolean): string =>
	`${shapeName(id, characters)}. Goes about ${yd(reachM)} yards. ${shapeBlurb(id, characters)}`

export const shapeConfirm = (id: ShapeId, characters: boolean): string =>
	`${shapeName(id, characters)}. Here comes the swing!`

/** Character-flavored hole-out lines (CAST.md). Only spoken when characters
 *  are on; otherwise the hole-out line ends after "In the cup!". */
const HOLED_FLAVOR: Record<ShapeId, string> = {
	sphere: 'Dot heard the beeper the whole way.',
	cube: 'Brick is very pleased.',
	disc: 'Glide takes a bow.',
	egg: 'The egg is as surprised as you are.',
	star: 'Boing bounces with joy.',
	pancake: 'Penny taps once. That means yes.',
}

export const narrate = (
	out: StrikeOutcome,
	id: ShapeId,
	hole: HoleSpec,
	characters: boolean,
): string => {
	const name = shapeName(id, characters)
	if (out.water)
		return `Splash! ${name} landed in the water. The ball goes back to where it was. The shot still counts.`
	if (out.holed) return characters ? `In the cup! ${HOLED_FLAVOR[id]}` : 'In the cup!'
	const remainingYd = yd(Math.abs(hole.cupX - out.end.x))
	const remaining = yds(remainingYd)
	const bounces = out.events.filter((e) => e.kind === 'bounce').length
	let color = ''
	if (out.end.lie === 'sand') color = `${name} landed in the sand. `
	else if (bounces >= 3)
		// "Boing!" belongs to the star character — neutral wording for everyone
		// else, and for everyone when the cast layer is off
		color = characters && id === 'star' ? `Boing! ${bounces} bounces! ` : `Bounce, bounce, bounce! `
	else if (out.total - out.carry < 2 && out.total > 20)
		color = `${name} landed and stayed right there. `
	const close = remainingYd <= 10 ? ' So close!' : ''
	return `${color}${name} went ${yds(yd(out.total))}. ${remaining} to the cup.${close}`
}

export const scoreLine = (strokes: number, par: number): string => {
	if (strokes === 1) return 'One shot. A hole in one.'
	const diff = strokes - par
	if (diff === -2) return `Eagle. ${strokes} shots, two under par.`
	if (diff < -2) return `${strokes} shots, ${-diff} under par.`
	if (diff === -1) return `Birdie. ${strokes} shots, one better than par.`
	if (diff === 0) return `Par. ${strokes} shots.`
	if (diff === 1) return `${strokes} shots. One over par.`
	return `${strokes} shots. ${diff} over par.`
}

export const REST_LINE = `That is ${MAX_STROKES} shots. The ball takes a rest. On to the next hole.`

export const summaryLine = (strokes: number[], pars: number[]): string => {
	const total = strokes.reduce((s, v) => s + v, 0)
	const parTotal = pars.reduce((s, v) => s + v, 0)
	const diff = total - parTotal
	// Name the margin whichever way it went. Hiding it above +3 reported a good
	// round precisely and a bad one vaguely, which is its own kind of talking down.
	let verdict = `${diff} over par.`
	if (diff < 0) verdict = `${-diff} under par.`
	else if (diff === 0) verdict = 'Right at par.'
	return `The round is done. You took ${total} shots in ${strokes.length} holes. Par is ${parTotal}. ${verdict}`
}

export const summaryHole = (hole: HoleSpec, index: number, strokes: number): string =>
	`Hole ${index + 1}, ${hole.name}: ${strokes} ${strokes === 1 ? 'shot' : 'shots'}, par ${hole.par}.`

export const BACKWARD_SCAN = 'Going backwards.'

export const SWING_LINE = 'Whoosh!'

// ---------- courses, players, range, editor ----------

/** Same rule as shapeFocus, and the same defect until a lens found it one
 *  function down: the number a player is deciding on goes BEFORE the flavour,
 *  because a focus label does not hold the scan timer and the tail is not heard
 *  at the default rung. This one ran ~5.6 s with the score last. */
export const courseFocus = (name: string, blurb: string, best?: number): string =>
	`${name}.${best !== undefined ? ` Your best here: ${best} shots.` : ''} ${blurb}`

export const playerTurn = (playerNo: number): string => `Player ${playerNo}, your turn!`

export const summaryHole2 = (hole: HoleSpec, index: number, s1: number, s2: number): string =>
	`Hole ${index + 1}, ${hole.name}: Player 1 took ${s1}, Player 2 took ${s2}. Par ${hole.par}.`

export const summaryLine2 = (t1: number, t2: number): string => {
	const lead =
		t1 === t2
			? `You tied at ${t1} shots each.`
			: t1 < t2
				? `Player 1 took ${t1} shots. Player 2 took ${t2}. Player 1 wins this one!`
				: `Player 2 took ${t2} shots. Player 1 took ${t1}. Player 2 wins this one!`
	return `The round is done. ${lead}`
}

export const BEST_LINE = 'That is your best round here!'

export const rangeNarrate = (out: StrikeOutcome, id: ShapeId, characters: boolean): string => {
	const name = shapeName(id, characters)
	const bounces = out.events.filter((e) => e.kind === 'bounce').length
	let color = ''
	if (bounces >= 3)
		color = characters && id === 'star' ? `Boing! ${bounces} bounces! ` : 'Bounce, bounce, bounce! '
	else if (out.total - out.carry < 2 && out.total > 20)
		color = `${name} landed and stayed right there. `
	return `${color}${name} went ${yd(out.total)} yards! Pick a shape and go again.`
}

export const EDITOR_ROW_LABELS: Record<string, string> = {
	length: 'How long',
	hills: 'The ground',
	water: 'Water',
	sand: 'Sand',
	wind: 'Wind',
}

export const editorDescribe = (parts: string[]): string => `Your hole: ${parts.join('. ')}.`

export const ESTIMATING = 'Getting your hole ready. One moment.'
export const holeSaved = (name: string): string => `Saved! ${name} is in My Holes now.`
export const BOOK_FULL = `You have ${numWord(MAX_CUSTOM_HOLES)} holes already. Delete one first.`
export const holeDeleted = (name: string): string => `${name} is gone.`
export const customIntro = (hole: HoleSpec): string =>
	`${hole.name}. ${yd(hole.length)} yards. Par ${hole.par}. ${hole.windText} ${hole.intro}`

// ---------- settings ----------

export const SETTINGS_LABELS = {
	tts: 'Text to speech',
	rate: 'Speech speed',
	volume: 'Speech volume',
	scan: 'Scan speed',
	auto: 'Auto scan',
	font: 'Text size',
	theme: 'Colors',
	highlight: 'Highlight',
	audio: 'Sounds',
	motion: 'Animations',
	tone: 'Flying sound',
	dwell: 'Hover to pick',
	characters: 'Character names',
}

export const settingValueSpeak: Record<string, (v: string) => string> = {
	tts: (v) => `Text to speech ${v}.`,
	rate: (v) => `Speech speed: ${v}.`,
	volume: (v) => `Speech volume: ${v}.`,
	scan: (v) => `Scan speed: ${v}.`,
	auto: (v) =>
		v.startsWith('on')
			? `Auto scan ${v}. The light moves by itself. Enter picks it.`
			: `Auto scan ${v}. Space moves the light. Enter picks it.`,
	font: (v) => `Text size: ${v}.`,
	theme: (v) => `Colors: ${v}.`,
	highlight: (v) => `Highlight: ${v}.`,
	audio: (v) => `Sounds ${v}.`,
	motion: (v) => `Animations ${v}.`,
	tone: (v) =>
		v.startsWith('on')
			? `Flying sound ${v}. The ball sings higher as it flies higher.`
			: `Flying sound ${v}. The ball flies without a sound.`,
	dwell: (v) =>
		v === 'off'
			? `Hover to pick: ${v}. Pointing at a button does not choose it.`
			: `Hover to pick: ${v}. Point at a button and hold still to choose it.`,
	characters: (v) =>
		v.startsWith('on')
			? `Character names ${v}. Each shape has a name and a story.`
			: `Character names ${v}. Each shape is named for what it is.`,
}
