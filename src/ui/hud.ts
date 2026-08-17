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
	glyph?: ShapeId // character portrait drawn beside the label (rack rows)
}

export interface Hud {
	canvas: HTMLCanvasElement
	setScreen(name: string): void
	setMode(name: string): void
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

const buildList = (container: HTMLElement, items: HudItemSpec[]): ScanItem[] => {
	container.textContent = ''
	const list = el('div', 'scan-list')
	container.appendChild(list)
	return items.map((spec) => {
		const row = el('div', 'scan-item')
		row.id = `scan-${spec.id}`
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
		return { id: spec.id, label: spec.label, speak: spec.speak, el: row }
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
		'width:clamp(16rem, 34%, 30rem);overflow-y:auto;scroll-padding-block:1rem;padding:1rem;display:flex;flex-direction:column;align-items:stretch;background:var(--panel);border-left:3px solid var(--border);'
	main.append(canvasWrap, panel)

	const captionBar = el('div', 'caption-bar')

	const footer = el('footer', 'footer')
	const mode = el('div', 'footer-mode')
	const focus = el('div', 'footer-focus')
	const legend = el('div', 'footer-legend', 'Space = next · Return = select · Hold Return = menu')
	footer.append(mode, focus, legend)

	const overlayEl = el('div', 'overlay')
	const overlayPanel = el('div', 'overlay-panel')
	overlayEl.appendChild(overlayPanel)
	overlayEl.style.display = 'none'

	root.append(header, main, captionBar, footer, overlayEl)

	return {
		canvas,
		setScreen(name) {
			screen.textContent = name
		},
		setMode(name) {
			mode.textContent = name
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
			overlayEl.style.display = ''
			return buildList(overlayPanel, items)
		},
		hideOverlay() {
			overlayEl.style.display = 'none'
			overlayPanel.textContent = ''
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
		},
	}
}
