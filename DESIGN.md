# Baseline design tokens

The tokens live in `web/src/styles.css`: `:root` holds the dark theme (the default) and
`:root[data-theme='light']` the light one. Read the values there; this file only names the system.

- **Surfaces:** `--bg-main` for the page, `--bg-sidebar`, `--bg-overlay` for modals and board cards,
  `--bg-menu` for menus, the palette and toasts, `--bg-active` and `--bg-hover` for rows.
- **Text:** `--text-primary`, `--text-secondary`, `--text-dim`.
- **Lines:** `--border`, `--border-strong`, `--hairline`; `--shadow-overlay` for floating surfaces.
- **Brand and state:** `--brand` for buttons, links, selection and the done state; status and
  priority glyphs are drawn in `web/src/pickers.tsx`.
- **Type:** `--font-ui` is Inter Variable (bundled, OFL), with weight stops 400 / 510 / 590 / 680.
  `--font-code` is Berkeley Mono when installed, else the bundled JetBrains Mono. Base UI text is
  13px.
- **Motion:** durations and easings are tokens too (`--ease`), and `prefers-reduced-motion`
  turns animation off.
