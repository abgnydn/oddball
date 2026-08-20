// Builds the DOM per the theme.css contract: .header / .main / .caption-bar /
// .footer as flex children (via #app { display: contents }). The flow drives it.

import './theme.css'
import { GAME_TITLE } from '../game/lines'
import { drawShapeGlyph } from '../render/draw'
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
			glyph.style.cssText = 'width:2.75rem;height:2.75rem;flex:none;'
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
	const panel = el('div', 'scan-panel')
	panel.style.cssText =
		'width:clamp(min(16rem, 46vw), 34%, 30rem);overflow-y:auto;scroll-padding-block:min(1rem, 12px);padding:min(1rem, 14px);display:flex;flex-direction:column;align-items:stretch;background:var(--panel);border-left:3px solid var(--border);'
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
			pauseBtn.addEventListener('click', cb)
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
			main.setAttribute('aria-hidden', 'true')
			panel.setAttribute('aria-hidden', 'true')
			overlayEl.style.display = ''
			return buildList(overlayPanel, items, 'menuscan')
		},
		hideOverlay() {
			overlayEl.style.display = 'none'
			overlayPanel.textContent = ''
			overlayEl.removeAttribute('role')
			overlayEl.removeAttribute('aria-modal')
			main.removeAttribute('aria-hidden')
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
			html.style.setProperty('--font-scale', String((s.fontScale as FontScale) / 100))
			// Mirrored as an attribute so CSS can react to large print: the layout
			// only has to drop the footer legend when the text is big AND the
			// viewport is short, not on every short viewport.
			html.dataset.font = String(s.fontScale)
		},
	}
}
