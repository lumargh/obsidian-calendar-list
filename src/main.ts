// todo (Release 2)
// hotkey: add 'custom range' option to the bottom of the preset list. this option opens the calendar list modal for the custom range option.
// add configure command that updates the user's setting preferences, in the same way done in date-list

import { App, Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, MarkdownView, MarkdownFileInfo, Modal, Notice, Plugin, TFile, moment as _m } from 'obsidian';
import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { promisify } from 'util';
import { CalendarEventsSettings, DEFAULT_SETTINGS, CalendarEventsSettingTab } from './settings';

const execFileAsync = promisify(execFile);

type MomentInstance = ReturnType<typeof _m.utc>;
type MomentFactory = { (): MomentInstance; (inp: string, fmt?: string | string[]): MomentInstance } & typeof _m;
const moment = _m as unknown as MomentFactory;

const BACK = Symbol('back');

// -------------------------------------------------------------------
// Calendar fetching via icalBuddy
// -------------------------------------------------------------------

export interface CalEvent {
	start: Date;
	/** Set only when the event spans into a different calendar day than `start`. */
	end?: Date | null;
	title: string;
	allDay: boolean;
}

function findIcalBuddy(): string {
	for (const p of ['/opt/homebrew/bin/icalBuddy', '/usr/local/bin/icalBuddy']) {
		if (existsSync(p)) return p;
	}
	return 'icalBuddy';
}

function parseIcalBuddyOutput(stdout: string): CalEvent[] {
	const events: CalEvent[] = [];
	const lines = stdout.split(/\r?\n/);

	let title: string | null = null;
	let dateTimeLine: string | null = null;

	// Map prose date words (icalBuddy emits these for nearby days) to moment offsets.
	const wordOffset: Record<string, number> = { today: 0, tomorrow: 1, yesterday: -1 };
	const resolveDate = (word: string): MomentInstance => {
		const offset = wordOffset[word.toLowerCase()];
		return offset !== undefined
			? moment().startOf('day').add(offset, 'days')
			: moment(word, 'YYYY-MM-DD');
	};
	// Parse one half of a datetime line: "DATE at HH:MM", "DATE", or a bare "HH:MM".
	const parsePart = (part: string): { date: string | null; time: string | null } => {
		let m = part.match(/^(\S+)\s+at\s+(\d{1,2}:\d{2})$/);
		if (m) return { date: m[1]!, time: m[2]! };
		m = part.match(/^(\d{1,2}:\d{2})$/);
		if (m) return { date: null, time: m[1]! };
		m = part.match(/^(\S+)$/);
		if (m) return { date: m[1]!, time: null };
		return { date: null, time: null };
	};
	const toDateTime = (base: MomentInstance, time: string | null): Date => {
		if (!time) return base.toDate();
		const [h, mi] = time.split(':').map(Number);
		return base.clone().hours(h ?? 0).minutes(mi ?? 0).seconds(0).toDate();
	};

	const flush = () => {
		if (!title || dateTimeLine === null) return;
		const raw = dateTimeLine.trim();

		const halves = raw.split(/\s+-\s+/);
		const startPart = parsePart(halves[0] ?? '');
		const endPart   = halves.length > 1 ? parsePart(halves[1]!) : null;

		if (!startPart.date) { title = null; dateTimeLine = null; return; }
		const startBase = resolveDate(startPart.date);
		if (!startBase.isValid()) { title = null; dateTimeLine = null; return; }

		const allDay = !startPart.time;
		const start = toDateTime(startBase, startPart.time);

		// Record the end only when the event spans into a different calendar day.
		let end: Date | null = null;
		if (endPart && endPart.date) {
			const endBase = resolveDate(endPart.date);
			if (endBase.isValid() && !endBase.isSame(startBase, 'day')) {
				end = toDateTime(endBase, endPart.time);
			}
		}

		events.push({ start, end, title, allDay });
		title = null;
		dateTimeLine = null;
	};

	const BULLET = '###EVT###';
	for (const line of lines) {
		if (line.startsWith(BULLET)) {
			flush();
			title = line.slice(BULLET.length).trim();
			dateTimeLine = null;
		} else if (title && (line.startsWith('    ') || line.startsWith('\t'))) {
			if (dateTimeLine === null) dateTimeLine = line;
		}
	}
	flush();

	events.sort((a, b) => a.start.getTime() - b.start.getTime());
	return events;
}

const ANSI_RE = /\x1b\[[0-9;]*m/g;

async function fetchEvents(start: Date, end: Date, excluded: string[], timeoutMs: number): Promise<CalEvent[]> {
	const buddy = findIcalBuddy();
	const startStr = moment(start).format('YYYY-MM-DD');
	// icalBuddy's `to:` is inclusive of the given date, so pass the end date as-is.
	const endStr   = moment(end).format('YYYY-MM-DD');

	const args = ['-iep', 'title,datetime', '-df', '%Y-%m-%d', '-tf', '%H:%M', '-nc', '-b', '###EVT###'];
	if (excluded.length > 0) args.push('-ec', excluded.join(','));
	args.push(`eventsFrom:${startStr}`, `to:${endStr}`);

	const { stdout } = await execFileAsync(buddy, args, { timeout: timeoutMs });
	return parseIcalBuddyOutput(stdout.replace(ANSI_RE, ''));
}

export function formatEvent(e: CalEvent, settings: CalendarEventsSettings): string {
	const renderDate = (d: Date): string => {
		const m = moment(d);
		const dateStr = m.format(settings.dateFormat || 'YYYY-MM-DD');
		const aliasStr = settings.wikiLinksAlias ? m.format(settings.wikiLinksAlias) : null;
		return settings.wikiLinks
			? (aliasStr ? `[[${dateStr}|${aliasStr}]]` : `[[${dateStr}]]`)
			: dateStr;
	};

	let datePart = '';
	let timeStr = '';
	if (e.end) {
		// Multi-day event: show the date span and omit times.
		if (settings.includeDate) datePart = `${renderDate(e.start)} – ${renderDate(e.end)}`;
	} else {
		if (settings.includeDate) datePart = renderDate(e.start);
		if (!e.allDay && settings.includeTime) {
			const formatted = moment(e.start).format(settings.timeFormat || 'HH:mm');
			timeStr = settings.includeDate ? (settings.timeSeparator || ' ') + formatted : formatted;
		}
	}
	const hasPrecedingContent = datePart !== '' || timeStr !== '';
	const titleSep = hasPrecedingContent ? (settings.titleSeparator || ' ') : '';
	return `${settings.prefix}${datePart}${timeStr}${titleSep}${e.title}`;
}

function formatEvents(events: CalEvent[], settings: CalendarEventsSettings): string {
	if (events.length === 0) return '(no events found)';
	return events.map((e) => formatEvent(e, settings)).join('\n');
}

// -------------------------------------------------------------------
// Range presets
// -------------------------------------------------------------------

interface RangePreset {
	name: string;
	label: string;
	start: Date;
	end: Date;
}

function buildPresets(weekStart: number): RangePreset[] {
	const now = moment();
	const toDate = (m: MomentInstance) => m.toDate();

	// Compute the week boundaries relative to the user's chosen first day.
	const offsetToWeekStart = (now.day() - weekStart + 7) % 7;
	const thisWeekStart = now.clone().startOf('day').subtract(offsetToWeekStart, 'days');
	const thisWeekEnd   = thisWeekStart.clone().add(6, 'days').endOf('day');
	const nextWeekStart = thisWeekStart.clone().add(7, 'days');
	const nextWeekEnd   = nextWeekStart.clone().add(6, 'days').endOf('day');

	return [
		{
			name: 'Today',
			label: now.format('ddd, MMM D'),
			start: toDate(now.clone().startOf('day')),
			end:   toDate(now.clone().endOf('day')),
		},
		{
			name: 'Tomorrow',
			label: now.clone().add(1, 'days').format('ddd, MMM D'),
			start: toDate(now.clone().add(1, 'days').startOf('day')),
			end:   toDate(now.clone().add(1, 'days').endOf('day')),
		},
		{
			name: 'This week',
			label: `${thisWeekStart.format('MMM D')} – ${thisWeekEnd.format('MMM D')}`,
			start: toDate(thisWeekStart),
			end:   toDate(thisWeekEnd),
		},
		{
			name: 'Next week',
			label: `${nextWeekStart.format('MMM D')} – ${nextWeekEnd.format('MMM D')}`,
			start: toDate(nextWeekStart),
			end:   toDate(nextWeekEnd),
		},
		{
			name: 'This month',
			label: now.format('MMMM YYYY'),
			start: toDate(now.clone().startOf('month')),
			end:   toDate(now.clone().endOf('month')),
		},
	];
}

// -------------------------------------------------------------------
// Inline editor suggest (')) trigger)
// -------------------------------------------------------------------

class CalendarEventsSuggest extends EditorSuggest<RangePreset> {
	constructor(app: App, private plugin: CalendarEventsPlugin) {
		super(app);
	}

	onTrigger(cursor: EditorPosition, editor: Editor, _file: TFile | null): EditorSuggestTriggerInfo | null {
		const trigger = this.plugin.settings.suggestTrigger || '))';

		const line = editor.getLine(cursor.line).slice(0, cursor.ch);
		const idx = line.lastIndexOf(trigger);
		if (idx === -1) return null;

		if (idx > 0 && !/\s/.test(line[idx - 1]!)) return null;

		return {
			start: { line: cursor.line, ch: idx },
			end: cursor,
			query: line.slice(idx + trigger.length),
		};
	}

	getSuggestions(context: EditorSuggestContext): RangePreset[] {
		const q = context.query.toLowerCase().trim();
		const presets = buildPresets(this.plugin.settings.firstDayOfWeek);
		if (!q) return presets;
		return presets.filter(p => p.name.toLowerCase().includes(q));
	}

	renderSuggestion(preset: RangePreset, el: HTMLElement): void {
		const row = el.createDiv({ cls: 'cal-events-suggest-row' });
		row.createSpan({ text: preset.name, cls: 'cal-events-suggest-name' });
		row.createSpan({ text: preset.label, cls: 'cal-events-suggest-label' });
	}

	selectSuggestion(preset: RangePreset, _evt: MouseEvent | KeyboardEvent): void {
		if (!this.context) return;
		const { editor, start, end } = this.context;
		editor.replaceRange('', start, end);
		const cursor = editor.getCursor();
		const { excludedCalendars, timeoutMs } = this.plugin.settings;
		const excluded = excludedCalendars.split(',').map(s => s.trim()).filter(Boolean);
		const notice = new Notice('Fetching calendar events…', 0);
		fetchEvents(preset.start, preset.end, excluded, timeoutMs).then(events => {
			notice.hide();
			const text = formatEvents(events, this.plugin.settings);
			editor.replaceRange(text, cursor);
			editor.setCursor(endOfInsertedText(cursor, text));
		}).catch((err: any) => {
			notice.hide();
			console.error('Calendar Events plugin error:', err);
			new Notice(friendlyError(err));
		});
	}
}

// -------------------------------------------------------------------
// Range Modal
// -------------------------------------------------------------------

class RangeModal extends Modal {
	private resolve: (value: { start: Date; end: Date } | typeof BACK) => void;
	private confirmed = false;

	constructor(app: App, private weekStart: number, resolve: (value: { start: Date; end: Date } | typeof BACK) => void) {
		super(app);
		this.resolve = resolve;
	}

	onOpen() {
		this.modalEl.addClass('cal-events-modal');
		const { contentEl } = this;

		this.titleEl.empty();
		const backBtn = this.titleEl.createEl('button', { text: '←', cls: 'cal-events-back-btn' });
		backBtn.addEventListener('click', () => this.close());
		this.titleEl.createSpan({ text: 'Calendar Events' });

		contentEl.createEl('p', { text: 'Pick a date range to fetch events for.', cls: 'cal-events-instructions' });

		const presets = buildPresets(this.weekStart);
		const btns: HTMLButtonElement[] = [];

		const confirm = (start: Date, end: Date) => {
			this.confirmed = true;
			this.resolve({ start, end });
			this.close();
		};

		presets.forEach((p, i) => {
			const btn = contentEl.createEl('button', { cls: 'cal-events-option-btn' });
			btn.createEl('span', { text: String(i + 1), cls: 'cal-events-option-num' });
			btn.createEl('span', { text: p.name,  cls: 'cal-events-option-subtext' });
			btn.createEl('span', { text: p.label, cls: 'cal-events-option-text' });
			btn.addEventListener('click', () => confirm(p.start, p.end));
			btns.push(btn);
		});

		const customBtn = contentEl.createEl('button', { cls: 'cal-events-option-btn' });
		customBtn.createEl('span', { text: String(presets.length + 1), cls: 'cal-events-option-num' });
		customBtn.createEl('span', { text: 'Custom…', cls: 'cal-events-option-text' });
		btns.push(customBtn);

		const customSection = contentEl.createEl('div', { cls: 'cal-events-custom-section cal-events-hidden' });

		const makeInput = (label: string, defaultVal: string) => {
			customSection.createEl('p', { text: label, cls: 'cal-events-instructions' });
			const input = customSection.createEl('input', { type: 'text', cls: 'cal-events-input' });
			input.placeholder = 'YYYY-MM-DD';
			input.value = defaultVal;
			return input;
		};

		const now = moment();
		const startInput = makeInput('Start date', now.format('YYYY-MM-DD'));
		const endInput   = makeInput('End date',   now.format('YYYY-MM-DD'));

		const submitCustom = () => {
			const sm = moment(startInput.value, 'YYYY-MM-DD');
			const em = moment(endInput.value, 'YYYY-MM-DD');
			if (!sm.isValid()) { new Notice('Invalid start date.'); return; }
			if (!em.isValid()) { new Notice('Invalid end date.'); return; }
			confirm(sm.startOf('day').toDate(), em.endOf('day').toDate());
		};

		const submitBtn = customSection.createEl('button', { cls: 'cal-events-ok-btn mod-cta', text: 'Fetch events' });
		submitBtn.addEventListener('click', submitCustom);
		[startInput, endInput].forEach(inp =>
			inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitCustom(); })
		);

		const openCustom = () => {
			customSection.classList.remove('cal-events-hidden');
			startInput.focus();
		};
		customBtn.addEventListener('click', openCustom);

		this.containerEl.addEventListener('keydown', (e: KeyboardEvent) => {
			// Let the user type freely in the custom date fields.
			if (activeDocument.activeElement instanceof HTMLInputElement) return;

			const customIdx = presets.length;
			const focused = btns.findIndex(b => b === activeDocument.activeElement);
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				btns[(focused + 1) % btns.length]?.focus();
			} else if (e.key === 'ArrowUp') {
				e.preventDefault();
				btns[(focused - 1 + btns.length) % btns.length]?.focus();
			} else if (e.key === 'Enter' && focused >= 0) {
				e.preventDefault();
				if (focused === customIdx) {
					openCustom();
				} else {
					const p = presets[focused]!;
					confirm(p.start, p.end);
				}
			} else {
				const idx = parseInt(e.key) - 1;
				if (idx === customIdx) {
					e.preventDefault();
					openCustom();
				} else if (!isNaN(idx) && idx >= 0 && idx < presets.length) {
					e.preventDefault();
					const p = presets[idx]!;
					confirm(p.start, p.end);
				}
			}
		});

		window.setTimeout(() => btns[0]?.focus(), 50);
	}

	onClose() {
		if (!this.confirmed) this.resolve(BACK);
		this.contentEl.empty();
	}
}

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

function endOfInsertedText(start: EditorPosition, text: string): EditorPosition {
	const lines = text.split('\n');
	return lines.length === 1
		? { line: start.line, ch: start.ch + text.length }
		: { line: start.line + lines.length - 1, ch: lines[lines.length - 1]!.length };
}

function friendlyError(err: any): string {
	if (err.code === 'ENOENT') return 'icalBuddy not found. Install with: brew install ical-buddy';
	if (err.killed || err.signal) return 'Calendar query timed out. Check Settings → Calendar Events.';
	const msg: string = err.stderr ?? err.message ?? '';
	if (msg.includes('No calendars')) return 'icalBuddy found no calendars. Grant it Calendar access in System Settings → Privacy & Security → Calendars.';
	return 'Could not fetch events. Check the console for details.';
}

// -------------------------------------------------------------------
// Plugin
// -------------------------------------------------------------------

export default class CalendarEventsPlugin extends Plugin {
	settings!: CalendarEventsSettings;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new CalendarEventsSettingTab(this.app, this));
		this.registerEditorSuggest(new CalendarEventsSuggest(this.app, this));

		this.addCommand({
			id: 'insert',
			name: 'Insert events',
			editorCallback: async (editor: Editor, _ctx: MarkdownView | MarkdownFileInfo) => {
				const range = await new Promise<{ start: Date; end: Date } | typeof BACK>((resolve) =>
					new RangeModal(this.app, this.settings.firstDayOfWeek, resolve).open()
				);

				if (range === BACK) return;

				const { excludedCalendars, timeoutMs } = this.settings;
				const excluded = excludedCalendars.split(',').map(s => s.trim()).filter(Boolean);
				const notice = new Notice('Fetching calendar events…', 0);
				try {
					const events = await fetchEvents(range.start, range.end, excluded, timeoutMs);
					notice.hide();
					editor.replaceSelection(formatEvents(events, this.settings));
				} catch (err: any) {
					notice.hide();
					console.error('Calendar Events plugin error:', err);
					new Notice(friendlyError(err));
				}
			},
		});
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
