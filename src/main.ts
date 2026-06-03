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

interface CalEvent {
	start: Date;
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

	const flush = () => {
		if (!title || dateTimeLine === null) return;
		const raw = dateTimeLine.trim();

		// Map prose date words to moment offsets
		const wordOffset: Record<string, number> = { today: 0, tomorrow: 1, yesterday: -1 };
		const atMatch  = raw.match(/^(\S+)\s+at\s+(\d{2}:\d{2})/);
		const dayOnly  = raw.match(/^(\S+)$/);

		const datePart = (atMatch ?? dayOnly)?.[1] ?? '';
		const timePart = atMatch?.[2] ?? null;

		let base: MomentInstance;
		const offset = wordOffset[datePart.toLowerCase()];
		if (offset !== undefined) {
			base = moment().startOf('day').add(offset, 'days') as MomentInstance;
		} else {
			base = moment(datePart, 'YYYY-MM-DD') as MomentInstance;
		}
		if (!base.isValid()) { title = null; dateTimeLine = null; return; }

		let start: Date;
		let allDay: boolean;
		if (timePart) {
			const [h, m] = timePart.split(':').map(Number);
			start = base.clone().hours(h ?? 0).minutes(m ?? 0).seconds(0).toDate();
			allDay = false;
		} else {
			start = base.toDate();
			allDay = true;
		}
		events.push({ start, title, allDay });
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

const ANSI_RE = /\[[0-9;]*m/g;

async function fetchEvents(start: Date, end: Date, excluded: string[], timeoutMs: number): Promise<CalEvent[]> {
	const buddy = findIcalBuddy();
	const startStr = moment(start).format('YYYY-MM-DD');
	const endStr   = moment(end).format('YYYY-MM-DD');

	const args = ['-iep', 'title,datetime', '-df', '%Y-%m-%d', '-tf', '%H:%M', '-nc', '-b', '###EVT###'];
	if (excluded.length > 0) args.push('-ec', excluded.join(','));
	args.push(`eventsFrom:${startStr}`, `to:${endStr}`);

	const { stdout } = await execFileAsync(buddy, args, { timeout: timeoutMs });
	return parseIcalBuddyOutput(stdout.replace(ANSI_RE, ''));
}

function formatEvents(events: CalEvent[], settings: CalendarEventsSettings): string {
	if (events.length === 0) return '(no events found)';
	return events.map((e) => {
		const m = moment(e.start);
		const dateStr = m.format(settings.dateFormat || 'ddd MMM D');
		const aliasStr = settings.wikiLinksAlias ? m.format(settings.wikiLinksAlias) : null;
		const wrapped = settings.wikiLinks
			? (aliasStr ? `[[${dateStr}|${aliasStr}]]` : `[[${dateStr}]]`)
			: dateStr;
		const sep = settings.timeSeparator || ' ';
		const timeStr = e.allDay ? '' : sep + m.format(settings.timeFormat || 'HH:mm');
		return `${settings.prefix}${wrapped}${timeStr}${settings.titleSeparator}${e.title}`;
	}).join('\n');
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

function buildPresets(): RangePreset[] {
	const now = moment();
	const toDate = (m: MomentInstance) => m.toDate();
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
			label: `${now.clone().startOf('isoWeek').format('MMM D')} – ${now.clone().endOf('isoWeek').format('MMM D')}`,
			start: toDate(now.clone().startOf('isoWeek')),
			end:   toDate(now.clone().endOf('isoWeek')),
		},
		{
			name: 'Next week',
			label: `${now.clone().add(1,'weeks').startOf('isoWeek').format('MMM D')} – ${now.clone().add(1,'weeks').endOf('isoWeek').format('MMM D')}`,
			start: toDate(now.clone().add(1,'weeks').startOf('isoWeek')),
			end:   toDate(now.clone().add(1,'weeks').endOf('isoWeek')),
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
// Inline editor suggest (@ev trigger)
// -------------------------------------------------------------------

class CalendarEventsSuggest extends EditorSuggest<RangePreset> {
	constructor(app: App, private plugin: CalendarEventsPlugin) {
		super(app);
	}

	onTrigger(cursor: EditorPosition, editor: Editor, _file: TFile | null): EditorSuggestTriggerInfo | null {
		const trigger = this.plugin.settings.suggestTrigger;
		if (!trigger) return null;

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
		const presets = buildPresets();
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
			editor.replaceRange(formatEvents(events, this.plugin.settings), cursor);
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

	constructor(app: App, resolve: (value: { start: Date; end: Date } | typeof BACK) => void) {
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

		const presets = buildPresets();
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

		customBtn.addEventListener('click', () => {
			customSection.classList.remove('cal-events-hidden');
			startInput.focus();
		});

		this.containerEl.addEventListener('keydown', (e: KeyboardEvent) => {
			const focused = btns.findIndex(b => b === activeDocument.activeElement);
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				btns[(focused + 1) % btns.length]?.focus();
			} else if (e.key === 'ArrowUp') {
				e.preventDefault();
				btns[(focused - 1 + btns.length) % btns.length]?.focus();
			} else if (e.key === 'Enter' && focused >= 0 && focused < presets.length) {
				e.preventDefault();
				const p = presets[focused]!;
				confirm(p.start, p.end);
			} else {
				const idx = parseInt(e.key) - 1;
				if (!isNaN(idx) && idx >= 0 && idx < presets.length) {
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
			name: 'Insert calendar events',
			editorCallback: async (editor: Editor, _ctx: MarkdownView | MarkdownFileInfo) => {
				const range = await new Promise<{ start: Date; end: Date } | typeof BACK>((resolve) =>
					new RangeModal(this.app, resolve).open()
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
