# Triage

Issues filed into a team's Triage state (by agents, teammates or the CLI) wait in that team's triage queue. A user accepts, marks as duplicate, declines or snoozes each one with a single key, and the queue advances.

## Sub-features

- `triage-queue` the queue lists every issue in the Triage state.
- `triage-accept` 1 accepts into Todo and moves to the next item.
- `triage-duplicate` 2 opens the issue picker to mark a duplicate.
- `triage-decline` 3 cancels it.
- `triage-snooze` H snoozes until a chosen time; Display › Show snoozed brings it back.
- `triage-filter` filters, newest/oldest ordering, and Create triage issue.
- `triage-cli` `issue create -t AGO -s Triage` files straight into the queue.

## How to get to it (user POV)

- Sidebar › Your teams › Agent Surface › Triage (shows a count), or `#/team/AGO/triage`.
- Only `AGO` has a Triage state in the seed workspace. `CORE` has none.
- Terminal: `baseline issue create "Title" -t AGO -s Triage --as Ada`.

## Driving it with drive.mjs and vb

Preconditions:

- A fresh run that passes `vb doctor <run>`. `AGO-7` is in Triage.

- **All triage journeys.** Run `drive.mjs <run> harness triage --name triage-section`. The section files four `Harness triage A–D` issues as setup, then rows `3.1`–`3.5` print `PASS` (accepted into Todo, declined → Canceled, snoozed until a timestamp, filter pill shown).
- **CLI files, UI shows.** Run `vb cli <run> issue create "Verify triage via CLI" -t AGO -s Triage --as Ada`. Stdout is the new key (`AGO-<n>`). Then run `drive.mjs <run> shot /team/AGO/triage --name triage-cli-filed`. The screenshot lists `Verify triage via CLI` in `.inbox-row`.
- **Accept persists.** After accepting in the UI, run `vb cli <run> issue show <key> --json`. State is `Todo`.

## Gotchas

- The triage section creates its setup issues through the API (`t.post`). That is setup, not proof of filing. Prove filing through the CLI step above or the Create triage issue button (row `3.5`).
- Snoozed issues are hidden unless Display › Show snoozed is on. Row `3.4` turns it back off at the end, so do not assume either state when chaining.
- Keys 1/2/3 act on the selected row (`.inbox-row.selected`). With nothing selected they act on the first row.
