// Canvas-2D side-view renderer, built for LOW VISION: huge chunky forms,
// thick outlines, minimal clutter. All colors are read from CSS custom
// properties on <html> (defined in src/ui/theme.css) so the canvas follows
// the active theme; setTheme() re-reads them.
//
// Beauty pass rules (see DESIGN.md):
// - decoration NEVER carries unique information — everything decorated is
//   also spoken; foreground (terrain, ball, flag, trail) keeps its contrast.
// - html[data-reduce-motion='true'] disables ALL animated decoration
//   (checked at draw time via the dataset).
// - the high-contrast theme stays stark: --decor is 0 there, so it gets the
//   flat --sky, no gradients, no parallax, no texture (the flag ripple stays —
//   it reads cleanly). The physics sim and game logic are untouched.

import { COURSES } from '../tuning'
import type {
	BallState,
	FlightEvent,
	FlightPhase,
	FlightPoint,
	HoleSpec,
	Renderer,
	ShapeId,
	StrikeOutcome,
	Surface,
	Theme,
} from '../types'

// ---------- fixed screen sizes (CSS px — glyphs stay big at any zoom) ----------

const BALL_HALF_PX = 18 // ball glyph half-height → at least ~36px tall
const OUTLINE_PX = 4
const TRAIL_PX = 6
const FLAG_POLE_PX = 84
const PAD_X = 54
const PAD_TOP = 24

// ---------- playback tuning ----------

const MIN_PLAY_S = 3
const MAX_PLAY_S = 6
const PRE_S = 0.45 // anticipation pre-roll: lean-back beat before the launch
const PLAY_SCALE = 0.9 // wall seconds per sim second, before clamping
const TRAIL_FADE_S = 2.5 // sim-time window over which a trail segment fades
const TRAIL_MIN_ALPHA = 0.25 // old trail stays faintly visible
const TRAIL_STRIDE = 3 // draw every Nth sim point

// ---------- decoration tuning ----------

const BLINK_PERIOD_S = 3.6 // idle blink cadence
const BLINK_LEN_S = 0.14
const STRIPE_PX = 22 // mowing stripe width on screen
const STRIPE_ALPHA = 0.16 // near the tee; fades to 0 with distance (stripes read poorly at distance)
const BEEP_NEAR_M = 20 // rolling ball within this of the cup → beeper ring
const AFTER_BEAT_S = 0.5 // holed: beat of stillness before the pulse
const AFTER_PULSE_S = 0.7 // holed: pulse ring expansion time
const AFTER_TOTAL_S = 1.5 // holed: total afterglow before onDone
const PENNY_TAP_AT = 0.06 // Penny's single tap-bounce, inside the still beat
const PENNY_TAP_S = 0.34

/** Read at draw time so a mid-session settings change takes effect immediately. */
const reduceMotionNow = (): boolean =>
	typeof document !== 'undefined' && document.documentElement.dataset.reduceMotion === 'true'

/** The cast layer (Settings -> Character names), read off <html> the same way
 *  reduce-motion is. Penny's tap-bounce is hers, so with the cast off it does
 *  not happen. This was the fifth ungated cast element found, and the first
 *  that neither of menu-check's greps could see: it is an animation, not a
 *  string. */
const charactersNow = (): boolean =>
	typeof document !== 'undefined' && document.documentElement.dataset.characters === 'true'

// ---------- colors from CSS custom properties ----------

interface Colors {
	sky: string
	skyTop: string
	skyBottom: string
	skyDawn: string
	skyDusk: string
	sil1: string
	sil2: string
	sil3: string
	stripe: string
	ground: string
	water: string
	sand: string
	green: string
	rough: string
	flag: string
	ball: string
	ballOutline: string
	trail: string
	wave: string
	accent: string
	decor: boolean
}

const FALLBACK: Colors = {
	sky: '#000000',
	skyTop: '#000000',
	skyBottom: '#000000',
	skyDawn: '#000000',
	skyDusk: '#000000',
	sil1: '#000000',
	sil2: '#000000',
	sil3: '#000000',
	stripe: '#000000',
	ground: '#ffffff',
	water: '#2f9dff',
	sand: '#e3c56f',
	green: '#00e676',
	rough: '#a8a8a8',
	flag: '#ff2d55',
	ball: '#ffd60a',
	ballOutline: '#000000',
	trail: '#ffffff',
	wave: '#ffffff',
	accent: '#ffd60a',
	decor: false,
}

const readColors = (): Colors => {
	if (typeof document === 'undefined') return FALLBACK
	const cs = getComputedStyle(document.documentElement)
	const get = (token: string, fb: string): string => {
		const v = cs.getPropertyValue(token).trim()
		return v === '' ? fb : v
	}
	return {
		sky: get('--sky', FALLBACK.sky),
		skyTop: get('--sky-top', FALLBACK.skyTop),
		skyBottom: get('--sky-bottom', FALLBACK.skyBottom),
		skyDawn: get('--sky-dawn', FALLBACK.skyDawn),
		skyDusk: get('--sky-dusk', FALLBACK.skyDusk),
		sil1: get('--silhouette-1', FALLBACK.sil1),
		sil2: get('--silhouette-2', FALLBACK.sil2),
		sil3: get('--silhouette-3', FALLBACK.sil3),
		stripe: get('--stripe', FALLBACK.stripe),
		ground: get('--ground', FALLBACK.ground),
		water: get('--water', FALLBACK.water),
		sand: get('--sand', FALLBACK.sand),
		green: get('--green', FALLBACK.green),
		rough: get('--rough', FALLBACK.rough),
		flag: get('--flag', FALLBACK.flag),
		ball: get('--ball', FALLBACK.ball),
		ballOutline: get('--ball-outline', FALLBACK.ballOutline),
		trail: get('--trail', FALLBACK.trail),
		wave: get('--wave', FALLBACK.wave),
		accent: get('--accent', FALLBACK.accent),
		decor: get('--decor', '0') === '1',
	}
}

// ---------- small color/noise helpers ----------

const parseHex = (s: string): [number, number, number] | null => {
	const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s.trim())
	if (!m) return null
	const h = m[1]!
	if (h.length === 3) {
		return [
			Number.parseInt(h[0]! + h[0]!, 16),
			Number.parseInt(h[1]! + h[1]!, 16),
			Number.parseInt(h[2]! + h[2]!, 16),
		]
	}
	return [
		Number.parseInt(h.slice(0, 2), 16),
		Number.parseInt(h.slice(2, 4), 16),
		Number.parseInt(h.slice(4, 6), 16),
	]
}

/** Mix a → b by f (0..1). Falls back to `a` when a color is not plain hex. */
const mixHex = (a: string, b: string, f: number): string => {
	if (f <= 0) return a
	const ca = parseHex(a)
	const cb = parseHex(b)
	if (!ca || !cb) return a
	const r = Math.round(ca[0] + (cb[0] - ca[0]) * f)
	const g = Math.round(ca[1] + (cb[1] - ca[1]) * f)
	const bl = Math.round(ca[2] + (cb[2] - ca[2]) * f)
	return `rgb(${r}, ${g}, ${bl})`
}

/** Deterministic 0..1 noise — decoration never shimmers between frames. */
const hash01 = (n: number): number => {
	const s = Math.sin(n * 127.1) * 43758.5453
	return s - Math.floor(s)
}

/** Where a hole sits in its course: which course + progress 0..1 through it.
 *  Cached by hole identity — courseSpot runs every backdrop frame. */
interface CourseSpot {
	course: number
	t: number
}

let spotHole: HoleSpec | null = null
let spotCache: CourseSpot | null = null

const courseSpot = (hole: HoleSpec): CourseSpot | null => {
	if (spotHole === hole) return spotCache
	spotHole = hole
	spotCache = null
	for (let ci = 0; ci < COURSES.length; ci++) {
		const holes = COURSES[ci]!.holes
		const idx = holes.indexOf(hole)
		if (idx >= 0 && holes.length >= 2) {
			spotCache = { course: ci, t: idx / (holes.length - 1) }
			break
		}
	}
	return spotCache
}

/** Time-of-day: every course runs its own subtle arc — dawn on its first hole
 *  → dusk on its last; holes in no course (range, editor holes) = neutral. */
const skyForHole = (colors: Colors, spot: CourseSpot | null): { top: string; bottom: string } => {
	if (!spot) return { top: colors.skyTop, bottom: colors.skyBottom }
	const dawn = Math.max(0, 1 - spot.t * 2)
	const dusk = Math.max(0, spot.t * 2 - 1)
	if (dawn > 0) {
		return {
			top: mixHex(colors.skyTop, colors.skyDawn, 0.4 * dawn),
			bottom: mixHex(colors.skyBottom, colors.skyDawn, 0.6 * dawn),
		}
	}
	if (dusk > 0) {
		return {
			top: mixHex(colors.skyTop, colors.skyDusk, 0.4 * dusk),
			bottom: mixHex(colors.skyBottom, colors.skyDusk, 0.6 * dusk),
		}
	}
	return { top: colors.skyTop, bottom: colors.skyBottom }
}

/** cupX beyond the terrain's last x = no cup (the practice range). */
const hasCup = (hole: HoleSpec): boolean =>
	hole.cupX <= (hole.terrain[hole.terrain.length - 1]?.[0] ?? hole.length)

const surfaceAt = (hole: HoleSpec, x: number): Surface => {
	for (const z of hole.zones) {
		if (x >= z.from && x < z.to) return z.surface
	}
	return 'fairway'
}

// ---------- terrain & camera ----------

const heightAt = (terrain: Array<[number, number]>, x: number): number => {
	const first = terrain[0]
	if (!first) return 0
	if (x <= first[0]) return first[1]
	for (let i = 1; i < terrain.length; i++) {
		const b = terrain[i]!
		if (x <= b[0]) {
			const a = terrain[i - 1]!
			const span = b[0] - a[0]
			const f = span > 0 ? (x - a[0]) / span : 0
			return a[1] + (b[1] - a[1]) * f
		}
	}
	return terrain[terrain.length - 1]![1]
}

interface Camera {
	xMin: number
	yMin: number
	xs: number // px per m, horizontal
	ys: number // px per m, vertical
	w: number
	h: number
	padBottom: number // px below the lowest terrain point (proportional to h)
}

const sx = (cam: Camera, x: number): number => PAD_X + (x - cam.xMin) * cam.xs
const sy = (cam: Camera, y: number): number => cam.h - cam.padBottom - (y - cam.yMin) * cam.ys

/** Fit the whole hole horizontally; y spans terrain range + apex headroom. */
const camera = (hole: HoleSpec, w: number, h: number, apexY: number): Camera => {
	const t = hole.terrain
	const x0 = t[0]?.[0] ?? 0
	const x1 = t[t.length - 1]?.[0] ?? Math.max(hole.length, 1)
	let yLo = Number.POSITIVE_INFINITY
	let yHi = Number.NEGATIVE_INFINITY
	for (const p of t) {
		if (p[1] < yLo) yLo = p[1]
		if (p[1] > yHi) yHi = p[1]
	}
	if (!Number.isFinite(yLo)) {
		yLo = 0
		yHi = 0
	}
	// idle scenes (no flight apex) need less sky headroom — raise the horizon
	const idle = !Number.isFinite(apexY)
	const top = idle ? yHi + 5 : Math.max(yHi + 10, apexY + 5)
	const lo = yLo - 1
	const padBottom = Math.max(40, Math.round(h * 0.18))
	const xs = Math.max((w - 2 * PAD_X) / Math.max(x1 - x0, 1), 0.01)
	const ys = Math.max((h - PAD_TOP - padBottom) / Math.max(top - lo, 1), 0.01)
	return { xMin: x0, yMin: lo, xs, ys, w, h, padBottom }
}

// ---------- faces ----------

type FaceExpr = 'rest' | 'blink' | 'fly' | 'happy'

interface FaceGeom {
	ex: number // eye horizontal offset (× r)
	ey: number // eye vertical offset (× r)
	er: number // eye radius at rest (× r)
	my: number // mouth center y (× r)
	ms: number // mouth scale
}

// Placed so each character's silhouette stays unmistakable (disc face is
// compressed into the lens; Penny's face sits on her top pancake).
const FACE: Record<ShapeId, FaceGeom> = {
	sphere: { ex: 0.38, ey: -0.22, er: 0.19, my: 0.38, ms: 1 },
	cube: { ex: 0.42, ey: -0.28, er: 0.2, my: 0.42, ms: 1 },
	disc: { ex: 0.55, ey: -0.08, er: 0.14, my: 0.24, ms: 0.7 },
	egg: { ex: 0.34, ey: -0.12, er: 0.17, my: 0.36, ms: 1 },
	star: { ex: 0.24, ey: -0.1, er: 0.15, my: 0.2, ms: 0.8 },
	pancake: { ex: 0.4, ey: -0.62, er: 0.14, my: -0.34, ms: 0.8 },
}

/** Big high-contrast face in the ball-outline color; scales with the glyph. */
const drawFace = (
	c: CanvasRenderingContext2D,
	shape: ShapeId | null,
	expr: FaceExpr,
	colors: Colors,
): void => {
	const r = BALL_HALF_PX
	const p = FACE[shape ?? 'sphere']
	const lw = Math.max(2.6, 0.13 * r)
	c.fillStyle = colors.ballOutline
	c.strokeStyle = colors.ballOutline
	c.lineWidth = lw
	c.lineCap = 'round'
	for (const side of [-1, 1]) {
		const ex = side * p.ex * r
		const ey = p.ey * r
		if (expr === 'blink') {
			c.beginPath()
			c.moveTo(ex - p.er * r, ey)
			c.lineTo(ex + p.er * r, ey)
			c.stroke()
		} else if (expr === 'happy') {
			c.beginPath()
			c.arc(ex, ey + 0.06 * r, p.er * r * 1.25, Math.PI, 2 * Math.PI)
			c.stroke()
		} else {
			const er = p.er * r * (expr === 'fly' ? 1.45 : 1)
			c.beginPath()
			c.arc(ex, ey, er, 0, 2 * Math.PI)
			c.fill()
		}
	}
	// mouth: small o in flight, big smile when happy, small smile otherwise
	c.beginPath()
	if (expr === 'fly') {
		c.arc(0, p.my * r, 0.11 * r * p.ms + 1.5, 0, 2 * Math.PI)
	} else if (expr === 'happy') {
		c.arc(0, (p.my - 0.06) * r, 0.3 * r * p.ms, 0.12 * Math.PI, 0.88 * Math.PI)
	} else {
		c.arc(0, (p.my - 0.04) * r, 0.2 * r * p.ms, 0.15 * Math.PI, 0.85 * Math.PI)
	}
	c.stroke()
}

// ---------- glyphs ----------

/** Draw the ball as its character, centered on the current origin (pre-translated). */
const drawShape = (
	c: CanvasRenderingContext2D,
	shape: ShapeId | null,
	rot: number,
	colors: Colors,
	face: FaceExpr,
): void => {
	const r = BALL_HALF_PX
	c.save()
	c.rotate(rot)
	c.fillStyle = colors.ball
	c.strokeStyle = colors.ballOutline
	c.lineWidth = OUTLINE_PX
	c.lineJoin = 'round'
	switch (shape) {
		case 'cube':
			c.beginPath()
			c.rect(-r, -r, 2 * r, 2 * r)
			c.fill()
			c.stroke()
			break
		case 'disc':
			c.beginPath()
			c.ellipse(0, 0, 1.5 * r, 0.5 * r, 0, 0, Math.PI * 2)
			c.fill()
			c.stroke()
			break
		case 'egg':
			c.beginPath()
			c.moveTo(0, -r) // narrow top
			c.bezierCurveTo(0.6 * r, -0.75 * r, r, 0.55 * r, 0, r)
			c.bezierCurveTo(-r, 0.55 * r, -0.6 * r, -0.75 * r, 0, -r)
			c.closePath()
			c.fill()
			c.stroke()
			break
		case 'star': {
			const outer = 1.35 * r
			const inner = 0.55 * r
			c.beginPath()
			for (let i = 0; i < 10; i++) {
				const rad = i % 2 === 0 ? outer : inner
				const a = (Math.PI * i) / 5 - Math.PI / 2
				const px = Math.cos(a) * rad
				const py = Math.sin(a) * rad
				if (i === 0) c.moveTo(px, py)
				else c.lineTo(px, py)
			}
			c.closePath()
			c.fill()
			c.stroke()
			break
		}
		case 'pancake':
			for (const dy of [0.55 * r, 0, -0.55 * r]) {
				c.beginPath()
				c.ellipse(0, dy, 1.5 * r, 0.42 * r, 0, 0, Math.PI * 2)
				c.fill()
				c.stroke()
			}
			break
		default:
			// sphere, or no shape chosen yet
			c.beginPath()
			c.arc(0, 0, r, 0, Math.PI * 2)
			c.fill()
			c.stroke()
			break
	}
	drawFace(c, shape, face, colors)
	c.restore()
}

/** Tumble while airborne: star and cube spin, disc wobbles, egg rocks. */
const spin = (shape: ShapeId, simT: number, phase: FlightPhase): number => {
	if (phase === 'roll') return 0
	switch (shape) {
		case 'cube':
			return simT * 4
		case 'star':
			return simT * 6.5
		case 'disc':
			return Math.sin(simT * 6) * 0.3
		case 'egg':
			return Math.sin(simT * 5) * 0.5
		default:
			return 0
	}
}

/**
 * Render one character (with face, idle expression) onto a small square
 * canvas the caller sizes via CSS. Handles devicePixelRatio; reads colors
 * from the CSS tokens like the renderer does. The HUD calls this for the
 * shape-rack rows.
 */
export function drawShapeGlyph(canvas: HTMLCanvasElement, shape: ShapeId): void {
	const c = canvas.getContext('2d')
	if (!c) return
	// the rack rows live inside .main, whose `.main canvas` rule absolutely
	// positions every canvas — pin this one back into normal flow so it sits
	// beside its label instead of over the course view
	canvas.style.position = 'static'
	const dpr = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1
	const size = canvas.clientWidth || canvas.clientHeight || 48
	const px = Math.max(1, Math.round(size * dpr))
	canvas.width = px
	canvas.height = px
	const colors = readColors()
	c.setTransform(dpr, 0, 0, dpr, 0, 0)
	c.clearRect(0, 0, size, size)
	c.save()
	c.translate(size / 2, size / 2)
	// widest glyph is the disc (3r) — fit it with a little margin for outlines
	c.scale(size / (3.6 * BALL_HALF_PX), size / (3.6 * BALL_HALF_PX))
	drawShape(c, shape, 0, colors, 'rest')
	c.restore()
}

// ---------- background decor (muted tokens only — never the foreground) ----------

/** One band of rolling hills; bump heights vary deterministically by world slot. */
const drawHills = (
	c: CanvasRenderingContext2D,
	w: number,
	h: number,
	baseY: number,
	amp: number,
	period: number,
	offset: number,
	color: string,
): void => {
	c.fillStyle = color
	const phase = ((offset % period) + period) % period
	const base = Math.floor(offset / period)
	c.beginPath()
	const startX = -phase - period
	c.moveTo(startX, baseY)
	let x = startX
	let k = -1
	while (x < w + period) {
		const a = amp * (0.6 + 0.8 * hash01(base + k))
		c.quadraticCurveTo(x + period / 2, baseY - a, x + period, baseY)
		x += period
		k++
	}
	c.lineTo(x, h)
	c.lineTo(startX, h)
	c.closePath()
	c.fill()
}

/** A low ridge with simple tree clusters (two overlapping canopies each). */
const drawTrees = (
	c: CanvasRenderingContext2D,
	w: number,
	h: number,
	baseY: number,
	offset: number,
	color: string,
): void => {
	c.fillStyle = color
	c.fillRect(0, baseY, w, Math.max(0, h - baseY))
	const spacing = 230
	const phase = ((offset % spacing) + spacing) % spacing
	const base = Math.floor(offset / spacing)
	for (let k = -1, x = -phase - spacing; x < w + spacing; k++, x += spacing) {
		const j = hash01(base + k)
		const cx = x + j * 120
		const r1 = 11 + j * 7
		// no trunks (sub-6px marks are noise) — canopies sit ON the band line
		c.beginPath()
		c.arc(cx, baseY - r1 * 0.7, r1, 0, 2 * Math.PI)
		c.arc(cx + r1 * 0.85, baseY - r1 * 0.4, r1 * 0.65, 0, 2 * Math.PI)
		c.fill()
	}
}

// ---------- factory ----------

export const createRenderer = (): Renderer => {
	let canvas: HTMLCanvasElement | null = null
	let ctx: CanvasRenderingContext2D | null = null
	let colors = FALLBACK
	let cssW = 1
	let cssH = 1
	let raf = 0
	let paused = false
	let lastTs = 0
	let idleBlink = false
	let colorStamp = 0

	interface Trail {
		pts: FlightPoint[]
		simT: number
	}

	interface IdleScene {
		kind: 'idle'
		hole: HoleSpec
		ball: BallState
		shape: ShapeId | null
		trail: Trail | null
		face: 'rest' | 'happy'
	}

	interface Fx {
		kind: 'dust' | 'sand' | 'splash'
		x: number // m
		y: number // m — ground (or water surface) at the impact
		t0: number // scene elapsed (wall s) when fired
		strength: number
	}

	interface FlightScene {
		kind: 'flight'
		hole: HoleSpec
		outcome: StrikeOutcome
		shape: ShapeId
		duration: number
		simEnd: number
		apexY: number
		elapsed: number
		evIdx: number
		ptIdx: number
		done: boolean
		holedT: number | null // sim time of the holed event, if any
		fx: Fx[]
		onEvent: (e: FlightEvent) => void
		onDone: () => void
		onFrame: ((x: number, y: number, phase: FlightPhase) => void) | undefined
	}

	let scene: IdleScene | FlightScene | null = null

	const stopLoop = (): void => {
		if (raf !== 0) {
			cancelAnimationFrame(raf)
			raf = 0
		}
	}

	const startLoop = (): void => {
		if (raf === 0 && typeof requestAnimationFrame === 'function') {
			raf = requestAnimationFrame(tick)
		}
	}

	// ---------- cached decor lookups (nothing allocated per frame) ----------

	let skyKey = ''
	let skyGrad: CanvasGradient | null = null

	const skyFill = (
		c: CanvasRenderingContext2D,
		cam: Camera,
		spot: CourseSpot | null,
	): CanvasGradient => {
		const key = `${spot ? `${spot.course}/${spot.t}` : 'none'}|${cam.h}|${colorStamp}`
		if (key !== skyKey || !skyGrad) {
			const mixed = skyForHole(colors, spot)
			const g = c.createLinearGradient(0, 0, 0, cam.h)
			g.addColorStop(0, mixed.top)
			g.addColorStop(1, mixed.bottom)
			skyKey = key
			skyGrad = g
		}
		return skyGrad
	}

	let spanHole: HoleSpec | null = null
	let spanList: Array<[number, number]> = []

	const fairwaySpans = (hole: HoleSpec, xEnd: number): Array<[number, number]> => {
		if (spanHole !== hole) {
			const zones = [...hole.zones].sort((a, b) => a.from - b.from)
			const out: Array<[number, number]> = []
			let x = 0
			for (const z of zones) {
				if (z.from > x) out.push([x, Math.min(z.from, xEnd)])
				x = Math.max(x, z.to)
			}
			if (x < xEnd) out.push([x, xEnd])
			spanHole = hole
			spanList = out
		}
		return spanList
	}

	// ---------- scene painting ----------

	const fillSpan = (
		c: CanvasRenderingContext2D,
		cam: Camera,
		terrain: Array<[number, number]>,
		from: number,
		to: number,
		color: string,
	): void => {
		c.fillStyle = color
		c.beginPath()
		c.moveTo(sx(cam, from), sy(cam, heightAt(terrain, from)))
		for (const p of terrain) {
			if (p[0] > from && p[0] < to) c.lineTo(sx(cam, p[0]), sy(cam, p[1]))
		}
		c.lineTo(sx(cam, to), sy(cam, heightAt(terrain, to)))
		c.lineTo(sx(cam, to), cam.h)
		c.lineTo(sx(cam, from), cam.h)
		c.closePath()
		c.fill()
	}

	/** Sky gradient + drifting silhouette bands (non-high-contrast only). */
	const drawBackdrop = (
		c: CanvasRenderingContext2D,
		cam: Camera,
		hole: HoleSpec,
		t: number,
	): void => {
		c.fillStyle = skyFill(c, cam, courseSpot(hole))
		c.fillRect(0, 0, cam.w, cam.h)
		// anchor the bands to the far-end terrain height, clamped near the valley
		// floor — never the peak, or raised tees get a slab of silhouette fill
		let yLo = Number.POSITIVE_INFINITY
		for (const p of hole.terrain) {
			if (p[1] < yLo) yLo = p[1]
		}
		const yEnd = hole.terrain[hole.terrain.length - 1]?.[1] ?? 0
		const horizon = Number.isFinite(yLo)
			? Math.max(sy(cam, yEnd), sy(cam, yLo) - 140)
			: cam.h - cam.padBottom
		drawHills(c, cam.w, cam.h, horizon - 40, 22, 300, t * 3, colors.sil1)
		drawTrees(c, cam.w, cam.h, horizon - 10, t * 7, colors.sil2)
		drawHills(c, cam.w, cam.h, horizon - 4, 15, 170, 40 + t * 12, colors.sil3)
	}

	/** Faint mowing stripes on fairway; contrast fades with distance from the tee. */
	const drawStripes = (
		c: CanvasRenderingContext2D,
		cam: Camera,
		hole: HoleSpec,
		xEnd: number,
	): void => {
		const period = (2 * STRIPE_PX) / cam.xs // m
		const width = STRIPE_PX / cam.xs
		for (const span of fairwaySpans(hole, xEnd)) {
			for (let x = Math.floor(span[0] / period) * period; x < span[1]; x += period) {
				const a = Math.max(x, span[0])
				const b = Math.min(x + width, span[1])
				if (b <= a) continue
				const alpha = STRIPE_ALPHA * Math.max(0, 1 - (a + b) / 2 / (hole.length * 0.8))
				if (alpha <= 0.005) break // farther stripes only fade more
				c.globalAlpha = alpha
				fillSpan(c, cam, hole.terrain, a, b, colors.stripe)
			}
		}
		c.globalAlpha = 1
	}

	/** Stipple dots inside a sand fill (deterministic — no shimmer). */
	const drawStipple = (
		c: CanvasRenderingContext2D,
		cam: Camera,
		terrain: Array<[number, number]>,
		from: number,
		to: number,
	): void => {
		c.fillStyle = colors.ballOutline
		c.globalAlpha = 0.22
		let i = 0
		for (let x = from + 1.5; x < to; x += 3, i++) {
			const seed = from * 13 + i
			const px = sx(cam, x) + (hash01(seed) - 0.5) * 6
			const py = sy(cam, heightAt(terrain, x)) + 5 + hash01(seed + 0.5) * 14
			c.beginPath()
			c.arc(px, py, 2.2, 0, 2 * Math.PI)
			c.fill()
		}
		c.globalAlpha = 1
	}

	const drawWater = (
		c: CanvasRenderingContext2D,
		cam: Camera,
		terrain: Array<[number, number]>,
		from: number,
		to: number,
		animT: number | null,
	): void => {
		const surfY = Math.min(heightAt(terrain, from), heightAt(terrain, to)) - 0.1
		const px0 = sx(cam, from)
		const px1 = sx(cam, to)
		const py = sy(cam, surfY)
		c.fillStyle = colors.water
		c.fillRect(px0, py, px1 - px0, cam.h - py)
		// wave marks: a few chunky double bumps at the surface — they bob
		// gently while the flight animates (never on high-contrast)
		const bobT = animT !== null && colors.decor ? animT : null
		c.strokeStyle = colors.wave
		c.lineWidth = 3
		c.lineCap = 'round'
		for (let i = 1; i <= 3; i++) {
			const wx = px0 + ((px1 - px0) * i) / 4
			const wy = py + 8 + (bobT !== null ? Math.sin(bobT * 1.8 + i * 1.3) * 2 : 0)
			c.beginPath()
			c.moveTo(wx - 12, wy)
			c.quadraticCurveTo(wx - 6, wy - 7, wx, wy)
			c.quadraticCurveTo(wx + 6, wy - 7, wx + 12, wy)
			c.stroke()
		}
	}

	const drawFlag = (
		c: CanvasRenderingContext2D,
		cam: Camera,
		hole: HoleSpec,
		animT: number | null,
	): void => {
		const fx = sx(cam, hole.cupX)
		const fy = sy(cam, heightAt(hole.terrain, hole.cupX))
		// cup notch
		c.fillStyle = colors.ballOutline
		c.fillRect(fx - 6, fy, 12, 9)
		// tall pole
		c.strokeStyle = colors.flag
		c.lineWidth = 5
		c.lineCap = 'round'
		c.beginPath()
		c.moveTo(fx, fy)
		c.lineTo(fx, fy - FLAG_POLE_PX)
		c.stroke()
		// big triangle flag — the tip ripples subtly while the flight animates
		const rip = animT !== null ? Math.sin(animT * 3.4) : 0
		c.fillStyle = colors.flag
		c.beginPath()
		c.moveTo(fx, fy - FLAG_POLE_PX)
		c.lineTo(
			fx - 38 + rip * 3,
			fy - FLAG_POLE_PX + 14 + Math.sin(animT !== null ? animT * 3.4 + 1.2 : 0) * 1.6,
		)
		c.lineTo(fx, fy - FLAG_POLE_PX + 28)
		c.closePath()
		c.fill()
		c.strokeStyle = colors.ballOutline
		c.lineWidth = 2
		c.stroke()
	}

	const drawTrail = (c: CanvasRenderingContext2D, cam: Camera, trail: Trail): void => {
		const pts = trail.pts
		c.strokeStyle = colors.trail
		c.lineWidth = TRAIL_PX
		c.lineCap = 'round'
		let prev = pts[0]
		if (!prev) return
		for (let i = TRAIL_STRIDE; i < pts.length; i += TRAIL_STRIDE) {
			const p = pts[i]!
			if (p.t > trail.simT) break
			const age = trail.simT - p.t
			c.globalAlpha = Math.max(TRAIL_MIN_ALPHA, 1 - age / TRAIL_FADE_S)
			c.beginPath()
			c.moveTo(sx(cam, prev.x), sy(cam, prev.y))
			c.lineTo(sx(cam, p.x), sy(cam, p.y))
			c.stroke()
			prev = p
		}
		c.globalAlpha = 1
	}

	interface BallDraw {
		x: number
		y: number
		shape: ShapeId | null
		rot: number
		face: FaceExpr
		hopPx: number
	}

	const renderScene = (
		cam: Camera,
		hole: HoleSpec,
		trail: Trail | null,
		ball: BallDraw | null,
		animT: number | null,
	): void => {
		const c = ctx
		if (!c) return
		const t = hole.terrain
		const xEnd = t[t.length - 1]?.[0] ?? hole.length
		// sky (+ parallax backdrop on decorated themes; high-contrast stays flat)
		if (colors.decor) {
			drawBackdrop(c, cam, hole, animT ?? 0)
		} else {
			c.fillStyle = colors.sky
			c.fillRect(0, 0, cam.w, cam.h)
		}
		// terrain silhouette — run to the canvas edges so no gutter seams show
		// below the horizon (heightAt clamps beyond the polyline)
		const xPad = PAD_X / cam.xs
		fillSpan(c, cam, t, cam.xMin - xPad, xEnd + xPad, colors.ground)
		if (colors.decor) drawStripes(c, cam, hole, xEnd)
		// zones (a zone touching either end extends to the canvas edge too)
		for (const z of hole.zones) {
			let from = Math.max(z.from, cam.xMin)
			let to = Math.min(z.to, xEnd)
			if (to <= from) continue
			if (z.from <= cam.xMin + 0.01) from = cam.xMin - xPad
			if (z.to >= xEnd - 0.01) to = xEnd + xPad
			if (z.surface === 'water') drawWater(c, cam, t, from, to, animT)
			else if (z.surface !== 'fairway') {
				const zc =
					z.surface === 'sand' ? colors.sand : z.surface === 'green' ? colors.green : colors.rough
				fillSpan(c, cam, t, from, to, zc)
				if (z.surface === 'sand' && colors.decor) drawStipple(c, cam, t, from, to)
			}
		}
		if (hasCup(hole)) drawFlag(c, cam, hole, animT)
		if (trail) drawTrail(c, cam, trail)
		if (ball) {
			c.save()
			c.translate(sx(cam, ball.x), sy(cam, ball.y) - BALL_HALF_PX - ball.hopPx)
			drawShape(c, ball.shape, ball.rot, colors, ball.face)
			c.restore()
		}
	}

	const renderIdle = (s: IdleScene): void => {
		const apex = s.trail ? apexOf(s.trail.pts) : Number.NEGATIVE_INFINITY
		const cam = camera(s.hole, cssW, cssH, apex)
		const y = heightAt(s.hole.terrain, s.ball.x)
		const face: FaceExpr =
			s.face === 'happy' ? 'happy' : idleBlink && !reduceMotionNow() ? 'blink' : 'rest'
		renderScene(
			cam,
			s.hole,
			s.trail,
			{ x: s.ball.x, y, shape: s.shape, rot: 0, face, hopPx: 0 },
			null,
		)
	}

	const apexOf = (pts: FlightPoint[]): number => {
		let apex = Number.NEGATIVE_INFINITY
		for (const p of pts) {
			if (p.y > apex) apex = p.y
		}
		return apex
	}

	const posAt = (s: FlightScene, simT: number): { x: number; y: number; phase: FlightPhase } => {
		const pts = s.outcome.points
		while (s.ptIdx + 1 < pts.length && pts[s.ptIdx + 1]!.t <= simT) s.ptIdx++
		const a = pts[s.ptIdx]
		if (!a) {
			const x = s.outcome.end.x
			return { x, y: heightAt(s.hole.terrain, x), phase: 'roll' }
		}
		const b = pts[s.ptIdx + 1]
		if (!b || b.t <= a.t) return { x: a.x, y: a.y, phase: a.phase }
		const f = Math.min(Math.max((simT - a.t) / (b.t - a.t), 0), 1)
		return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, phase: a.phase }
	}

	// ---------- impact moments (chunky flat shapes, >= 6px, short-lived) ----------

	const FX_DUR: Record<Fx['kind'], number> = { dust: 0.5, sand: 0.7, splash: 0.9 }

	const drawFxAll = (c: CanvasRenderingContext2D, cam: Camera, s: FlightScene): void => {
		for (const f of s.fx) {
			const u = (s.elapsed - f.t0) / FX_DUR[f.kind]
			if (u < 0 || u >= 1) continue
			const px = sx(cam, f.x)
			const py = sy(cam, f.y)
			if (f.kind === 'dust') {
				const k = 0.6 + 0.6 * f.strength
				c.fillStyle = colors.trail
				c.globalAlpha = (1 - u) * 0.65
				for (const i of [-1, 0, 1]) {
					const rx = (4 + 9 * u) * k
					c.beginPath()
					c.ellipse(
						px + i * (10 + 16 * u) * k,
						py - 4 - 12 * u - Math.abs(i) * 2,
						rx,
						Math.max(3, rx * 0.4),
						0,
						0,
						2 * Math.PI,
					)
					c.fill()
				}
			} else if (f.kind === 'sand') {
				c.fillStyle = colors.sand
				c.globalAlpha = (1 - u) * 0.85
				for (let i = 0; i < 5; i++) {
					const j = hash01(f.x * 7 + i)
					const rx = 6 + 12 * u * (0.6 + 0.6 * j)
					c.beginPath()
					c.ellipse(
						px + (i - 2) * (9 + 14 * u),
						py - 6 - 18 * u * (0.7 + 0.6 * j),
						rx,
						Math.max(3.5, rx * 0.5),
						0,
						0,
						2 * Math.PI,
					)
					c.fill()
				}
			} else {
				// splash: expanding surface rings + a few fat droplets
				c.strokeStyle = colors.wave
				c.lineWidth = 5
				for (const j of [0, 1]) {
					const ur = u * 1.3 - j * 0.25
					if (ur <= 0 || ur >= 1) continue
					const rr = 8 + 34 * ur
					c.globalAlpha = (1 - ur) * 0.8
					c.beginPath()
					c.ellipse(px, py, rr, rr * 0.35, 0, 0, 2 * Math.PI)
					c.stroke()
				}
				c.fillStyle = colors.wave
				c.globalAlpha = 1 - u
				for (const j of [-1, 0, 1]) {
					const hgt = 26 + 10 * hash01(f.x * 3 + j)
					c.beginPath()
					c.arc(px + j * (14 + 26 * u), py - hgt * 4 * u * (1 - u), 3.5, 0, 2 * Math.PI)
					c.fill()
				}
			}
		}
		c.globalAlpha = 1
	}

	/** Visual half of the cup beeper: pulsing ground ring at the flag base. */
	const drawBeeper = (
		c: CanvasRenderingContext2D,
		cam: Camera,
		hole: HoleSpec,
		t: number,
	): void => {
		const px = sx(cam, hole.cupX)
		const py = sy(cam, heightAt(hole.terrain, hole.cupX))
		const r = 11 + Math.sin(t * 7) * 3.5
		c.strokeStyle = colors.accent
		c.lineWidth = 5
		c.globalAlpha = 0.55 + 0.35 * Math.sin(t * 7)
		c.beginPath()
		c.ellipse(px, py, r, r * 0.45, 0, 0, 2 * Math.PI)
		c.stroke()
		c.globalAlpha = 1
	}

	/** Holed: ONE clean expanding pulse ring from the cup. Restraint, no confetti. */
	const drawPulse = (c: CanvasRenderingContext2D, cam: Camera, hole: HoleSpec, u: number): void => {
		if (u <= 0 || u >= 1) return
		const px = sx(cam, hole.cupX)
		const py = sy(cam, heightAt(hole.terrain, hole.cupX))
		const r = 10 + 58 * u
		c.strokeStyle = colors.accent
		c.lineWidth = 6
		c.globalAlpha = 0.9 * (1 - u)
		c.beginPath()
		c.ellipse(px, py, r, r * 0.5, 0, 0, 2 * Math.PI)
		c.stroke()
		c.globalAlpha = 1
	}

	const renderFlight = (s: FlightScene, simT: number): void => {
		const cam = camera(s.hole, cssW, cssH, s.apexY)
		const pos = posAt(s, simT)
		// anticipation: during the pre-roll the ball rests at its start position
		// and leans back (ease-in), then releases into the normal playback
		const preU = s.elapsed < PRE_S ? s.elapsed / PRE_S : null
		const rot = preU !== null ? -0.18 * (1 - (1 - preU) ** 3) : spin(s.shape, simT, pos.phase)
		const holedNow = s.holedT !== null && simT >= s.holedT
		const after = Math.max(0, s.elapsed - PRE_S - s.duration)
		let hop = 0
		if (after > 0 && s.outcome.holed && s.shape === 'pancake' && charactersNow()) {
			// Penny's single tap-bounce: her cheer, inside the still beat
			const u = (after - PENNY_TAP_AT) / PENNY_TAP_S
			if (u >= 0 && u <= 1) hop = Math.sin(Math.PI * u) * 9
		}
		const face: FaceExpr = holedNow
			? 'happy'
			: preU !== null || pos.phase === 'roll'
				? 'rest'
				: 'fly'
		renderScene(
			cam,
			s.hole,
			{ pts: s.outcome.points, simT },
			{ x: pos.x, y: pos.y, shape: s.shape, rot, face, hopPx: hop },
			s.elapsed,
		)
		const c = ctx
		if (!c) return
		drawFxAll(c, cam, s)
		if (
			after === 0 &&
			!holedNow &&
			hasCup(s.hole) && // the range has no cup — no beeper ring either
			pos.phase === 'roll' &&
			Math.abs(pos.x - s.hole.cupX) <= BEEP_NEAR_M
		) {
			drawBeeper(c, cam, s.hole, s.elapsed)
		}
		if (s.outcome.holed && after > AFTER_BEAT_S) {
			drawPulse(c, cam, s.hole, (after - AFTER_BEAT_S) / AFTER_PULSE_S)
		}
	}

	const simTOf = (s: FlightScene): number => {
		// sim time holds at 0 through the anticipation pre-roll
		const u = Math.min(Math.max(0, s.elapsed - PRE_S) / s.duration, 1)
		const frac = 1 - (1 - u) * (1 - u) // ease-out: playback slows near the end
		return frac * s.simEnd
	}

	const renderCurrent = (): void => {
		if (!ctx || !scene) return
		if (scene.kind === 'idle') renderIdle(scene)
		else renderFlight(scene, simTOf(scene))
	}

	const pushFx = (s: FlightScene, e: FlightEvent): void => {
		if (e.kind === 'bounce') {
			s.fx.push({
				kind: 'dust',
				x: e.x,
				y: heightAt(s.hole.terrain, e.x),
				t0: s.elapsed,
				strength: e.strength ?? 0.5,
			})
		} else if (e.kind === 'land' && surfaceAt(s.hole, e.x) === 'sand') {
			s.fx.push({
				kind: 'sand',
				x: e.x,
				y: heightAt(s.hole.terrain, e.x),
				t0: s.elapsed,
				strength: e.strength ?? 0.7,
			})
		} else if (e.kind === 'splash') {
			// splash sits on the water surface, not the pond floor
			let y = heightAt(s.hole.terrain, e.x)
			for (const z of s.hole.zones) {
				if (z.surface === 'water' && e.x >= z.from && e.x < z.to) {
					y = Math.min(heightAt(s.hole.terrain, z.from), heightAt(s.hole.terrain, z.to)) - 0.1
					break
				}
			}
			s.fx.push({ kind: 'splash', x: e.x, y, t0: s.elapsed, strength: e.strength ?? 1 })
		}
	}

	const fireEvents = (s: FlightScene, simT: number): void => {
		const evs = s.outcome.events
		while (s.evIdx < evs.length) {
			const e = evs[s.evIdx]!
			if (e.t > simT) break
			s.evIdx++
			pushFx(s, e)
			s.onEvent(e)
		}
	}

	const tick = (ts: number): void => {
		raf = 0
		const s = scene
		if (!s || paused) return
		if (s.kind === 'idle') {
			// idle loop only exists for the occasional blink; repaint only on change
			if (reduceMotionNow()) return
			const blink = (ts / 1000) % BLINK_PERIOD_S < BLINK_LEN_S
			if (blink !== idleBlink) {
				idleBlink = blink
				renderIdle(s)
			}
			startLoop()
			return
		}
		if (s.done) return
		if (lastTs === 0) lastTs = ts
		const dt = Math.min((ts - lastTs) / 1000, 0.1)
		lastTs = ts
		s.elapsed += dt
		const inFlight = s.elapsed < s.duration + PRE_S
		const simT = inFlight ? simTOf(s) : s.simEnd
		// no events (and no onFrame) during the anticipation pre-roll
		if (s.elapsed >= PRE_S) fireEvents(s, inFlight ? simT : Number.POSITIVE_INFINITY)
		renderFlight(s, simT)
		if (inFlight && s.elapsed >= PRE_S && s.onFrame) {
			const pos = posAt(s, simT) // pos.y is the interpolated ball height
			s.onFrame(pos.x, pos.y, pos.phase)
		}
		if (!inFlight) {
			// holed moment (motion allowed): a beat of stillness, one pulse ring,
			// the ball happy at the cup — then hand control back via onDone
			const glow = s.outcome.holed && !reduceMotionNow()
			if (!glow || s.elapsed - PRE_S - s.duration >= AFTER_TOTAL_S) {
				s.done = true
				s.onDone()
				return
			}
		}
		startLoop()
	}

	// ---------- Renderer contract ----------

	const resize = (): void => {
		if (!canvas || !ctx) return
		const dpr = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1
		const w = canvas.clientWidth || cssW
		const h = canvas.clientHeight || cssH
		cssW = Math.max(1, w)
		cssH = Math.max(1, h)
		canvas.width = Math.max(1, Math.round(cssW * dpr))
		canvas.height = Math.max(1, Math.round(cssH * dpr))
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
		renderCurrent()
	}

	return {
		attach(cv: HTMLCanvasElement): void {
			canvas = cv
			ctx = cv.getContext('2d')
			colors = readColors()
			colorStamp++
			resize()
		},

		resize,

		drawIdle(hole: HoleSpec, ball: BallState, shape: ShapeId | null, trail?: FlightPoint[]): void {
			stopLoop()
			// a fully-faded previous stroke stays as a TRAIL_MIN_ALPHA ghost
			const ghost =
				trail && trail.length > 0 ? { pts: trail, simT: trail[trail.length - 1]!.t } : null
			scene = { kind: 'idle', hole, ball, shape, trail: ghost, face: 'rest' }
			renderCurrent()
			if (!reduceMotionNow()) startLoop()
		},

		animateFlight(hole, outcome, shape, opts): void {
			stopLoop()
			const pts = outcome.points
			if (opts.reduceMotion || !ctx || pts.length === 0) {
				// summarize: final state (with the full flight path), events in order, done
				const trail = pts.length > 0 ? { pts, simT: pts[pts.length - 1]!.t } : null
				scene = {
					kind: 'idle',
					hole,
					ball: outcome.end,
					shape,
					trail,
					face: outcome.holed ? 'happy' : 'rest',
				}
				renderCurrent()
				for (const e of outcome.events) opts.onEvent(e)
				opts.onDone()
				return
			}
			let simEnd = pts[pts.length - 1]!.t
			let holedT: number | null = null
			for (const e of outcome.events) {
				simEnd = Math.max(simEnd, e.t)
				if (e.kind === 'holed') holedT = e.t
			}
			const duration = Math.min(Math.max(simEnd * PLAY_SCALE, MIN_PLAY_S), MAX_PLAY_S)
			scene = {
				kind: 'flight',
				hole,
				outcome,
				shape,
				duration,
				simEnd,
				apexY: apexOf(pts),
				elapsed: 0,
				evIdx: 0,
				ptIdx: 0,
				done: false,
				holedT,
				fx: [],
				onEvent: opts.onEvent,
				onDone: opts.onDone,
				onFrame: opts.onFrame,
			}
			paused = false
			lastTs = 0
			startLoop()
		},

		pause(): void {
			paused = true
			stopLoop()
		},

		resume(): void {
			if (!paused) return
			paused = false
			lastTs = 0
			if (scene?.kind === 'flight' && !scene.done) startLoop()
			else if (scene?.kind === 'idle' && !reduceMotionNow()) startLoop()
		},

		setTheme(_theme: Theme): void {
			colors = readColors()
			colorStamp++
			renderCurrent()
		},
	}
}
