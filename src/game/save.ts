// localStorage persistence. Auto-saved on every state-changing selection;
// corrupt or missing data falls back to defaults. Settings deep-merge over
// DEFAULT_SETTINGS so new fields survive old saves. Round schema v2 (players,
// course, per-player strokes) — v1 rounds fail validation and are dropped.

import { DEFAULT_SETTINGS, MAX_CUSTOM_HOLES } from '../tuning'
import type { CustomHole, EditorParams, RoundSave, SaveAPI, SaveData, Settings } from '../types'

const KEY = 'oddball-save-v1'
const SURFACES = ['fairway', 'rough', 'green', 'sand', 'water']

const mergeSettings = (raw: unknown): Settings => {
	const out: Settings = { ...DEFAULT_SETTINGS }
	if (raw && typeof raw === 'object') {
		for (const k of Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>) {
			const v = (raw as Record<string, unknown>)[k]
			if (v !== undefined && typeof v === typeof DEFAULT_SETTINGS[k]) {
				;(out as unknown as Record<string, unknown>)[k] = v
			}
		}
	}
	return out
}

const validRound = (raw: unknown): RoundSave | undefined => {
	if (!raw || typeof raw !== 'object') return undefined
	const r = raw as Record<string, unknown>
	const strokesOk =
		Array.isArray(r.strokes) &&
		r.strokes.length >= 1 &&
		r.strokes.every((p) => Array.isArray(p) && p.every((s: unknown) => typeof s === 'number'))
	if (
		(r.players === 1 || r.players === 2) &&
		typeof r.player === 'number' &&
		typeof r.course === 'number' &&
		(r.course >= 0 || (r.customHole && typeof r.customHole === 'object')) &&
		typeof r.hole === 'number' &&
		strokesOk &&
		typeof r.ballX === 'number' &&
		typeof r.lie === 'string' &&
		SURFACES.includes(r.lie) &&
		typeof r.highlight === 'number' &&
		typeof r.seed === 'number' &&
		Number.isFinite(r.seed)
	) {
		return raw as unknown as RoundSave
	}
	return undefined
}

const validCustomHoles = (raw: unknown): CustomHole[] => {
	if (!Array.isArray(raw)) return []
	return raw
		.filter(
			(h): h is CustomHole =>
				!!h &&
				typeof h === 'object' &&
				typeof (h as CustomHole).name === 'string' &&
				!!(h as CustomHole).params &&
				typeof (h as CustomHole).params === 'object',
		)
		.slice(0, MAX_CUSTOM_HOLES)
}

const validDraft = (raw: unknown): EditorParams | undefined => {
	if (!raw || typeof raw !== 'object') return undefined
	const d = raw as Record<string, unknown>
	const keys = ['length', 'hills', 'water', 'sand', 'wind']
	return keys.every((k) => typeof d[k] === 'number') ? (raw as EditorParams) : undefined
}

const validBest = (raw: unknown): Record<string, number> => {
	if (!raw || typeof raw !== 'object') return {}
	const out: Record<string, number> = {}
	for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
		if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
	}
	return out
}

export function createSave(): SaveAPI {
	const read = (): SaveData => {
		try {
			const raw = localStorage.getItem(KEY)
			if (!raw) return { settings: { ...DEFAULT_SETTINGS } }
			const parsed = JSON.parse(raw) as Record<string, unknown>
			const out: SaveData = {
				settings: mergeSettings(parsed.settings),
				customHoles: validCustomHoles(parsed.customHoles),
				best: validBest(parsed.best),
			}
			const round = validRound(parsed.round)
			if (round) out.round = round
			const draft = validDraft(parsed.editorDraft)
			if (draft) out.editorDraft = draft
			return out
		} catch {
			return { settings: { ...DEFAULT_SETTINGS } }
		}
	}
	return {
		load: read,
		save(d) {
			try {
				localStorage.setItem(KEY, JSON.stringify(d))
			} catch {
				// storage full or blocked — the game keeps playing without saves
			}
		},
		clearRound() {
			const d = read()
			delete d.round
			try {
				localStorage.setItem(KEY, JSON.stringify(d))
			} catch {
				// ignore
			}
		},
	}
}
