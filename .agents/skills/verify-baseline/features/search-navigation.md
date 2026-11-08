# Search and navigation

A user moves around Baseline with the sidebar, G-chords and the ⌘K palette, and finds issues on the search page by title, key, description or comment text. The CLI searches titles and descriptions.

## Sub-features

- `nav-sidebar` Inbox, My issues, Workspace items, Favorites, Your teams with team sub-items.
- `nav-chords` G then I/M/A/E/B/T/C/V/W/U/D/N/P/X/S go to their pages.
- `nav-palette` ⌘K opens the command palette, scoped to the open issue.
- `nav-toggles` `[` toggles the sidebar, ⌘B flips list and board.
- `search-page` `/` opens the search page; matches titles, keys, descriptions and comments, with tabs for All, Issues, Projects, Initiatives, Documents.
- `search-cli` `baseline search "query"` from the terminal.

## How to get to it (user POV)

- Press `/` outside a text field, or the magnifier icon at the top of the sidebar.
- Press ⌘K anywhere.
- Terminal: `baseline search "theme"`.

## Driving it with drive.mjs and vb

Preconditions:

- A fresh run that passes `vb doctor <run>`. `CORE-1` "Theme switching without reload" exists, and seed comments include the text "light theme needs".

- **Navigation and search journeys.** Run `drive.mjs <run> harness shell --name shell-section`. Rows `1.1`–`1.12` print `PASS`. Row `1.9` reports a hit each for comment text, key `CORE-3`, and title.
- **CLI search.** Run `vb cli <run> search "theme"`. Exit 0, and stdout lists `CORE-1`, `CORE-13`, `CORE-15` and ends with `3 issue(s), 0 project(s)`.
- **Search page screenshot.** Write a short eval journey that does `await t.press('/')`, types into the visible input, and returns the `[data-search-row="Issue"]` count. Run it with `drive.mjs <run> eval /inbox <file> --name search-page`.

## Gotchas

- CLI `search` does not match issue keys: `search CORE-3` returns `0 issue(s)`. Key search is a web-only behavior, so prove it in the UI.
- Results update after a short delay. The harness waits 800 ms after typing; wait for result rows, not a fixed sleep, in new journeys.
- `/` inside a text field types a slash. Call `await t.closeAll()` first.
