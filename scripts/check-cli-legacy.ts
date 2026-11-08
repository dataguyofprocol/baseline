// The CLI's move onto the client, as a ratchet. Commands not yet migrated open the database through
// src/cli/legacy.ts; this fails when
//   - the number of legacyStore(/legacyApp( calls in src/cli differs from scripts/cli-legacy-budget.txt
//     (higher: a new command skipped the client; lower: write the new count into the budget file),
//   - anything in src/cli besides legacy.ts reaches the database (core/store, core/db, createApp),
//   - anything in src/client besides transport.ts reaches the server or the store.
//
//   npx tsx scripts/check-cli-legacy.ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const read = (dir: string) => readdirSync(join(root, dir)).filter(f => f.endsWith('.ts')).map(f => ({ file: `${dir}/${f}`, text: readFileSync(join(root, dir, f), 'utf8') }));
const problems: string[] = [];

const cli = read('src/cli');
const calls = cli.filter(f => !f.file.endsWith('/legacy.ts')).reduce((n, f) => n + (f.text.match(/\blegacy(Store|App)\(/g)?.length ?? 0), 0);
const budget = Number(readFileSync(join(root, 'scripts/cli-legacy-budget.txt'), 'utf8').trim());
if (calls > budget) problems.push(`${calls} legacy database calls in src/cli, budget ${budget}: a command opens the database directly — call it through connect() and the client instead`);
if (calls < budget) problems.push(`${calls} legacy database calls in src/cli, budget ${budget}: lower scripts/cli-legacy-budget.txt to ${calls}`);

for (const f of cli.filter(f => !f.file.endsWith('/legacy.ts'))) {
  if (/from '\.\.\/core\/(store|db)\.js'/.test(f.text) || /\bcreateApp\b/.test(f.text)) problems.push(`${f.file} reaches the database directly; only src/cli/legacy.ts may`);
}
for (const f of read('src/client')) {
  if (f.file.endsWith('/transport.ts')) continue;
  if (/from '\.\.\/(server\/[^']+|core\/store)\.js'/.test(f.text)) problems.push(`${f.file} imports the server or the store; the client reaches them only through a transport`);
}

if (problems.length) { for (const p of problems) console.error(`✗ ${p}`); process.exit(1); }
console.log(`✓ ${calls} legacy database calls in src/cli (budget ${budget}); the CLI and client boundaries hold`);
