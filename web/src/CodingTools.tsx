// Hand an issue to a coding agent: the issue toolbar (copy link / ID / branch / prompt, plus the
// "Open in Claude Code" flyout), the shortcuts behind it, and the directory field used by project
// and Settings screens. Launching goes through the local server, which opens a terminal window.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, copyText } from './store.js';
import { api } from './api.js';
import { Menu, MenuItem, MenuSep, MenuSub, useMenu } from './ui.js';
import { IconLink, IconCopyId, IconBranch, IconHandoff, IconChevronDown, IconSpark, IconFolder, IconTools } from './icons.js';
import type { Issue } from '../../src/core/types.js';

/** /Users/me/code/app → ~/code/app */
export function tildify(path: string, home?: string): string {
  return home && (path === home || path.startsWith(home + '/')) ? '~' + path.slice(home.length) : path;
}
const basename = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p;

/** directories offered for an issue: its project's, the workspace default, then recent picks */
export function directoryChoices(issue: Issue): Array<{ path: string; hint: string }> {
  const snap = useApp.getState().snap!;
  const project = snap.projects.find(p => p.id === issue.projectId);
  const out: Array<{ path: string; hint: string }> = [];
  const add = (path: string, hint: string) => { if (path && !out.some(o => o.path === path)) out.push({ path, hint }); };
  if (project?.directory) add(project.directory, project.name);
  add(snap.workspace.agentCwd, 'Default');
  for (const d of snap.workspace.recentDirectories ?? []) add(d, 'Recent');
  return out;
}

/** plain function so the palette can use it too; components go through useHandoffActions */
export function handoffActions(issue: Issue) {
  const { toast, snap } = useApp.getState();
  const key = `${snap?.teams.find(t => t.id === issue.teamId)?.key ?? 'ISS'}-${issue.number}`;
  const copy = async (text: string, title: string, line?: React.ReactNode) => {
    if (await copyText(text)) toast({ title, line });
    else toast({ title: 'Clipboard unavailable', line: <>bring the app tab into focus and retry</> });
  };
  const copyPrompt = async () => {
    const { handoff } = await api.getHandoff(issue.id);
    await copy(handoff.prompt, `Copied prompt for ${handoff.key}`, <>branch: <b>{handoff.branchName}</b></>);
  };
  const copyBranch = async () => {
    const { handoff } = await api.getHandoff(issue.id);
    await copy(handoff.branchName, `Copied branch ${handoff.branchName}`);
  };
  const copyUrl = () => copy(`${location.origin}/#/issue/${key}`, 'Copied issue URL');
  const copyId = () => copy(key, `Copied ${key}`);

  const chooseAndOpen = async () => {
    const r = await api.pickDirectory(`Choose a directory for ${key}`);
    if (r.error) { toast({ title: 'Could not open the folder picker', line: r.error }); return; }
    if (r.directory) await openInClaude(r.directory, true);
  };
  /** no directory → the issue's own (project, else default); missing → ask for one */
  const openInClaude = async (directory?: string, saveToProject = false): Promise<void> => {
    const r = await api.openClaude(issue.id, { directory, saveToProject });
    const home = useApp.getState().snap?.workspace.homeDir;
    if ('code' in r) {
      if (r.code === 'no-directory') return chooseAndOpen();
      toast({
        title: 'Could not open Claude Code', line: r.error,
        actions: r.code === 'bad-directory' ? [{ label: 'Choose…', onClick: chooseAndOpen }] : undefined,
      });
      return;
    }
    const project = useApp.getState().snap?.projects.find(p => p.id === issue.projectId);
    toast({
      title: `Opened ${r.key} in Claude Code`,
      line: <>{tildify(r.directory, home)}{r.savedToProject && project ? <> · saved as <b>{project.name}</b>'s directory</> : null}</>,
    });
    await useApp.getState().bootstrap();
  };
  return { key, copyPrompt, copyBranch, copyUrl, copyId, openInClaude, chooseAndOpen };
}
export type HandoffActions = ReturnType<typeof handoffActions>;

export function useHandoffActions(issue: Issue): HandoffActions {
  return useMemo(() => handoffActions(issue), [issue]);
}

/** Linear's chords: ⌘⌥P prompt · ⌘. ID · ⌘⇧. branch · ⌘⇧, link. Capture phase so a focused field can't swallow them. */
function useHandoffShortcuts(actions: HandoffActions) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.isComposing) return;
      const s = useApp.getState();
      if (s.paletteOpen || s.createModal.open) return;
      const run = (fn: () => unknown) => { e.preventDefault(); e.stopPropagation(); void fn(); };
      if (e.altKey && e.code === 'KeyP') run(actions.copyPrompt);
      else if (!e.altKey && e.code === 'Period') run(e.shiftKey ? actions.copyBranch : actions.copyId);
      else if (!e.altKey && e.shiftKey && e.code === 'Comma') run(actions.copyUrl);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [actions]);
}

/** the "Open in Claude Code" flyout body — shared by the toolbar menu and row context menus */
export function OpenInClaudeItems(props: { issue: Issue; actions: HandoffActions }) {
  const home = useApp(s => s.snap?.workspace.homeDir);
  const choices = directoryChoices(props.issue);
  return (
    <>
      <div className="menu-header"><span>Claude Code</span></div>
      {choices.map(c => (
        <MenuItem key={c.path} icon={<IconFolder size={14} />}
          label={<span title={tildify(c.path, home)}>{basename(c.path)}<span className="mi-hint">{c.hint}</span></span>}
          onClick={() => void props.actions.openInClaude(c.path)} />
      ))}
      {choices.length > 0 && <MenuSep />}
      <MenuItem icon={<IconFolder size={14} />} label="Choose a directory…" onClick={() => void props.actions.chooseAndOpen()} />
    </>
  );
}

export function IssueToolbar(props: { issue: Issue }) {
  const snap = useApp(s => s.snap)!;
  const actions = useHandoffActions(props.issue);
  useHandoffShortcuts(actions);
  const menu = useMenu();
  const navigate = useNavigate();
  const dirCount = directoryChoices(props.issue).length;
  return (
    <div className="issue-toolbar">
      {snap.workspace.agentRunningIssueId === props.issue.id && (
        <span className="agent-running" title="Claude Code is working on this issue">Agent running…</span>
      )}
      <button className="tb-btn" title="Copy issue URL (⌘⇧,)" onClick={() => void actions.copyUrl()}><IconLink size={15} /></button>
      <button className="tb-btn" title="Copy issue ID (⌘.)" onClick={() => void actions.copyId()}><IconCopyId size={15} /></button>
      <button className="tb-btn" title="Copy git branch name (⌘⇧.)" onClick={() => void actions.copyBranch()}><IconBranch size={15} /></button>
      <div className={`tb-split${menu.isOpen ? ' open' : ''}`}>
        <button className="tb-btn" title="Copy as prompt (⌘⌥P)" onClick={() => void actions.copyPrompt()}><IconHandoff size={15} /></button>
        <button className="tb-btn tb-caret" title="Hand off to a coding agent" onClick={menu.open}><IconChevronDown size={12} /></button>
      </div>
      {menu.anchor && (
        <Menu anchor={menu.anchor} onClose={menu.close} width={264}>
          <MenuItem icon={<IconHandoff size={14} />} label="Copy as prompt" right={<><span className="kbd">⌘</span><span className="kbd">⌥</span><span className="kbd">P</span></>} onClick={() => void actions.copyPrompt()} />
          <MenuSub icon={<IconSpark size={14} />} label="Open in Claude Code" right={dirCount ? <span>{dirCount}</span> : undefined}>
            <OpenInClaudeItems issue={props.issue} actions={actions} />
          </MenuSub>
          <MenuSep />
          <MenuItem icon={<IconTools size={14} />} label="Configure coding tools…" onClick={() => navigate('/settings/handoff')} />
        </Menu>
      )}
    </div>
  );
}

/** path input + native "Choose…" picker, with a quiet warning when the path doesn't exist */
export function DirectoryField(props: { value: string; onSave: (dir: string) => void | Promise<void>; placeholder?: string; pickPrompt?: string }) {
  const [draft, setDraft] = useState(props.value);
  const cancelled = useRef(false);
  const [missing, setMissing] = useState(false);
  useEffect(() => { setDraft(props.value); }, [props.value]);
  useEffect(() => {
    let live = true;
    if (!props.value) { setMissing(false); return; }
    void api.checkDirectory(props.value).then(r => { if (live) setMissing(!r.exists); });
    return () => { live = false; };
  }, [props.value]);
  const commit = (dir: string) => { if (dir.trim() !== props.value) void props.onSave(dir.trim()); };
  return (
    <div className="dir-field">
      <div className="dir-field-row">
        <input className="text-input" value={draft} placeholder={props.placeholder ?? '/path/to/checkout'} spellCheck={false}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => { if (cancelled.current) cancelled.current = false; else commit(draft); }}
          onKeyDown={e => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') { e.stopPropagation(); cancelled.current = true; setDraft(props.value); (e.target as HTMLInputElement).blur(); }
          }} />
        <button className="btn" onClick={async () => {
          const r = await api.pickDirectory(props.pickPrompt);
          if (r.error) useApp.getState().toast({ title: 'Could not open the folder picker', line: r.error });
          else if (r.directory) { setDraft(r.directory); commit(r.directory); }
        }}>Choose…</button>
      </div>
      {missing && <div className="dir-field-warn">This directory doesn't exist on this machine.</div>}
    </div>
  );
}

/** project rail row: where Claude Code works for this project's issues */
export function ProjectDirectoryRow(props: { project: { id: string; name: string; directory: string } }) {
  const ws = useApp(s => s.snap)!.workspace;
  const toast = useApp(s => s.toast);
  const menu = useMenu();
  const navigate = useNavigate();
  const { project } = props;
  const save = async (directory: string) => {
    await api.updateProject(project.id, { directory });
    await useApp.getState().bootstrap();
    toast({ title: directory ? `${project.name} directory saved` : `${project.name} directory cleared`, line: directory ? tildify(directory, ws.homeDir) : undefined });
  };
  const choose = async () => {
    const r = await api.pickDirectory(`Choose the directory for ${project.name}`);
    if (r.error) toast({ title: 'Could not open the folder picker', line: r.error });
    else if (r.directory) await save(r.directory);
  };
  const shown = project.directory || ws.agentCwd;
  return (
    <>
      <button className="rail-kv" onClick={project.directory ? menu.open : () => void choose()}
        title={shown ? tildify(shown, ws.homeDir) + (project.directory ? '' : ' (workspace default)') : 'Where Claude Code works on this project'}>
        <span className="rail-kv-label">Directory</span>
        <span className={`rail-kv-value ${project.directory ? '' : 'dim'}`}>
          <IconFolder size={13} />
          <span className="rail-kv-text">{project.directory ? basename(project.directory) : ws.agentCwd ? `Default (${basename(ws.agentCwd)})` : 'Set directory'}</span>
        </span>
      </button>
      {menu.anchor && (
        <Menu anchor={menu.anchor} onClose={menu.close} width={240}>
          <div className="menu-header"><span className="dir-menu-path">{tildify(project.directory, ws.homeDir)}</span></div>
          <MenuItem icon={<IconFolder size={14} />} label="Choose another directory…" onClick={() => void choose()} />
          <MenuItem label="Use the workspace default" onClick={() => void save('')} />
          <MenuSep />
          <MenuItem icon={<IconTools size={14} />} label="Configure coding tools…" onClick={() => navigate('/settings/handoff')} />
        </Menu>
      )}
    </>
  );
}
