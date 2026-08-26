// Layout harness. Everything it measures is browser-only: no other harness
// executes hud.ts, theme.css or any question about where a box ends up.
//
// It exists because a CSS rule shipped that never applied. `.footer-pause`'s
// short-viewport cap sat above the base rule it meant to beat, so document
// order discarded it; the source comment claimed the fix as done, and nothing
// re-measured it for a whole round. Every layout number in DESIGN.md and
// README.md used to come from a script in a scratchpad, which is the same
// thing as coming from nowhere.
//
// TWO LESSONS ARE BUILT INTO THE GRID, both learned by missing defects:
//
//  1. Test the CORNER, not the edges. Three cascade defects lived at
//     (width <= 560) AND (height <= 400 or 560). Two independently written
//     grids — one of 60 cells, one of ~2450 row measurements — both missed
//     every one of them, because each picked short viewports that were wide
//     and narrow viewports that were tall. Grid design beats grid size.
//  2. Measure at every scale, and never trust one. The original grid skipped
//     150% and 150% is where the mid-width overflow ran furthest before it
//     stopped. And at the 125% default the Pause button's floor (2.2rem x 20px
//     = 44px) equals what the short-screen cap produces, so a broken and a
//     fixed build measure identically there — that one is only visible at 200%.
//     Note the floor and the rendered height differ: 44px is the min-height,
//     44.6px is what the browser paints at 125% on a tall viewport.
//
// Run: pnpm layout-check

import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { chromium } from 'playwright-core'

const REPO = process.cwd()
const DIST = join(REPO, 'dist')

/** Viewports. The first group is ordinary; the second is the corner region
 *  where every cascade defect in this project has lived. Do not prune the
 *  second group to make the run faster — that is how they got missed. */
const VIEWPORTS: Array<[number, number]> = [
	[1920, 1080],
	[1280, 800],
	[1024, 768],
	[1133, 674], // iPad landscape: chrome puts it under the 700px query
	[912, 1368],
	[844, 325], // iPhone 12/13 landscape
	[800, 360],
	[736, 375],
	[667, 325], // iPhone SE landscape
	[640, 300],
	[600, 300],
	[540, 720],
	[390, 844],
	[360, 640],
	[320, 568],
	[320, 480],
	// --- the corner: narrow AND short, both tiers matching at once ---
	[560, 400],
	[540, 400],
	[480, 320],
	[400, 300],
	[360, 320],
	[320, 400],
	[320, 320],
	[280, 653], // Galaxy Fold cover screen
	[280, 560],
	[280, 480],
	// --- the OTHER corner: mid-width AND tall, where large print starves the
	// side-by-side panel. This band was empty in the first version of this
	// grid: every wide cell above was >=900px, every short one <=400px tall,
	// so the one region where a tablet in portrait lives had no cell at all.
	// A rendering review found "Pancake" painting 132px outside its row here
	// while this harness reported ALL PASS. Widest overflowing width measured
	// per text scale was 875 (200%), 775 (175%), 675 (150%), 600 (125%).
	[575, 1024],
	[600, 1024],
	[640, 1024],
	[675, 1024],
	[720, 1024],
	[768, 1024], // iPad portrait
	[800, 1024],
	[834, 1024], // iPad Air portrait
	[875, 1024],
	[900, 1024],
	[820, 1180], // iPad Air 10.9 portrait
	[810, 1080], // iPad 10.2 portrait
	// Just ABOVE the stack breakpoint, where side-by-side resumes. This band was
	// missed because the sweep that chose the breakpoint used a detector that
	// ignored the row's flex gap; with the gap counted the overflow ran to about
	// 940px at 200%, past the 900 that was supposed to cover it.
	[905, 1024],
	[920, 1024],
	[935, 1024],
	[950, 1024],
	[1000, 1024],
]

// 150 was missing and the band above is where it bites: at 150% the overflow
// ran to 675px wide. A scale the grid does not test is a scale the grid does
// not cover, however many cells it has.
const SCALES = [100, 125, 150, 175, 200]

// title:    fewest rows, shortest labels — the easy case.
// settings: the most rows, so the first to overflow vertically.
// range:    the shape rack, whose labels are the longest single words in the
//           game ("Pancake") and change with the characters setting. It also
//           carries the canvas, which competes with the rows for height.
// overlay: the PAUSE MENU. Added after two reviews found the highlight ring
//          being cut there while this harness reported ALL PASS — it measured
//          `.scan-panel`, and the pause menu is `.overlay-panel`, a second
//          scrolling list that never got the scroll-padding fix and that none
//          of the screens here opened. It is also the screen the hub's contract
//          argues hardest about (§12, "a locked door"), which made it the worst
//          one to leave unmeasured.
const SCREENS = ['title', 'settings', 'range', 'overlay'] as const
const SCREEN_ENTRY: Record<(typeof SCREENS)[number], string> = {
	title: '',
	settings: 'settings',
	range: 'practice',
	overlay: '',
}

interface Cell {
	w: number
	h: number
	scale: number
	screen: string
	pass: string
	rows: number
	clipped: Array<{ id: string; by: number }>
	hClipped: string[]
	ringCut: Array<{ id: string; by: number }>
	pauseOutside: number
	pauseMinHeight: string
	docHOverflow: number
}

const serve = (): Promise<{ url: string; close: () => void }> =>
	new Promise((resolve) => {
		const types: Record<string, string> = {
			'.html': 'text/html',
			'.js': 'text/javascript',
			'.css': 'text/css',
			'.svg': 'image/svg+xml',
			'.png': 'image/png',
			'.map': 'application/json',
			'.webmanifest': 'application/manifest+json',
			'.ico': 'image/x-icon',
		}
		const server = createServer((req, res) => {
			const raw = (req.url ?? '/').split('?')[0] ?? '/'
			const rel = normalize(raw === '/' ? '/index.html' : raw).replace(/^(\.\.[/\\])+/, '')
			const file = join(DIST, rel)
			try {
				if (!statSync(file).isFile()) throw new Error('not a file')
				res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' })
				res.end(readFileSync(file))
			} catch {
				res.writeHead(404).end('not found')
			}
		})
		server.listen(0, '127.0.0.1', () => {
			const addr = server.address()
			const port = typeof addr === 'object' && addr !== null ? addr.port : 0
			resolve({ url: `http://127.0.0.1:${port}/`, close: () => server.close() })
		})
	})

const SETTINGS = (scale: number, highlightThick = 'medium', characters = false) =>
	JSON.stringify({
		settings: {
			ttsOn: false,
			ttsRate: 1,
			ttsVolume: 1,
			scanMs: 2000,
			fontScale: scale,
			theme: 'high-contrast',
			highlightThick,
			audioCues: false,
			reduceMotion: true,
			flightTone: false,
			dwell: 'off',
			autoScan: false,
			characters,
		},
	})

// The main grid runs one combination of the two settings that change layout
// without changing size — the ring is 4/8/12px by Highlight, and the labels
// change with Character names. Sweeping both across 570 cells would triple the
// runtime for cells that mostly repeat, so instead they get a focused pass over
// the viewports where each is tightest: the shortest screens for the ring
// (thick reaches 12px, the exact figure that just failed at 320x320), and the
// mid-width band for the labels (the cast names are shorter than the plain
// ones, but "Penny" was still spilling 87px there before the stack fix).
// The stylesheet's tier boundaries, READ OUT OF THE BUILT CSS rather than typed
// here. A hand-kept copy of this list goes stale the first time a media query
// moves, and that is the same defect class the edge cells exist to catch — a
// poor place to introduce one.
const breakpointsFrom = (css: string): { heights: number[]; widths: number[] } => {
	const heights = new Set<number>()
	const widths = new Set<number>()
	for (const m of css.matchAll(/@media[^{]*?max-(height|width):\s*(\d+)px/g)) {
		;(m[1] === 'height' ? heights : widths).add(Number(m[2]))
	}
	return { heights: [...heights].sort((a, b) => a - b), widths: [...widths].sort((a, b) => a - b) }
}

// Every tier boundary at N and at N+1. Three defects found by review so far sat
// exactly one pixel past one: a row clipped at height 401 where 400 shrank the
// caption and the ring, and the Pause button below the fold at 561 where 560
// dropped the footer legend. A boundary is where the layout changes its mind,
// so both sides of it get measured.
const edgeViewports = (css: string): Array<[number, number]> => {
	const { heights, widths } = breakpointsFrom(css)
	return [
		...heights.flatMap((h) =>
			[320, 412, 800].flatMap(
				(w): Array<[number, number]> => [
					[w, h],
					[w, h + 1],
				],
			),
		),
		...widths.flatMap((w) =>
			[320, 1024].flatMap(
				(h): Array<[number, number]> => [
					[w, h],
					[w + 1, h],
				],
			),
		),
	]
}

interface Pass {
	label: string
	viewports: Array<[number, number]>
	scales: number[]
	highlightThick: string
	characters: boolean
}
const passesFor = (css: string): Pass[] => [
	{
		label: 'grid',
		viewports: VIEWPORTS,
		scales: SCALES,
		highlightThick: 'medium',
		characters: false,
	},
	{
		label: 'thick ring',
		viewports: [
			[320, 320],
			[320, 400],
			[360, 320],
			[280, 480],
			[400, 300],
			[600, 300],
			[844, 325],
			[1024, 768],
		],
		scales: [125, 200],
		highlightThick: 'thick',
		characters: false,
	},
	{
		// Every breakpoint, at N and at N+1. Three of the defects found by review
		// so far sat exactly one pixel past a tier: a row clipped at height 401
		// where 400 had a smaller ring, and the Pause button off the bottom at
		// 561 where 560 dropped the footer legend. That is not three viewports
		// worth fixing, it is a rule: a tier boundary is where the layout changes
		// its mind, so both sides of it get measured. The list is derived from
		// the stylesheet's own breakpoints rather than typed out, so adding a
		// media query adds its edge cells too.
		// Two scales and the two scrolling lists, to keep this affordable: the
		// deploy script runs this harness, and a gate nobody waits for is a gate
		// that gets skipped.
		label: 'breakpoint edges',
		viewports: edgeViewports(css),
		scales: [125, 200],
		highlightThick: 'thick',
		characters: false,
	},
	{
		label: 'cast names',
		viewports: [
			[575, 1024],
			[768, 1024],
			[875, 1024],
			[320, 320],
			[280, 480],
			[912, 1368],
		],
		scales: [125, 200],
		highlightThick: 'medium',
		characters: true,
	},
]

const main = async () => {
	// A build older than the sources measures the wrong thing and says nothing.
	try {
		const newest = execFileSync(
			'sh',
			['-c', 'ls -t src/**/*.ts src/**/*.css src/*.ts 2>/dev/null | head -1'],
			{ cwd: REPO, encoding: 'utf8' },
		).trim()
		if (newest !== '' && statSync(join(REPO, newest)).mtimeMs > statSync(DIST).mtimeMs) {
			console.log(`dist is older than ${newest} — run \`pnpm build\` first`)
			process.exit(1)
		}
	} catch {
		console.log('no dist/ — run `pnpm build` first')
		process.exit(1)
	}

	// The breakpoint-edge cells come out of the shipped stylesheet, so they
	// follow it when a media query moves.
	const cssFiles = readdirSync(join(DIST, 'assets')).filter((f) => f.endsWith('.css'))
	if (cssFiles.length !== 1) {
		console.log(
			`expected exactly one built stylesheet in dist/assets, found ${cssFiles.length}: ${cssFiles.join(', ')}. A stale asset means the edge cells would be derived from the wrong file.`,
		)
		process.exit(1)
	}
	const cssText = readFileSync(join(DIST, 'assets', cssFiles[0] as string), 'utf8')

	const { url, close } = await serve()
	// --mute-audio: this game has a flight tone and a cup beeper, and a headless
	// browser still plays them through the speakers of whoever runs this.
	const browser = await chromium.launch({
		args: ['--single-process', '--no-zygote', '--mute-audio'],
	})
	// One page reused: --single-process cannot take repeated newPage().
	const page = await browser.newPage()

	const bad: Cell[] = []
	const selfTest: string[] = []
	let cells = 0
	let rowsMeasured = 0

	try {
		// Prove each detector fires BEFORE trusting a clean run. A vacuous
		// harness reports ALL PASS on a broken build, which is worse than no
		// harness because it is believed. Two of the three checks below were
		// silently inert at some point while this file was being written.
		await page.setViewportSize({ width: 900, height: 700 })
		await page.goto(url, { waitUntil: 'load' })
		const probes = await page.evaluate(() => {
			const panel = document.querySelector('.scan-panel') as HTMLElement
			const row = document.querySelector('.scan-panel .scan-item') as HTMLElement
			const pause = document.querySelector('.footer-pause') as HTMLElement
			const cs = getComputedStyle(panel)
			// (a) a row taller than the panel must register as clipped
			const oldH = row.style.minHeight
			row.style.minHeight = '4000px'
			row.scrollIntoView({ block: 'nearest' })
			let pr = panel.getBoundingClientRect()
			let rr = row.getBoundingClientRect()
			const vClip =
				Math.max(0, pr.top + parseFloat(cs.borderTopWidth) - rr.top) +
				Math.max(0, rr.bottom - (pr.bottom - parseFloat(cs.borderBottomWidth)))
			row.style.minHeight = oldH
			// (b) a row wider than its box must register as overflowing
			const oldW = row.style.width
			row.style.width = '4000px'
			pr = panel.getBoundingClientRect()
			rr = row.getBoundingClientRect()
			const hOver = rr.right > pr.right + 1 || row.scrollWidth - row.clientWidth > 1
			row.style.width = oldW
			// (c) a displaced Pause must register as outside the viewport
			const oldT = pause.style.transform
			pause.style.transform = 'translateY(9000px)'
			const outside = pause.getBoundingClientRect().bottom - innerHeight
			pause.style.transform = oldT
			// (d) an absurdly wide ring on an unclipped row must register as cut.
			// Forced with an inline outline rather than by moving the row: the
			// point is that the ROW is fine and only the ring is lost, which is
			// exactly the case the detector was added for.
			const oldO = row.style.outline
			const oldOff = row.style.outlineOffset
			row.setAttribute('data-scan-focus', 'true')
			row.style.outline = '400px solid red'
			row.style.outlineOffset = '400px'
			row.scrollIntoView({ block: 'nearest' })
			const rcs = getComputedStyle(row)
			const reach = parseFloat(rcs.outlineWidth || '0') + parseFloat(rcs.outlineOffset || '0')
			pr = panel.getBoundingClientRect()
			rr = row.getBoundingClientRect()
			const ring =
				Math.max(0, pr.top + parseFloat(cs.borderTopWidth) - (rr.top - reach)) +
				Math.max(0, rr.bottom + reach - (pr.bottom - parseFloat(cs.borderBottomWidth)))
			row.style.outline = oldO
			row.style.outlineOffset = oldOff
			row.removeAttribute('data-scan-focus')
			return {
				vClip: +vClip.toFixed(0),
				hOver,
				outside: +outside.toFixed(0),
				ring: +ring.toFixed(0),
			}
		})
		if (probes.vClip < 100 || !probes.hOver || probes.outside < 100 || probes.ring < 100) {
			console.log(
				`layout-check: SELF-TEST FAILED — vClip=${probes.vClip} hOver=${probes.hOver} pauseOutside=${probes.outside} ringCut=${probes.ring}. A detector that does not fire on a broken layout proves nothing about a clean one.`,
			)
			process.exit(1)
		}
		// The grid opens the pause menu with the Pause button for speed. Prove
		// here, once, that the 3 s hold gets the same menu — otherwise every
		// overlay cell is measuring a screen the switch path might not produce.
		await page.goto(url, { waitUntil: 'load' })
		await page.evaluate(() => {
			;(document.querySelector('.footer-pause') as HTMLElement | null)?.click()
		})
		await page.waitForTimeout(250)
		const viaClick = await page.evaluate(() =>
			[...document.querySelectorAll('.overlay-panel .scan-item')].map((r) => r.id).join(','),
		)
		await page.goto(url, { waitUntil: 'load' })
		await page.keyboard.down('Enter')
		await page.waitForTimeout(3300)
		await page.keyboard.up('Enter')
		await page.waitForTimeout(300)
		const viaHold = await page.evaluate(() =>
			[...document.querySelectorAll('.overlay-panel .scan-item')].map((r) => r.id).join(','),
		)
		if (viaClick === '' || viaClick !== viaHold) {
			console.log(
				`layout-check: SELF-TEST FAILED — the Pause button and the 3 s hold open different menus.\n  click: [${viaClick}]\n  hold:  [${viaHold}]`,
			)
			process.exit(1)
		}
		selfTest.push(
			`pause routes agree (${viaClick.split(',').length} rows)`,
			`clip detector fired at ${probes.vClip}px`,
			`overflow detector fired`,
			`Pause detector fired at ${probes.outside}px`,
			`ring detector fired at ${probes.ring}px`,
		)

		for (const pass of passesFor(cssText)) {
			for (const [w, h] of pass.viewports) {
				for (const scale of pass.scales) {
					await page.setViewportSize({ width: w, height: h })
					await page.goto(url, { waitUntil: 'load' })
					await page.evaluate(
						(s) => localStorage.setItem('oddball-save-v1', s),
						SETTINGS(scale, pass.highlightThick, pass.characters),
					)

					for (const screen of SCREENS) {
						// Reload per screen rather than navigating between them: the flow
						// has no universal "back", and a wrong click would leave the
						// harness measuring a screen it did not mean to measure.
						await page.reload({ waitUntil: 'load' })
						if (screen === 'overlay') {
							// Opened with the Pause button, not the 3 s hold. Both land on
							// the same handler and build the same list — the self-test above
							// asserts that, once, rather than this loop assuming it — and the
							// hold would add 3.3 s to every cell, which is 45 minutes across
							// the grid. A harness nobody waits for is a harness nobody runs.
							await page.evaluate(() => {
								;(document.querySelector('.footer-pause') as HTMLElement | null)?.click()
							})
							await page.waitForTimeout(250)
							const open = await page.evaluate(
								() => document.querySelector('.overlay-panel') !== null,
							)
							if (!open) {
								console.log(`layout-check: pause menu did not open at ${w}x${h} @${scale}%`)
								process.exit(1)
							}
						} else if (screen !== 'title') {
							const clicked = await page.evaluate((pattern) => {
								const rows = [...document.querySelectorAll('.scan-item')]
								const row = rows.find((r) => new RegExp(pattern, 'i').test(r.textContent ?? ''))
								row?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
								return row !== undefined
							}, SCREEN_ENTRY[screen])
							// A silently-missed click would measure the title screen twice
							// and report the other screen as clean.
							if (!clicked) {
								console.log(`layout-check: could not reach ${screen} at ${w}x${h} @${scale}%`)
								process.exit(1)
							}
							await page.waitForTimeout(250)
						}

						// Focus each row in turn: the caption bar resizes with the focused
						// item, which changes the panel's height. Measuring without moving
						// focus reports 0 clipped on a build that clips.
						const cell = await page.evaluate(
							(sel: string) => {
								const panel = document.querySelector(sel) as HTMLElement | null
								const rows = [...document.querySelectorAll(`${sel} .scan-item`)] as HTMLElement[]
								const clipped: Array<{ id: string; by: number }> = []
								const hClipped: string[] = []
								const ringCut: Array<{ id: string; by: number }> = []
								if (panel !== null) {
									for (const row of rows) {
										row.scrollIntoView({ block: 'nearest' })
										const pr = panel.getBoundingClientRect()
										const cs = getComputedStyle(panel)
										// The visual window of a scrolling box is its PADDING box (the
										// scrollport), not its content box: padding scrolls with the
										// content and is visible. Measuring against the content box
										// subtracts real estate the user can see and reports a uniform
										// ~14px clip on every row of a perfectly good layout — which is
										// what this harness did on its first run, on 199 of 208 cells.
										const top = pr.top + parseFloat(cs.borderTopWidth)
										const bottom = pr.bottom - parseFloat(cs.borderBottomWidth)
										const rr = row.getBoundingClientRect()
										const by = Math.max(0, top - rr.top) + Math.max(0, rr.bottom - bottom)

										// The highlight ring, measured as its own thing. For a player
										// scanning by switch the ring is the only signal of what Enter
										// will pick, and it is drawn OUTSIDE the row's border box, so a
										// row that is fully on screen can still have its ring cut off by
										// the scrollport. That shipped: 12.4px of the bottom stroke gone
										// on the last row of the settings list, on every viewport, while
										// every row measured as unclipped.
										// The reach is read from the live style rather than hard-coded:
										// the ring is 4/8/12px by the Highlight setting, so a literal
										// here would silently stop matching two of the three.
										row.setAttribute('data-scan-focus', 'true')
										const fs = getComputedStyle(row)
										const reach =
											parseFloat(fs.outlineWidth || '0') + parseFloat(fs.outlineOffset || '0')
										row.removeAttribute('data-scan-focus')
										const cut =
											Math.max(0, top - (rr.top - reach)) + Math.max(0, rr.bottom + reach - bottom)
										if (cut > 1)
											ringCut.push({
												id: row.id || row.textContent!.slice(0, 24),
												by: +cut.toFixed(1),
											})
										if (by > 1)
											clipped.push({
												id: row.id || row.textContent!.slice(0, 24),
												by: +by.toFixed(1),
											})
										// Horizontal: the row's own ink against its content box. Do NOT
										// use a child span's scrollWidth — as a flex item it shrinks, so
										// that check is structurally always 0 and silently vacuous.
										// scrollWidth vs clientWidth alone is NOT enough: clientWidth
										// includes the row's own padding, so ink that overruns the
										// content box but lands inside the padding is invisible to it.
										// That is exactly how a 12.8px overrun at 912x1368 read as 0
										// while the same defect showed 132px one viewport over. Measure
										// the ink against the CONTENT box as well.
										const rcs = getComputedStyle(row)
										const contentW =
											row.clientWidth - parseFloat(rcs.paddingLeft) - parseFloat(rcs.paddingRight)
										// The flex GAP counts. Summing the children alone made any
										// overrun up to one gap-width invisible — 16px at 125% —
										// which is how a stacking breakpoint 17px inside the defect
										// band passed this harness. Same class as the padding blind
										// spot above, one property over.
										const kids = [...row.children] as HTMLElement[]
										const gap = Number.parseFloat(rcs.columnGap || rcs.gap || '0') || 0
										const inkW =
											kids.reduce((a, c) => a + c.getBoundingClientRect().width, 0) +
											gap * Math.max(0, kids.length - 1)
										if (
											row.scrollWidth - row.clientWidth > 1 ||
											rr.right > pr.right + 1 ||
											inkW - contentW > 1
										) {
											hClipped.push(row.id || row.textContent!.slice(0, 24))
										}
									}
								}
								const pause = document.querySelector('.footer-pause') as HTMLElement | null
								const pr = pause?.getBoundingClientRect()
								const outside =
									pr === undefined
										? -1
										: +Math.max(
												0,
												pr.bottom - innerHeight,
												pr.right - innerWidth,
												-pr.top,
												-pr.left,
											).toFixed(1)
								return {
									rows: rows.length,
									clipped,
									hClipped,
									ringCut,
									pauseOutside: outside,
									pauseMinHeight: pause === null ? 'none' : getComputedStyle(pause).minHeight,
									docHOverflow:
										document.documentElement.scrollWidth - document.documentElement.clientWidth,
								}
							},
							screen === 'overlay' ? '.overlay-panel' : '.scan-panel',
						)
						cells++
						rowsMeasured += cell.rows
						const failed =
							cell.clipped.length > 0 ||
							cell.hClipped.length > 0 ||
							cell.ringCut.length > 0 ||
							cell.pauseOutside > 0 ||
							cell.docHOverflow > 0
						if (failed) bad.push({ w, h, scale, screen, pass: pass.label, ...cell })
					}
				}
			}
		}
	} finally {
		await browser.close()
		close()
	}

	console.log(
		`layout-check: ${cells} cells (${VIEWPORTS.length} viewports x ${SCALES.length} scales x ${SCREENS.length} screens, plus focused passes for the thick ring and the cast names), ${rowsMeasured} row measurements`,
	)
	console.log(`self-test: ${selfTest.join('; ')} — a detector that cannot fail is not a check`)
	for (const c of bad) {
		const parts: string[] = []
		if (c.clipped.length > 0) {
			parts.push(`rows clipped: ${c.clipped.map((x) => `${x.id} by ${x.by}px`).join(', ')}`)
		}
		if (c.hClipped.length > 0) parts.push(`rows overflowing sideways: ${c.hClipped.join(', ')}`)
		if (c.ringCut.length > 0)
			parts.push(`highlight ring cut: ${c.ringCut.map((x) => `${x.id} by ${x.by}px`).join(', ')}`)
		if (c.pauseOutside > 0) parts.push(`Pause ${c.pauseOutside}px outside the viewport`)
		if (c.docHOverflow > 0) parts.push(`document overflows ${c.docHOverflow}px horizontally`)
		console.log(`FAIL  ${c.w}x${c.h} @${c.scale}% ${c.screen} [${c.pass}] — ${parts.join('; ')}`)
	}
	if (bad.length > 0) {
		console.log(`\n${bad.length} of ${cells} cells failed`)
		process.exit(1)
	}
	console.log('layout-check: ALL PASS — no clipped row, no unreachable Pause, no sideways scroll')
}

main()
