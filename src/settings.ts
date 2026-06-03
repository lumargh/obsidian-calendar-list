import { App, PluginSettingTab, Setting, moment as _m } from 'obsidian';
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
const moment = _m as any;
import type CalendarEventsPlugin from './main';

export interface CalendarEventsSettings {
	suggestTrigger: string;
	excludedCalendars: string;
	timeoutMs: number;
	dateFormat: string;
	timeFormat: string;
	timeSeparator: string;
	wikiLinks: boolean;
	wikiLinksAlias: string;
	prefix: string;
	titleSeparator: string;
}

export const DEFAULT_SETTINGS: CalendarEventsSettings = {
	suggestTrigger: '))',
	excludedCalendars: '',
	timeoutMs: 20000,
	dateFormat: 'ddd MMM D',
	timeFormat: 'HH:mm',
	timeSeparator: ', ',
	wikiLinks: false,
	wikiLinksAlias: '',
	prefix: '- ',
	titleSeparator: ' — ',
};

export class CalendarEventsSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: CalendarEventsPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName('Calendar').setHeading();

		new Setting(containerEl)
			.setName('Inline trigger')
			.setDesc('Type this in the editor to open the event range picker. Default: )).')
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
				text.inputEl.style.width = '100%';
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

		new Setting(containerEl).setName('Output format').setHeading();

		new Setting(containerEl)
			.setName('Date format')
			.setDesc('Format for the date portion')
			.addText(text => {
				text.inputEl.parentElement!.addClass('cal-events-settings-has-preview');
				// eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
				const preview = text.inputEl.parentElement!.createEl('div', {
					cls: 'cal-events-settings-preview',
					// eslint-disable-next-line @typescript-eslint/no-unsafe-call
					text: this.plugin.settings.dateFormat ? moment().format(this.plugin.settings.dateFormat) : '',
				});
				text
					.setPlaceholder('ddd MMM D')
					.setValue(this.plugin.settings.dateFormat)
					.onChange(async (value) => {
						this.plugin.settings.dateFormat = value;
						// eslint-disable-next-line @typescript-eslint/no-unsafe-call
						preview.setText(value ? moment().format(value) : '');
						await this.plugin.saveSettings();
					});
			});

			new Setting(containerEl)
			.setName('Wiki links')
			.setDesc('Wrap the date in [[ ]] to link to a daily note.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.wikiLinks)
				.onChange(async (value) => {
					this.plugin.settings.wikiLinks = value;
					await this.plugin.saveSettings();
				})
			);
			
			new Setting(containerEl)
			.setName('Wiki link alias format')
			.setDesc('Display text inside the wiki link. Leave blank for no alias: [[date]]. With a value: [[date|alias]].')
			.addText(text => {
				text.inputEl.parentElement!.addClass('cal-events-settings-has-preview');
				const preview = text.inputEl.parentElement!.createEl('div', {
					cls: 'cal-events-settings-preview',
					// eslint-disable-next-line @typescript-eslint/no-unsafe-call
					text: this.plugin.settings.wikiLinksAlias ? moment().format(this.plugin.settings.wikiLinksAlias) : '',
				});
				text
				.setPlaceholder('ddd MMM D')
				.setValue(this.plugin.settings.wikiLinksAlias)
				.onChange(async (value) => {
					this.plugin.settings.wikiLinksAlias = value;
					// eslint-disable-next-line @typescript-eslint/no-unsafe-call
					preview.setText(value ? moment().format(value) : '');
					await this.plugin.saveSettings();
				});
			});
			
			new Setting(containerEl)
				.setName('Time format')
				.setDesc('Format for the time portion (when applicable).')
				.addText(text => {
					text.inputEl.parentElement!.addClass('cal-events-settings-has-preview');
					// eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
					const preview = text.inputEl.parentElement!.createEl('div', {
						cls: 'cal-events-settings-preview',
						// eslint-disable-next-line @typescript-eslint/no-unsafe-call
						text: this.plugin.settings.timeFormat ? moment().format(this.plugin.settings.timeFormat) : '',
					});
					text
						.setPlaceholder('HH:mm')
						.setValue(this.plugin.settings.timeFormat)
						.onChange(async (value) => {
							this.plugin.settings.timeFormat = value;
							// eslint-disable-next-line @typescript-eslint/no-unsafe-call
							preview.setText(value ? moment().format(value) : '');
							await this.plugin.saveSettings();
						});
				});
	
			new Setting(containerEl)
				.setName('Date–time separator')
				.setDesc('Text between the date and time for timed events. Defaults to a space if left blank.')
				.addText(text => text
					.setPlaceholder(', ')
					.setValue(this.plugin.settings.timeSeparator)
					.onChange(async (value) => {
						this.plugin.settings.timeSeparator = value;
						await this.plugin.saveSettings();
					})
				);
	
		new Setting(containerEl)
			.setName('Prefix')
			.setDesc('Text prepended to each event line (e.g. - or - [ ] ).')
			.addText(text => text
				.setPlaceholder('- ')
				.setValue(this.plugin.settings.prefix)
				.onChange(async (value) => {
					this.plugin.settings.prefix = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName('Title separator')
			.setDesc('Text between the date/time and the event title.')
			.addText(text => text
				.setPlaceholder(' - ')
				.setValue(this.plugin.settings.titleSeparator)
				.onChange(async (value) => {
					this.plugin.settings.titleSeparator = value;
					await this.plugin.saveSettings();
				})
			);

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
