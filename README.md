# Calendar List

An Obsidian plugin for pulling events from your macOS Calendar app and inserting them directly into your notes. This plugin is actively being developed, so create a GitHub issue if you have any trouble.

## Features

Pick a date range — today, this week, next month, whatever — and the plugin fetches your calendar events and drops them into your note as a formatted list. Titles, dates, and times, in whatever format you like.

### Inline `@))` autosuggest

Type `@))` (or your configured trigger) anywhere in a note to open a range picker inline. Five presets appear immediately — press **↵** or **⇥** to insert, **↑↓** to navigate.

| Preset | What you get |
|---|---|
| Today | Events for today |
| Tomorrow | Events for tomorrow |
| This week | Mon–Sun of the current week |
| Next week | Mon–Sun of next week |
| This month | All events this calendar month |

---

### Insert Calendar Events command

Open the command palette and run **Calendar List: Insert calendar events**. The same five presets appear in a modal — click or press the matching number to fetch and insert immediately.

Need a custom window? Choose **Custom…** to enter a specific start and end date.

---

### Output format

Everything about the output is configurable in Settings → Calendar List:

| Setting | Default | Description |
|---|---|---|
| Date format | `ddd MMM D` | Moment.js format for the date portion |
| Wiki links | Off | Wrap the date in `[[ ]]` to link to a daily note |
| Wiki link alias | _(blank)_ | If set, produces `[[date\|alias]]` |
| Time format | `HH:mm` | Format for the time portion |
| Date–time separator | `, ` | Text between date and time |
| Prefix | `- ` | Text before each event line |
| Title separator | ` — ` | Text between the date/time and event title |

A date format guide with common tokens is included at the bottom of the settings page.

---

### Excluding calendars

Large or slow calendars (Birthdays, Siri Suggestions, subscription calendars) can make fetches sluggish. Add them to the **Excluded calendars** list in settings to skip them entirely. You can also increase the timeout if you have remote calendars that are just slow.

---

## Requirements

**macOS only.** Calendar List reads your calendars through a command-line tool called [icalBuddy](https://hasseg.org/icalBuddy/), which talks to the same EventKit framework that Apple's own apps use. You'll need to install it once before the plugin will work.

**Option 1 — Homebrew (recommended)**

If you have [Homebrew](https://brew.sh), open Terminal and run:

```
brew install ical-buddy
```

If you don't have Homebrew yet, it's a one-line install and well worth having — it's the standard package manager for macOS developer tools.

**Option 2 — Direct download**

Download the latest release directly from the [icalBuddy GitHub releases page](https://github.com/ali-rantakari/icalBuddy/releases). Unzip it and move the `icalBuddy` binary somewhere on your PATH (e.g. `/usr/local/bin/`).

---

The first time icalBuddy runs, macOS will ask for permission to access your Calendar. Allow it, and you're set. If you're not sure whether it's working, open Terminal and run `icalBuddy eventsToday` — you should see today's events listed.

## Related plugins

If you like Calendar List, you might also like [Date List](https://github.com/lumargh/obsidian-date-list) — a companion plugin for inserting single dates and formatted date lists with a live-preview wizard and inline autocomplete.

## Feedback and contributions

Let me know if you have any feedback or suggestions!

## License

[0-BSD](LICENSE) — free to use, modify, and distribute.
