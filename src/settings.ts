import { App, PluginSettingTab, Setting, moment as _moment } from 'obsidian';

type MomentFn = (input?: string | Date | number) => { format(fmt: string): string };
const moment = _moment as unknown as MomentFn;
import type CalendarEventsPlugin from './main';
import { formatEvents, type CalEvent } from './main';

export interface CalendarEventsSettings {
	suggestTrigger: string;
	excludedCalendars: string;
	timeoutMs: number;
	firstDayOfWeek: number;
	includeDate: boolean;
	dateFormat: string;
	includeTime: boolean;
	timeFormat: string;
	timeSeparator: string;
	wikiLinks: boolean;
	wikiLinksAlias: string;
	prefix: string;
	titleSeparator: string;
	groupByDate: boolean;
}

export const DEFAULT_SETTINGS: CalendarEventsSettings = {
	suggestTrigger: '))',
	excludedCalendars: '',
	timeoutMs: 20000,
	firstDayOfWeek: 0,
	includeDate: true,
	dateFormat: 'YYYY-MM-DD',
	includeTime: true,
	timeFormat: 'HH:mm',
	timeSeparator: ', ',
	wikiLinks: false,
	wikiLinksAlias: '',
	prefix: '- ',
	titleSeparator: ' — ',
	groupByDate: false,
};

export class CalendarEventsSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: CalendarEventsPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		const s = this.plugin.settings;
		let previewEl: HTMLElement | null = null;
		const now = new Date();
		const sampleEvents: CalEvent[] = [
			{ start: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 17, 0, 0), title: 'Team meeting', allDay: false },
			{ start: new Date(now.getFullYear(), now.getMonth(), now.getDate()), title: 'Holiday', allDay: true },
			{ start: new Date(now.getFullYear(), now.getMonth(), now.getDate()), end: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2), title: 'Conference', allDay: true },
			{ start: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 30, 0), title: 'Dentist', allDay: false },
		];
		const updatePreview = () => {
			if (previewEl) previewEl.setText(formatEvents(sampleEvents, s));
		};

		new Setting(containerEl).setName('Configuration').setHeading();

		new Setting(containerEl)
			.setName('Inline trigger')
			.setDesc('Type this in the editor to open the event range picker.')
			.addText(text => text
				.setPlaceholder('))')
				.setValue(this.plugin.settings.suggestTrigger)
				.onChange(async (value) => {
					this.plugin.settings.suggestTrigger = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName('Excluded calendars')
			.setDesc('Comma-separated list of calendar names to skip (e.g. Birthdays, US Holidays).')
			.addTextArea(text => {
				text
					.setPlaceholder('Birthdays, US Holidays, Siri Suggestions')
					.setValue(this.plugin.settings.excludedCalendars)
					.onChange(async (value) => {
						this.plugin.settings.excludedCalendars = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.rows = 3;
				text.inputEl.addClass('cal-events-settings-textarea');
			});

		new Setting(containerEl)
			.setName('Timeout (seconds)')
			.setDesc('How long to wait for a Calendar response before giving up.')
			.addSlider(slider => slider
				.setLimits(5, 60, 5)
				.setValue(this.plugin.settings.timeoutMs / 1000)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.timeoutMs = value * 1000;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName('First day of week')
			.setDesc("Determines the bounds of the 'This week' and 'Next week' ranges.")
			.addDropdown(dropdown => dropdown
				.addOptions({ '0': 'Sunday', '1': 'Monday', '2': 'Tuesday', '3': 'Wednesday', '4': 'Thursday', '5': 'Friday', '6': 'Saturday' })
				.setValue(String(s.firstDayOfWeek))
				.onChange(async (value) => {
					s.firstDayOfWeek = Number(value);
					await this.plugin.saveSettings();
				})
			);

		renderFormatControls(containerEl, s, async (structural) => {
			await this.plugin.saveSettings();
			if (structural) this.display(); else updatePreview();
		});

		new Setting(containerEl).setName('Output preview').setHeading();
		previewEl = containerEl.createEl('div', { cls: 'cal-events-settings-output-preview' });
		updatePreview();

		new Setting(containerEl).setName('Date format guide').setHeading();


		const tokenGroups: { label: string; tokens: [string, string, string][] }[] = [
			{
				label: 'Year',
				tokens: [
					['YYYY', 'Full year', '2026'],
					['YY', 'Short year', '26'],
				],
			},
			{
				label: 'Month',
				tokens: [
					['MMMM', 'Full name', 'January'],
					['MMM', 'Short name', 'Jan'],
					['MM', 'Padded number', '01'],
					['M', 'Number', '1'],
				],
			},
			{
				label: 'Day',
				tokens: [
					['DD', 'Padded', '01'],
					['D', 'Number', '1'],
					['Do', 'Ordinal', '1st'],
				],
			},
			{
				label: 'Weekday',
				tokens: [
					['dddd', 'Full name', 'Monday'],
					['ddd', 'Short name', 'Mon'],
					['dd', 'Min name', 'Mo'],
					['d', 'Number (0=Sun)', '1'],
					['E', 'Number (1=Mon)', '1'],
				],
			},
			{
				label: 'Time',
				tokens: [
					['HH', '24h hours', '17'],
					['h', '12h hours', '5'],
					['mm', 'Minutes', '30'],
					['A', 'AM/PM', 'PM'],
				],
			},
			{
				label: 'Literal',
				tokens: [
					['[text]', 'Literal text', 'text'],
				],
			},
		];

		const grid = containerEl.createEl('div', { cls: 'cal-events-settings-token-grid' });
		for (const group of tokenGroups) {
			const wrap = grid.createEl('div', { cls: 'cal-events-settings-token-group' });
			wrap.createEl('div', { cls: 'cal-events-settings-token-label', text: group.label });
			const table = wrap.createEl('table', { cls: 'cal-events-settings-tokens' });
			const tbody = table.createEl('tbody');
			for (const [token, desc, example] of group.tokens) {
				const tr = tbody.createEl('tr');
				tr.createEl('td').createEl('code', { text: token });
				tr.createEl('td', { text: desc });
				tr.createEl('td', { text: example });
			}
		}
	}
}

// Format controls shared by the settings tab and the Insert with preview modal.
// `onChange(true)` means a toggle changed which controls are enabled, so the caller should re-render.
export function renderFormatControls(el: HTMLElement, s: CalendarEventsSettings, onChange: (structural: boolean) => Promise<void>): void {
	new Setting(el).setName('Date & time format').setHeading();

	const includeDate = s.includeDate;
	const includeTime = s.includeTime;
	const setDisabled = (setting: Setting, disabled: boolean) => {
		setting.settingEl.classList.toggle('cal-events-disabled', disabled);
	};

	new Setting(el)
		.setName('Include date')
		.setDesc('Add the date to each event line. When off, only the time is shown for timed events.')
		.addToggle(toggle => toggle
			.setValue(s.includeDate)
			.onChange(async (value) => {
				s.includeDate = value;
				await onChange(true);
			})
		);

	const dateFormatSetting = new Setting(el)
		.setName('Date format')
		.setDesc('Format the date portion')
		.addText(text => {
			text.inputEl.parentElement!.addClass('cal-events-settings-has-preview');
			const preview = text.inputEl.parentElement!.createEl('div', {
				cls: 'cal-events-settings-preview',
				text: s.dateFormat ? moment().format(s.dateFormat) : '',
			});
			text
				.setPlaceholder('YYYY-MM-DD')
				.setValue(s.dateFormat)
				.onChange(async (value) => {
					s.dateFormat = value;
					preview.setText(value ? moment().format(value) : '');
					await onChange(false);
				});
		});
	setDisabled(dateFormatSetting, !includeDate);

	const wikiLinksSetting = new Setting(el)
		.setName('Wikilinks')
		.setDesc('Wrap the date in [[ ]] to link to a daily note.')
		.addToggle(toggle => toggle
			.setValue(s.wikiLinks)
			.onChange(async (value) => {
				s.wikiLinks = value;
				await onChange(false);
			})
		);
	setDisabled(wikiLinksSetting, !includeDate);

	const aliasSetting = new Setting(el)
		.setName('Wikilink alias format')
		.setDesc('Display text inside the wikilink. Leave blank for no alias: [[date]]. With a value: [[date|alias]].')
		.addText(text => {
			text.inputEl.parentElement!.addClass('cal-events-settings-has-preview');
			const preview = text.inputEl.parentElement!.createEl('div', {
				cls: 'cal-events-settings-preview',
				text: s.wikiLinksAlias ? moment().format(s.wikiLinksAlias) : '',
			});
			text
				.setPlaceholder('ddd MMM D')
				.setValue(s.wikiLinksAlias)
				.onChange(async (value) => {
					s.wikiLinksAlias = value;
					preview.setText(value ? moment().format(value) : '');
					await onChange(false);
				});
		});
	setDisabled(aliasSetting, !includeDate);

	el.createEl('div', { cls: 'cal-events-settings-spacer' });

	new Setting(el)
		.setName('Include time')
		.setDesc('Add the time to timed events. When off, the time is never shown.')
		.addToggle(toggle => toggle
			.setValue(s.includeTime)
			.onChange(async (value) => {
				s.includeTime = value;
				await onChange(true);
			})
		);

	const timeFormatSetting = new Setting(el)
		.setName('Time format')
		.setDesc('Format for the time portion (when applicable).')
		.addText(text => {
			text.inputEl.parentElement!.addClass('cal-events-settings-has-preview');
			const preview = text.inputEl.parentElement!.createEl('div', {
				cls: 'cal-events-settings-preview',
				text: s.timeFormat ? moment().format(s.timeFormat) : '',
			});
			text
				.setPlaceholder('HH:mm')
				.setValue(s.timeFormat)
				.onChange(async (value) => {
					s.timeFormat = value;
					preview.setText(value ? moment().format(value) : '');
					await onChange(false);
				});
		});
	setDisabled(timeFormatSetting, !includeTime);

	const sepSetting = new Setting(el)
		.setName('Date–time separator')
		.setDesc('Text between the date and time for timed events. Defaults to a space if left blank.')
		.addText(text => text
			.setPlaceholder('e.g. `, `')
			.setValue(s.timeSeparator)
			.onChange(async (value) => {
				s.timeSeparator = value;
				await onChange(false);
			})
		);
	setDisabled(sepSetting, !includeDate || !includeTime);

	new Setting(el).setName('List format').setHeading();

	new Setting(el)
		.setName('Prefix')
		.setDesc('Text prepended to each event line.')
		.addText(text => text
			.setPlaceholder('e.g. `-` or `- [ ] `')
			.setValue(s.prefix)
			.onChange(async (value) => {
				s.prefix = value;
				await onChange(false);
			})
		);

	new Setting(el)
		.setName('Title separator')
		.setDesc('Text between the date/time and the event title.')
		.addText(text => text
			.setPlaceholder('e.g. `- `')
			.setValue(s.titleSeparator)
			.onChange(async (value) => {
				s.titleSeparator = value;
				await onChange(false);
			})
		);

	new Setting(el)
		.setName('Group by date')
		.setDesc('Show each date once as a bold line above its events, instead of on every line.')
		.addToggle(toggle => toggle
			.setValue(s.groupByDate)
			.onChange(async (value) => {
				s.groupByDate = value;
				await onChange(false);
			})
		);
}
