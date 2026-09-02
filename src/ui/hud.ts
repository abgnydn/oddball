// Builds the DOM per the theme.css contract: .header / .main / .caption-bar /
// .footer as flex children (via #app { display: contents }). The flow drives it.

import './theme.css'
import { GAME_TITLE } from '../game/lines'
import { drawShapeGlyph } from '../render/draw'
import { INPUT_COOLDOWN_MS } from '../tuning'
import type { FontScale, ScanItem, Settings, ShapeId } from '../types'

export interface HudItemSpec {
	id: string
	label: string
	speak: string
	/** See ScanItem.hold — warnings only. */
	hold?: boolean
	glyph?: ShapeId // character portrait drawn beside the label (rack rows)
}

export interface Hud {
	canvas: HTMLCanvasElement
	setScreen(name: string): void
	setMode(name: string): void
	/** Click handler for the on-screen Pause button (pointer/touch parity with
	 *  holding Enter). Switch users also have a scannable Menu row in the rack. */
	onPause(cb: () => void): void
	/** Replace the scan panel contents; returns ScanItems with live elements. */
	scanList(items: HudItemSpec[]): ScanItem[]
	/** Show canvas instead of the scan panel (flight view) or both. */
	showPanel(show: boolean): void
	caption(text: string): void
	footerFocus(label: string): void
	/** Show the context-menu overlay; returns its ScanItems. */
	/** Hold-progress ring (§4). `p` is 0..1 once the hold passes HOLD_SHOW_MS;
	 *  null hides it. Purely an indicator — it never selects anything. */
	holdProgress(p: number | null): void
	overlay(items: HudItemSpec[]): ScanItem[]
	hideOverlay(): void
	overlayOpen(): boolean
	applySettings(s: Settings): void
}

const el = <K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className?: string,
	text?: string,
): HTMLElementTagNameMap[K] => {
	const n = document.createElement(tag)
	if (className) n.className = className
	if (text !== undefined) n.textContent = text
	return n
}

const buildList = (container: HTMLElement, items: HudItemSpec[], idPrefix = 'scan'): ScanItem[] => {
	container.textContent = ''
	const list = el('div', 'scan-list')
	container.appendChild(list)
	return items.map((spec) => {
		const row = el('div', 'scan-item')
		row.id = `${idPrefix}-${spec.id}`
		if (spec.glyph) {
			row.style.display = 'flex'
			row.style.alignItems = 'center'
			row.style.gap = '0.8rem'
			const glyph = document.createElement('canvas')
			glyph.className = 'scan-glyph' // sized by theme.css so it can cap on short screens
			row.appendChild(glyph)
			const shape = spec.glyph
			// draw after layout so the canvas has real CSS pixels to measure
			requestAnimationFrame(() => drawShapeGlyph(glyph, shape))
		}
		row.appendChild(el('span', '', spec.label))
		list.appendChild(row)
		return {
			id: spec.id,
			label: spec.label,
			speak: spec.speak,
			el: row,
			...(spec.hold === true ? { hold: true } : {}),
		}
	})
}

export function createHud(root: HTMLElement): Hud {
	root.style.display = 'contents'

	const header = el('header', 'header')
	const title = el('div', 'header-title', GAME_TITLE)
	const screen = el('div', 'header-screen')
	header.append(title, screen)

	const main = el('main', 'main')
	main.style.display = 'flex'
	const canvasWrap = el('div', 'canvas-wrap')
	canvasWrap.style.cssText = 'position:relative;flex:1;min-width:0;'
	const canvas = document.createElement('canvas')
	canvasWrap.appendChild(canvas)
	const panel = el('div', 'scan-panel') // laid out by theme.css, not inline
	main.append(canvasWrap, panel)

	const captionBar = el('div', 'caption-bar')

	const footer = el('footer', 'footer')
	const mode = el('div', 'footer-mode')
	const focus = el('div', 'footer-focus')
	const legend = el(
		'div',
		'footer-legend',
		'Space = next · Hold Space = back · Enter = pick · Hold Enter = menu',
	)
	// On-screen Pause, required alongside the hold gesture so mouse, touch and
	// caregivers have a visible route to it. Switch users reach the menu by
	// holding Enter, or by the scannable Menu row at the end of the rack.
	const pauseBtn = el('button', 'footer-pause', 'Pause')
	pauseBtn.type = 'button'
	footer.append(mode, focus, legend, pauseBtn)

	// Hold-progress ring. §4: a hold with no feedback reads as broken, so
	// partway through the gesture a ring appears and fills. Sits over the canvas
	// and is never in the scan order — it indicates, it does not select.
	const ringWrap = el('div', 'hold-ring')
	ringWrap.setAttribute('aria-hidden', 'true')
	ringWrap.innerHTML =
		'<svg viewBox="0 0 100 100"><circle class="track" cx="50" cy="50" r="40"/>' +
		'<circle class="fill" cx="50" cy="50" r="40"/></svg>'
	const ringFill = ringWrap.querySelector('.fill') as SVGCircleElement
	const RING_LEN = 2 * Math.PI * 40
	ringFill.style.strokeDasharray = String(RING_LEN)
	canvasWrap.appendChild(ringWrap)

	const overlayEl = el('div', 'overlay')
	const overlayPanel = el('div', 'overlay-panel')
	overlayEl.appendChild(overlayPanel)
	overlayEl.style.display = 'none'

	main.appendChild(overlayEl) // scoped to the play area — see .overlay in theme.css
	root.append(header, main, captionBar, footer)

	return {
		canvas,
		setScreen(name) {
			screen.textContent = name
		},
		setMode(name) {
			mode.textContent = name
		},
		onPause(cb) {
			// Same bounce guard the scan rows get: an unguarded toggle made a
			// double-click open the menu and shut it again, so Pause looked dead.
			let last = -1e9
			pauseBtn.addEventListener('click', () => {
				const now = Date.now()
				if (now - last < INPUT_COOLDOWN_MS) return
				last = now
				cb()
			})
		},
		holdProgress(p) {
			if (p === null) {
				ringWrap.classList.remove('on')
				return
			}
			ringWrap.classList.add('on')
			ringFill.style.strokeDashoffset = String(RING_LEN * (1 - Math.min(1, Math.max(0, p))))
		},
		scanList(items) {
			return buildList(panel, items)
		},
		showPanel(show) {
			panel.style.display = show ? 'flex' : 'none'
		},
		caption(text) {
			captionBar.textContent = text
		},
		footerFocus(label) {
			focus.textContent = label
		},
		overlay(items) {
			overlayEl.setAttribute('role', 'dialog')
			overlayEl.setAttribute('aria-modal', 'true')
			// NOT on `main` — the overlay is inside it, so hiding main hides the
			// menu too. Hide the two things actually behind the scrim.
			canvasWrap.setAttribute('aria-hidden', 'true')
			panel.setAttribute('aria-hidden', 'true')
			overlayEl.style.display = ''
			return buildList(overlayPanel, items, 'menuscan')
		},
		hideOverlay() {
			overlayEl.style.display = 'none'
			overlayPanel.textContent = ''
			overlayEl.removeAttribute('role')
			overlayEl.removeAttribute('aria-modal')
			canvasWrap.removeAttribute('aria-hidden')
			panel.removeAttribute('aria-hidden')
		},
		overlayOpen() {
			return overlayEl.style.display !== 'none'
		},
		applySettings(s) {
			const html = document.documentElement
			html.dataset.theme = s.theme
			html.dataset.hl = s.highlightThick
			if (s.reduceMotion) html.dataset.reduceMotion = 'true'
			else delete html.dataset.reduceMotion
			// The renderer reads the cast setting the same way it reads
			// reduce-motion: Penny's tap-bounce is a character's cheer, not a
			// physics event, and it was firing with the cast layer off.
			if (s.characters) html.dataset.characters = 'true'
			else delete html.dataset.characters
			html.style.setProperty('--font-scale', String((s.fontScale as FontScale) / 100))
			// Mirrored as an attribute so CSS can react to large print: the layout
			// only has to drop the footer legend when the text is big AND the
			// viewport is short, not on every short viewport.
			html.dataset.font = String(s.fontScale)
		},
	}
}
