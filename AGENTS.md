# AGENTS.md

## pstack skills (poteto's engineering toolkit)

The [pstack](https://github.com/cursor/plugins/tree/main/pstack) plugin (MIT) is
installed under the `.agents/` convention:

- Skills live in `.agents/skills/<name>/SKILL.md` (58 skills, including
  `poteto-mode`, `why`, `how`, `tdd`, `architect`, and the `principle-*` set).
- Guide and harness notes: `.agents/pstack/docs/`. When a pstack skill uses a
  Cursor-specific tool or subagent name, map it per
  `.agents/pstack/docs/harness/claude-code.md`.
- A pstack skill's `<pstack>/skills/<name>/SKILL.md` means
  `.agents/skills/<name>/SKILL.md` in this repo.
- Provenance and update steps: `.agents/pstack/INSTALLED.md`.
- Claude Code discovers them through `.claude/skills`, a symlink to
  `../.agents/skills` (one copy, no duplication).
