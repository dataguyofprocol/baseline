import { useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { useApp } from './store.js';
import { api } from './api.js';
import { Menu, MenuItem, MenuSep, useMenu, useCanConfigure, exclusive } from './ui.js';
import { Markdown } from './Markdown.js';
import { RichEditor, htmlToMarkdown, isBlank } from './RichEditor.js';
import { IconEdit, IconMore, IconTrash } from './icons.js';

/* The text of a posted project or initiative update. Whoever posted it (or an admin) can fix it
   or take it down from the "…" in its corner; before this a typo in an update was permanent. */
export function UpdateBody(props: { kind: 'project' | 'initiative'; id: string; userId: string; body: string; className?: string }) {
  const me = useApp(s => s.snap?.currentUser.id);
  const admin = useCanConfigure();
  const toast = useApp(s => s.toast);
  const menu = useMenu();
  const [editing, setEditing] = useState(false);
  const editorRef = useRef<Editor | null>(null);
  const mine = props.userId === me || admin;

  const save = (md: string) => exclusive(`update-edit-${props.id}`, async () => {
    if (isBlank(md)) return;
    if (md !== props.body) {
      await (props.kind === 'project' ? api.editProjectUpdate(props.id, md) : api.editInitiativeUpdate(props.id, md));
      await useApp.getState().bootstrap();
      toast({ title: 'Update edited' });
    }
    setEditing(false);
  });
  const remove = async () => {
    await (props.kind === 'project' ? api.deleteProjectUpdate(props.id) : api.deleteInitiativeUpdate(props.id));
    await useApp.getState().bootstrap();
    toast({ title: 'Update deleted' });
  };

  if (editing) {
    return (
      <div className={`posted-update editing ${props.className ?? ''}`}>
        <RichEditor value={props.body} autoFocus editorRef={editorRef} onSubmit={md => void save(md)} onEscape={() => setEditing(false)} />
        <div className="cbox-foot">
          <span className="cbox-hint">⌘↵ to save · Esc to cancel</span>
          <button className="btn sm" onClick={() => setEditing(false)}>Cancel</button>
          <button className="btn primary sm" onClick={() => void save(editorRef.current ? htmlToMarkdown(editorRef.current.getHTML()) : props.body)}>Save</button>
        </div>
      </div>
    );
  }
  return (
    <div className={`posted-update ${props.className ?? ''}`}>
      <Markdown text={props.body} />
      {mine && <button className="icon-btn posted-update-more" title="Edit or delete this update" aria-label="Update actions" onClick={menu.open}><IconMore size={14} /></button>}
      {menu.anchor && (
        <Menu anchor={menu.anchor} onClose={menu.close} width={200}>
          <MenuItem icon={<IconEdit size={14} />} label="Edit update" onClick={() => { menu.close(); setEditing(true); }} />
          <MenuSep />
          <MenuItem icon={<IconTrash size={14} />} danger label="Delete update" confirm="Delete update?" onClick={() => void remove()} />
        </Menu>
      )}
    </div>
  );
}
