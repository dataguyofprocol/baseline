import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import { Extension, type Range } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Image from '@tiptap/extension-image';
import Mention from '@tiptap/extension-mention';
import Suggestion, { type SuggestionProps, type SuggestionKeyDownProps } from '@tiptap/suggestion';
import { marked } from 'marked';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { create } from 'zustand';
import { useApp } from './store.js';
import { api } from './api.js';
import { Avatar, StateIcon } from './pickers.js';

/* Descriptions and comments are stored as Markdown (agents read and write them through the
   CLI), and edited as rich text, like Linear: headings, lists, checklists, code, quotes,
   links, images, @mentions and a "/" command menu. Markdown ↔ HTML happens at the edges. */

/* ---------- markdown → editor HTML ---------- */
function escapeRe(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export function markdownToHtml(md: string): string {
  const snap = useApp.getState().snap;
  let html = marked.parse(md ?? '', { gfm: true, breaks: true }) as string;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  // GFM task lists → TipTap task items
  doc.querySelectorAll('li').forEach(li => {
    const box = li.querySelector(':scope > input[type="checkbox"], :scope > p > input[type="checkbox"]');
    if (!box) return;
    li.setAttribute('data-type', 'taskItem');
    li.setAttribute('data-checked', box.hasAttribute('checked') ? 'true' : 'false');
    box.remove();
    li.parentElement?.setAttribute('data-type', 'taskList');
  });
  html = doc.body.innerHTML;
  // @Full Name of a member → mention chip (longest names first)
  if (snap) {
    for (const u of [...snap.users].sort((a, b) => b.name.length - a.name.length)) {
      html = html.replace(new RegExp(`(^|[\\s>(])@${escapeRe(u.name)}(?![\\w])`, 'g'),
        (_m, pre) => `${pre}<span data-type="mention" data-id="${u.id}" data-label="${u.name}">@${u.name}</span>`);
    }
  }
  return html;
}

/* ---------- editor HTML → markdown ---------- */
const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '_' });
turndown.use(gfm);
// keep typed text as typed: agents read these descriptions raw, and backslash-escaped
// brackets and underscores are noise to them
(turndown as unknown as { escape: (t: string) => string }).escape = (t: string) => t;
turndown.addRule('taskItem', {
  filter: (n: HTMLElement) => n.nodeName === 'LI' && n.getAttribute('data-type') === 'taskItem',
  replacement: (content, node) => `- [${(node as HTMLElement).getAttribute('data-checked') === 'true' ? 'x' : ' '}] ${content.trim().replace(/\n+/g, ' ')}\n`,
});
turndown.addRule('taskList', {
  filter: (n: HTMLElement) => n.nodeName === 'UL' && n.getAttribute('data-type') === 'taskList',
  replacement: (content) => `\n${content}\n`,
});
turndown.addRule('mention', {
  filter: (n: HTMLElement) => n.nodeName === 'SPAN' && n.getAttribute('data-type') === 'mention',
  replacement: (_c, node) => `@${(node as HTMLElement).getAttribute('data-label') ?? (node as HTMLElement).textContent?.replace(/^@/, '')}`,
});

export function htmlToMarkdown(html: string): string {
  if (!html || html === '<p></p>') return '';
  return turndown.turndown(html).replace(/\n{3,}/g, '\n\n').trim();
}

/* ---------- suggestion popups (mentions + slash commands) ---------- */
interface SuggestItem { id: string; label: string; hint?: string; icon?: React.ReactNode; run: (editor: Editor, range: Range) => void }
interface PopupState { open: boolean; items: SuggestItem[]; index: number; rect: DOMRect | null; editor: Editor | null; range: Range | null; title: string }
const usePopup = create<PopupState>(() => ({ open: false, items: [], index: 0, rect: null, editor: null, range: null, title: '' }));

function popupRender(title: string) {
  return () => ({
    onStart: (p: SuggestionProps<SuggestItem>) => usePopup.setState({ open: true, items: p.items, index: 0, rect: p.clientRect?.() ?? null, editor: p.editor, range: p.range, title }),
    onUpdate: (p: SuggestionProps<SuggestItem>) => usePopup.setState({ items: p.items, index: 0, rect: p.clientRect?.() ?? null, range: p.range }),
    onKeyDown: (p: SuggestionKeyDownProps) => {
      const s = usePopup.getState();
      if (!s.open || !s.items.length) return false;
      if (p.event.key === 'ArrowDown') { usePopup.setState({ index: (s.index + 1) % s.items.length }); return true; }
      if (p.event.key === 'ArrowUp') { usePopup.setState({ index: (s.index - 1 + s.items.length) % s.items.length }); return true; }
      if (p.event.key === 'Enter' || p.event.key === 'Tab') { const it = s.items[s.index]; if (it && s.editor && s.range) it.run(s.editor, s.range); usePopup.setState({ open: false }); return true; }
      if (p.event.key === 'Escape') { usePopup.setState({ open: false }); return true; }
      return false;
    },
    onExit: () => usePopup.setState({ open: false }),
  });
}

function SuggestionPopup() {
  const { open, items, index, rect, editor, range, title } = usePopup();
  if (!open || !rect || !items.length) return null;
  const top = rect.bottom + 6 + 300 > window.innerHeight ? rect.top - 6 - Math.min(300, items.length * 32 + 30) : rect.bottom + 6;
  return createPortal(
    <div className="menu suggest-pop" style={{ left: Math.min(rect.left, window.innerWidth - 270), top, width: 260 }} onMouseDown={e => e.preventDefault()}>
      <div className="menu-header"><span>{title}</span></div>
      {items.map((it, i) => (
        <button key={it.id} className={`menu-item${i === index ? ' highlighted' : ''}`}
          onMouseEnter={() => usePopup.setState({ index: i })}
          onClick={() => { if (editor && range) it.run(editor, range); usePopup.setState({ open: false }); }}>
          {it.icon && <span className="mi-icon">{it.icon}</span>}
          <span className="mi-label">{it.label}</span>
          {it.hint && <span className="mi-right"><span className="mi-hint">{it.hint}</span></span>}
        </button>
      ))}
    </div>,
    document.body,
  );
}

const mentionItems = ({ query }: { query: string }): SuggestItem[] => {
  const snap = useApp.getState().snap;
  if (!snap) return [];
  const q = query.toLowerCase();
  const people: SuggestItem[] = snap.users.filter(u => u.name.toLowerCase().includes(q)).slice(0, 6).map(u => ({
    id: `u:${u.id}`, label: u.name, hint: u.kind === 'agent' ? 'agent' : undefined, icon: <Avatar user={u} size={16} />,
    run: (editor, range) => editor.chain().focus().insertContentAt(range, [{ type: 'mention', attrs: { id: u.id, label: u.name } }, { type: 'text', text: ' ' }]).run(),
  }));
  const keyOf = (i: typeof snap.issues[number]) => `${snap.teams.find(t => t.id === i.teamId)?.key}-${i.number}`;
  const issues: SuggestItem[] = q.length < 1 ? [] : snap.issues.filter(i => i.title.toLowerCase().includes(q) || keyOf(i).toLowerCase().includes(q)).slice(0, 5).map(i => {
    const st = snap.states.find(s => s.id === i.stateId);
    return {
      id: `i:${i.id}`, label: i.title, hint: keyOf(i), icon: st ? <StateIcon type={st.type} color={st.color} size={14} /> : undefined,
      run: (editor, range) => editor.chain().focus().insertContentAt(range, `${keyOf(i)} `).run(),
    };
  });
  return [...people, ...issues];
};

const SLASH: Array<Omit<SuggestItem, 'id'> & { key: string }> = [
  { key: 'h1', label: 'Heading 1', hint: '#', run: (e, r) => e.chain().focus().deleteRange(r).setNode('heading', { level: 1 }).run() },
  { key: 'h2', label: 'Heading 2', hint: '##', run: (e, r) => e.chain().focus().deleteRange(r).setNode('heading', { level: 2 }).run() },
  { key: 'h3', label: 'Heading 3', hint: '###', run: (e, r) => e.chain().focus().deleteRange(r).setNode('heading', { level: 3 }).run() },
  { key: 'ul', label: 'Bulleted list', hint: '-', run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
  { key: 'ol', label: 'Numbered list', hint: '1.', run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
  { key: 'todo', label: 'Checklist', hint: '[]', run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run() },
  { key: 'code', label: 'Code block', hint: '```', run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run() },
  { key: 'quote', label: 'Quote', hint: '>', run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run() },
  { key: 'hr', label: 'Divider', hint: '---', run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
];

const SlashCommands = Extension.create({
  name: 'slashCommands',
  addProseMirrorPlugins() {
    return [Suggestion<SuggestItem>({
      editor: this.editor,
      char: '/',
      startOfLine: true,
      items: ({ query }) => SLASH.filter(c => c.label.toLowerCase().includes(query.toLowerCase())).map(c => ({ ...c, id: c.key })),
      command: ({ editor, range, props }) => props.run(editor, range),
      render: popupRender('Insert'),
    })];
  },
});

/* ---------- the editor ---------- */
export function RichEditor(props: {
  value: string;
  placeholder?: string;
  autoFocus?: boolean;
  /** uploads (paste / drop) attach to this issue */
  issueId?: string;
  className?: string;
  /** fires (debounced) as you type */
  onChange?: (markdown: string) => void;
  onBlur?: (markdown: string) => void;
  /** ⌘↵ */
  onSubmit?: (markdown: string) => void;
  onEscape?: () => void;
  /** clears after submit (comment composers) */
  clearOnSubmit?: boolean;
  editorRef?: React.MutableRefObject<Editor | null>;
}) {
  const changeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const lastValue = useRef(props.value);

  const upload = async (editor: Editor, files: File[], pos?: number) => {
    const issueId = propsRef.current.issueId;
    if (!issueId) return false;
    for (const f of files) {
      try {
        const { attachment } = await api.uploadFile(issueId, f);
        if (f.type.startsWith('image/')) editor.chain().focus().insertContentAt(pos ?? editor.state.selection.to, { type: 'image', attrs: { src: attachment.url, alt: attachment.title } }).run();
        else editor.chain().focus().insertContentAt(pos ?? editor.state.selection.to, `<a href="${attachment.url}">${attachment.title}</a> `).run();
      } catch (err) {
        useApp.getState().toast({ title: 'Upload failed', line: String((err as Error).message) });
      }
    }
    await useApp.getState().bootstrap();
    return true;
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noreferrer', target: '_blank' } }, heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({ placeholder: props.placeholder ?? '' }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Image.configure({ inline: false, HTMLAttributes: { class: 'md-img' } }),
      Mention.configure({
        HTMLAttributes: { class: 'mention' },
        renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
        renderHTML: ({ node }) => ['span', { 'data-type': 'mention', 'data-id': node.attrs.id, 'data-label': node.attrs.label, class: 'mention' }, `@${node.attrs.label ?? node.attrs.id}`],
        suggestion: { char: '@', items: mentionItems, render: popupRender('Mention'), command: ({ editor, range, props: p }) => (p as unknown as SuggestItem).run(editor, range) },
      }),
      SlashCommands,
    ],
    content: markdownToHtml(props.value),
    autofocus: props.autoFocus ? 'end' : false,
    editorProps: {
      attributes: { class: `rte ${props.className ?? ''}`, spellcheck: 'true' },
      handleKeyDown: (_view, e) => {
        if (usePopup.getState().open) return false;
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          const ed = editorInstance.current;
          if (ed && propsRef.current.onSubmit) {
            propsRef.current.onSubmit(htmlToMarkdown(ed.getHTML()));
            if (propsRef.current.clearOnSubmit) ed.commands.clearContent();
          }
          return true;
        }
        if (e.key === 'Escape' && propsRef.current.onEscape) { e.stopPropagation(); propsRef.current.onEscape(); return true; }
        return false;
      },
      handlePaste: (_view, e) => {
        const files = [...(e.clipboardData?.files ?? [])];
        if (!files.length || !propsRef.current.issueId || !editorInstance.current) return false;
        void upload(editorInstance.current, files);
        return true;
      },
      handleDrop: (view, e) => {
        const files = [...((e as DragEvent).dataTransfer?.files ?? [])];
        if (!files.length || !propsRef.current.issueId || !editorInstance.current) return false;
        const pos = view.posAtCoords({ left: (e as DragEvent).clientX, top: (e as DragEvent).clientY })?.pos;
        void upload(editorInstance.current, files, pos);
        return true;
      },
    },
    onUpdate: ({ editor: ed }) => {
      if (!propsRef.current.onChange) return;
      if (changeTimer.current) clearTimeout(changeTimer.current);
      changeTimer.current = setTimeout(() => {
        const md = htmlToMarkdown(ed.getHTML());
        lastValue.current = md;
        propsRef.current.onChange?.(md);
      }, 600);
    },
    onBlur: ({ editor: ed }) => {
      if (changeTimer.current) { clearTimeout(changeTimer.current); changeTimer.current = null; }
      const md = htmlToMarkdown(ed.getHTML());
      lastValue.current = md;
      propsRef.current.onBlur?.(md);
    },
  });
  const editorInstance = useRef<Editor | null>(null);
  editorInstance.current = editor;
  if (props.editorRef) props.editorRef.current = editor;

  // a value that changes underneath (another tab, an agent via the CLI) replaces the
  // content — unless you're mid-edit, which wins
  useEffect(() => {
    if (!editor || editor.isFocused) return;
    if (props.value === lastValue.current) return;
    lastValue.current = props.value;
    editor.commands.setContent(markdownToHtml(props.value), { emitUpdate: false });
  }, [props.value, editor]);

  useEffect(() => () => { if (changeTimer.current) clearTimeout(changeTimer.current); }, []);

  return (
    <>
      <EditorContent editor={editor} />
      <SuggestionPopup />
    </>
  );
}

/** quick check used by composers: is there anything worth posting? */
export function isBlank(md: string) { return !md.replace(/\s+/g, '').length; }

export function useEditorEmpty(editorRef: React.MutableRefObject<Editor | null>) {
  const [empty, setEmpty] = useState(true);
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    const update = () => setEmpty(ed.isEmpty);
    ed.on('update', update);
    update();
    return () => { ed.off('update', update); };
  });
  return empty;
}
