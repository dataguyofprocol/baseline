import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { useApp } from './store.js';
import { uniquelyNamed } from '../../src/core/mentions.js';

marked.setOptions({ gfm: true, breaks: true });

/* Rendered markdown: links open in a new tab, issue keys (CORE-12) become links to the
   issue, and mentions become chips. A mention is `@[Name](user:id)` from the editor, or a plain
   @Full Name that only one member has. Everything is sanitized last: comments and descriptions are
   other people's input. */

/** what rendered markdown may contain (DOMPurify's safe HTML, plus link targets) */
export function sanitize(html: string): string {
  return DOMPurify.sanitize(html, { ADD_ATTR: ['target', 'rel'], FORBID_TAGS: ['style', 'form', 'button', 'textarea', 'select'] });
}
export function Markdown({ text }: { text: string }) {
  const snap = useApp(s => s.snap);
  const navigate = useNavigate();
  const html = useMemo(() => {
    if (!text?.trim()) return null;
    const raw = marked.parse(text) as string;
    const doc = new DOMParser().parseFromString(`<body>${raw}</body>`, 'text/html');
    // @[Name](user:id) parses as "@" followed by a link to user:id; turn it into a chip with the person's current name
    doc.querySelectorAll('a[href^="user:"]').forEach(a => {
      const prev = a.previousSibling;
      if (!(prev instanceof Text) || !prev.data.endsWith('@')) return;
      prev.data = prev.data.slice(0, -1);
      const uid = a.getAttribute('href')!.slice(5);
      const span = doc.createElement('span');
      span.className = 'mention';
      span.dataset.userId = uid;
      span.textContent = `@${snap?.users.find(u => u.id === uid)?.name ?? a.textContent}`;
      a.replaceWith(span);
    });
    doc.querySelectorAll('a').forEach(a => { if (!a.getAttribute('href')?.startsWith('#')) { a.target = '_blank'; a.rel = 'noreferrer'; } });
    if (snap) {
      const keys = new Set(snap.issues.map(i => `${snap.teams.find(t => t.id === i.teamId)?.key}-${i.number}`));
      // plain "@Name" is only a mention when nobody else shares the name
      const names = uniquelyNamed(snap.users).sort((a, b) => b.name.length - a.name.length).map(u => u.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      const re = new RegExp(`\\b([A-Z][A-Z0-9]{0,9}-\\d+)\\b${names.length ? `|@(${names.join('|')})(?![\\w])` : ''}`, 'g');
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
      const texts: Text[] = [];
      while (walker.nextNode()) texts.push(walker.currentNode as Text);
      for (const t of texts) {
        if (t.parentElement?.closest('code, pre, a, .mention')) continue;
        const value = t.nodeValue ?? '';
        re.lastIndex = 0;
        if (!re.test(value)) continue;
        re.lastIndex = 0;
        const frag = doc.createDocumentFragment();
        let last = 0;
        for (let m = re.exec(value); m; m = re.exec(value)) {
          if (m[1] && !keys.has(m[1])) continue;
          frag.append(value.slice(last, m.index));
          if (m[1]) {
            const a = doc.createElement('a');
            a.href = `#/issue/${m[1]}`; a.className = 'issue-ref'; a.textContent = m[1];
            frag.append(a);
          } else {
            const span = doc.createElement('span');
            span.className = 'mention'; span.textContent = `@${m[2]}`;
            frag.append(span);
          }
          last = m.index + m[0].length;
        }
        frag.append(value.slice(last));
        t.replaceWith(frag);
      }
    }
    return sanitize(doc.body.innerHTML);
  }, [text, snap]);
  if (!html) return null;
  return (
    <div className="md" dangerouslySetInnerHTML={{ __html: html }}
      onClick={e => {
        const a = (e.target as HTMLElement).closest('a.issue-ref') as HTMLAnchorElement | null;
        if (a) { e.preventDefault(); e.stopPropagation(); navigate(a.getAttribute('href')!.slice(1)); }
      }} />
  );
}
