import ts from 'typescript';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

type Kind = 'comment' | 'text';
type Hit = { file: string; line: number; kind: Kind; mark: string; source: string };

const root = join(import.meta.dirname, '..');
const MARKS = /[—–‘’“”]/g;
const CURLY = /[‘’“”]/;
const LONE_DASH = /^([\s`'"}]|\\n)*[—–][\s`'"]*(\$\{)?$/;
const KEEP_LINE = /agent-loop:start/;
const NUMBER_RANGE = /\d ?– ?\d/;

const files = execSync('git ls-files src web scripts bin', { cwd: root, encoding: 'utf8' }).split('\n')
  .filter(f => /\.(ts|tsx|js|mjs|css|sh)$/.test(f) && f !== 'scripts/unslop-scan.ts');
const read = (file: string) => readFileSync(join(root, file), 'utf8');
const isScript = (file: string) => /\.(ts|tsx|js|mjs)$/.test(file);
const parse = (file: string, src: string) => ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true,
  file.endsWith('.tsx') ? ts.ScriptKind.TSX : file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS);

function textSpans(file: string, src: string): Array<[number, number, boolean]> {
  const sf = parse(file, src);
  const spans: Array<[number, number, boolean]> = [];
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteralLike(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n) || ts.isJsxText(n))
      spans.push([n.getStart(sf), n.getEnd(), LONE_DASH.test(n.getText(sf))]);
    else if (ts.isRegularExpressionLiteral(n)) spans.push([n.getStart(sf), n.getEnd(), true]);
    n.forEachChild(visit);
  };
  visit(sf);
  return spans;
}

const SH_COMMENT = /^\s*#|\s#\s/;
const cssComments = (src: string) => [...src.matchAll(/\/\*[\s\S]*?\*\//g)].map(m => [m.index!, m.index! + m[0].length]);

function scan(file: string): Hit[] {
  const src = read(file);
  const lines = src.split('\n');
  const spans = isScript(file) ? textSpans(file, src) : [];
  const comments = file.endsWith('.css') ? cssComments(src) : [];
  const hits: Hit[] = [];
  for (const m of src.matchAll(MARKS)) {
    const pos = m.index!;
    const line = src.slice(0, pos).split('\n').length;
    const source = lines[line - 1];
    if (KEEP_LINE.test(source)) continue;
    let kind: Kind;
    if (file.endsWith('.sh')) {
      if (/["^]$/.test(src.slice(pos - 1, pos))) continue;
      kind = SH_COMMENT.test(source) ? 'comment' : 'text';
    }
    else if (file.endsWith('.css')) kind = comments.some(([a, b]) => pos >= a && pos < b) ? 'comment' : 'text';
    else {
      const span = spans.find(([a, b]) => pos >= a && pos < b);
      if (span?.[2]) continue;
      kind = span ? 'text' : 'comment';
    }
    if (kind === 'text' && (CURLY.test(m[0]) || (m[0] === '–' && NUMBER_RANGE.test(src.slice(pos - 2, pos + 3))))) continue;
    hits.push({ file, line, kind, mark: m[0], source: source.trim() });
  }
  return hits;
}

function codeHash(file: string): string {
  const src = read(file);
  const code = isScript(file) ? ts.createPrinter({ removeComments: true }).printFile(parse(file, src))
    : file.endsWith('.css') ? src.replace(/\/\*[\s\S]*?\*\//g, '')
    : src.split('\n').filter(l => !/^\s*#/.test(l)).map(l => l.replace(/\s#\s.*$/, '')).join('\n');
  return createHash('sha256').update(code).digest('hex').slice(0, 16);
}

const args = process.argv.slice(2);
if (args.includes('--code-hash')) {
  for (const f of files) console.log(`${codeHash(f)}  ${f}`);
} else {
  const hits = files.flatMap(scan);
  if (args.includes('--summary')) {
    const count = (key: (h: Hit) => string) => {
      const n = new Map<string, number>();
      for (const h of hits) n.set(key(h), (n.get(key(h)) ?? 0) + 1);
      return [...n].sort((a, b) => b[1] - a[1]).map(([k, v]) => `  ${v}\t${k}`).join('\n');
    };
    console.log(`by kind\n${count(h => h.kind)}\nby directory\n${count(h => h.file.split('/').slice(0, 2).join('/'))}`);
  } else for (const h of hits) console.log(`${h.file}:${h.line}  ${h.kind}  ${h.source.slice(0, 140)}`);
  console.log(`${hits.length} to fix`);
  process.exitCode = hits.length ? 1 : 0;
}
