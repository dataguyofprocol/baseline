# pstack — installed in this repo

- Source: https://github.com/cursor/plugins/tree/main/pstack
- Version: 0.15.36 (from `plugin.json`)
- Pinned commit of `cursor/plugins` at install: `2776ddd2355d6d6c8747d3964600f28daf62f049`
- Installed: 2026-11-06
- Re-verified 2026-11-08 against `cursor/plugins@6b0300214a09fd6029cfb7077043125758cd1fd2`: identical, still 0.15.36.
- Claude Code: `.claude/skills` is a symlink to `../.agents/skills`.
- License: MIT (see `LICENSE` here)

## Layout

pstack is a Cursor/Claude Code plugin; this repo uses the cross-agent `.agents/`
convention so ZCode, Codex, and friends all discover it.

| Upstream path | This repo |
| --- | --- |
| `pstack/skills/<name>/` | `.agents/skills/<name>/` (all 58 skills, flat — standard discovery location) |
| `pstack/docs/` (guide + `harness/`) | `.agents/pstack/docs/` |
| `pstack/agents/` (poteto-agent, comment-sicko) | `.agents/pstack/agents/` |
| `pstack/automations/benny/` (Cursor-only) | `.agents/pstack/automations/benny/` (not flattened into `.agents/skills/`; benny's skills target Cursor Automations) |
| `pstack/README.md`, `LICENSE`, `plugin.json` | `.agents/pstack/` |

When a pstack skill says `<pstack>/skills/<name>/SKILL.md`, read
`.agents/skills/<name>/SKILL.md`. For harness differences (tool names,
subagent fields, models), read `.agents/pstack/docs/harness/claude-code.md`
and map names to the current harness the same way.

## Updating

```sh
git clone --depth 1 https://github.com/cursor/plugins /tmp/cursor-plugins
cd <repo>
rm -rf .agents/skills .agents/pstack/docs .agents/pstack/agents .agents/pstack/automations
# then repeat the copy steps from the layout table above, and record the new commit + version here
```
