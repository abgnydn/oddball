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
//  2. Measure at 200%. At the 125% default the Pause button is 2.2rem x 20px
//     = exactly 44px, which is also what the cap produces — so the broken and
//     the fixed build measure identically there. The bug is only visible at
//     200%.
//
// Run: pnpm layout-check

import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
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
]

const SCALES = [100, 125, 175, 200]

// title:    fewest rows, shortest labels — the easy case.
// settings: the most rows, so the first to overflow vertically.
// range:    the shape rack, whose labels are the longest single words in the
//           game ("Pancake") and change with the characters setting. It also
//           carries the canvas, which competes with the rows for height.
const SCREENS = ['title', 'settings', 'range'] as const
const SCREEN_ENTRY: Record<(typeof SCREENS)[number], string> = {
	title: '',
	settings: 'settings',
	range: 'practice',
}

interface Cell {
	w: number
	h: number
	scale: number
	screen: string
	rows: number
	clipped: Array<{ id: string; by: number }>
	hClipped: string[]
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

const SETTINGS = (scale: number) =>
	JSON.stringify({
		settings: {
			ttsOn: false,
			ttsRate: 1,
			ttsVolume: 1,
			scanMs: 2000,
			fontScale: scale,
			theme: 'high-contrast',
			highlightThick: 'medium',
			audioCues: false,
			reduceMotion: true,
			flightTone: false,
			dwell: 'off',
			autoScan: false,
		},
	})

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
			return { vClip: +vClip.toFixed(0), hOver, outside: +outside.toFixed(0) }
		})
		if (probes.vClip < 100 || !probes.hOver || probes.outside < 100) {
			console.log(
				`layout-check: SELF-TEST FAILED — vClip=${probes.vClip} hOver=${probes.hOver} pauseOutside=${probes.outside}. A detector that does not fire on a broken layout proves nothing about a clean one.`,
			)
			process.exit(1)
		}
		selfTest.push(
			`clip detector fired at ${probes.vClip}px`,
			`overflow detector fired`,
			`Pause detector fired at ${probes.outside}px`,
		)

		for (const [w, h] of VIEWPORTS) {
			for (const scale of SCALES) {
				await page.setViewportSize({ width: w, height: h })
				await page.goto(url, { waitUntil: 'load' })
				await page.evaluate((s) => localStorage.setItem('oddball-save-v1', s), SETTINGS(scale))

				for (const screen of SCREENS) {
					// Reload per screen rather than navigating between them: the flow
					// has no universal "back", and a wrong click would leave the
					// harness measuring a screen it did not mean to measure.
					await page.reload({ waitUntil: 'load' })
					if (screen !== 'title') {
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
					const cell = await page.evaluate(() => {
						const panel = document.querySelector('.scan-panel') as HTMLElement | null
						const rows = [...document.querySelectorAll('.scan-panel .scan-item')] as HTMLElement[]
						const clipped: Array<{ id: string; by: number }> = []
						const hClipped: string[] = []
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
								if (by > 1)
									clipped.push({ id: row.id || row.textContent!.slice(0, 24), by: +by.toFixed(1) })
								// Horizontal: the row's own ink against its content box. Do NOT
								// use a child span's scrollWidth — as a flex item it shrinks, so
								// that check is structurally always 0 and silently vacuous.
								if (row.scrollWidth - row.clientWidth > 1 || rr.right > pr.right + 1) {
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
							pauseOutside: outside,
							pauseMinHeight: pause === null ? 'none' : getComputedStyle(pause).minHeight,
							docHOverflow:
								document.documentElement.scrollWidth - document.documentElement.clientWidth,
						}
					})
					cells++
					rowsMeasured += cell.rows
					const failed =
						cell.clipped.length > 0 ||
						cell.hClipped.length > 0 ||
						cell.pauseOutside > 0 ||
						cell.docHOverflow > 0
					if (failed) bad.push({ w, h, scale, screen, ...cell })
				}
			}
		}
	} finally {
		await browser.close()
		close()
	}

	console.log(
		`layout-check: ${cells} cells (${VIEWPORTS.length} viewports x ${SCALES.length} scales x ${SCREENS.length} screens), ${rowsMeasured} row measurements`,
	)
	console.log(`self-test: ${selfTest.join('; ')} — a detector that cannot fail is not a check`)
	for (const c of bad) {
		const parts: string[] = []
		if (c.clipped.length > 0) {
			parts.push(`rows clipped: ${c.clipped.map((x) => `${x.id} by ${x.by}px`).join(', ')}`)
		}
		if (c.hClipped.length > 0) parts.push(`rows overflowing sideways: ${c.hClipped.join(', ')}`)
		if (c.pauseOutside > 0) parts.push(`Pause ${c.pauseOutside}px outside the viewport`)
		if (c.docHOverflow > 0) parts.push(`document overflows ${c.docHOverflow}px horizontally`)
		console.log(`FAIL  ${c.w}x${c.h} @${c.scale}% ${c.screen} — ${parts.join('; ')}`)
	}
	if (bad.length > 0) {
		console.log(`\n${bad.length} of ${cells} cells failed`)
		process.exit(1)
	}
	console.log('layout-check: ALL PASS — no clipped row, no unreachable Pause, no sideways scroll')
}

main()
