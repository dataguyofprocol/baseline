// Hand an issue to a coding agent: the issue toolbar (copy link / ID / branch / prompt, plus the
// "Open in Claude Code" flyout), the shortcuts behind it, and the location pickers. Every task works
// in exactly one location — a registered directory, usually a git repo — and nothing is guessed:
// an issue with no location asks for one. Launching goes through the local server.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, copyText } from './store.js';
import { api } from './api.js';
import { Menu, MenuItem, MenuSep, MenuSub, useMenu } from './ui.js';
import { IconLink, IconCopyId, IconBranch, IconHandoff, IconChevronDown, IconSpark, IconFolder, IconTools, IconPlus, IconCheck, IconClose } from './icons.js';
import type { Issue, Location } from '../../src/core/types.js';

/** /Users/me/code/app → ~/code/app */
export function tildify(path: string, home?: string): string {
  return home && (path === home || path.startsWith(home + '/')) ? '~' + path.slice(home.length) : path;
}

/** an issue's location options: the pinned one, its project's, then every other registered one */
export function locationChoices(issue: Issue): { pinned?: Location; project: Location[]; projectName?: string; others: Location[] } {
  const snap = useApp.getState().snap!;
  const pinned = snap.locations.find(l => l.id === issue.locationId);
  const project = snap.projects.find(p => p.id === issue.projectId);
  const projectLocs = (project?.locationIds ?? []).map(id => snap.locations.find(l => l.id === id)).filter((l): l is Location => !!l && l.id !== pinned?.id);
  const others = snap.locations.filter(l => l.id !== pinned?.id && !projectLocs.includes(l));
  return { pinned, project: projectLocs, projectName: project?.name, others };
}

/** folder picker → registered locations (idempotent by path); `multiple` lets you ⌘-click several */
export async function pickLocations(prompt: string, multiple = false): Promise<Location[]> {
  const { toast } = useApp.getState();
  const r = await api.pickDirectory(prompt, multiple);
  if (r.error) { toast({ title: 'Could not open the folder picker', line: r.error }); return []; }
  const out: Location[] = [];
  for (const dir of r.directories ?? []) {
    const c = await api.createLocation(dir);
    if (c.error !== undefined) toast({ title: 'Could not add the location', line: c.error });
    else out.push(c.location);
  }
  return out;
}
export async function pickLocation(prompt: string): Promise<Location | null> {
  return (await pickLocations(prompt))[0] ?? null;
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
  const copyTitle = () => copy(issue.title, 'Copied title');
  const copyMarkdown = () => {
    const s2 = useApp.getState().snap;
    const st = s2?.states.find(x => x.id === issue.stateId)?.name ?? '';
    const body = `# ${key} ${issue.title}\n\nStatus: ${st}\n\n${issue.description}`.trim();
    return copy(body, `Copied ${key} as Markdown`);
  };

  const setLocation = async (locationId: string | null) => {
    await api.updateIssue(issue.id, { locationId });
    await useApp.getState().bootstrap();
  };
  const chooseAndPin = async () => {
    const loc = await pickLocation(`Choose where ${key} happens`);
    if (loc) { await setLocation(loc.id); toast({ title: `${key} → ${loc.name}`, line: tildify(loc.path, useApp.getState().snap?.workspace.homeDir) }); }
  };
  const chooseAndOpen = async () => {
    const loc = await pickLocation(`Choose where ${key} happens`);
    if (loc) await openInClaude(loc.id);
  };
  /** the issue's own location, or the one given (which then becomes the issue's) — never a guess */
  const openInClaude = async (locationId?: string): Promise<void> => {
    const r = await api.openClaude(issue.id, { locationId });
    const home = useApp.getState().snap?.workspace.homeDir;
    if ('code' in r) {
      if (r.code === 'no-location') return chooseAndOpen();
      toast({
        title: 'Could not open Claude Code', line: r.error,
        actions: r.code === 'bad-directory' ? [{ label: 'Choose…', onClick: chooseAndOpen }] : undefined,
      });
      return;
    }
    toast({
      title: `Opened ${r.key} in Claude Code`,
      line: <><b>{r.location.name}</b> · {tildify(r.directory, home)}{r.pinned ? <> · now {r.key}'s location</> : null}</>,
    });
    await useApp.getState().bootstrap();
  };
  return { key, copyPrompt, copyBranch, copyUrl, copyId, copyTitle, copyMarkdown, openInClaude, chooseAndOpen, setLocation, chooseAndPin };
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
      else if (!e.altKey && e.shiftKey && e.code === 'Quote') run(actions.copyTitle);
      else if (e.altKey && e.code === 'KeyC') run(actions.copyMarkdown);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [actions]);
}

function LocationItem(props: { loc: Location; selected?: boolean; onPick: () => void }) {
  const home = useApp(s => s.snap?.workspace.homeDir);
  return (
    <MenuItem icon={<IconFolder size={14} />} selected={props.selected}
      label={<span title={tildify(props.loc.path, home)}>{props.loc.name}<span className="mi-hint">{tildify(props.loc.path, home)}</span></span>}
      onClick={props.onPick} />
  );
}

/** the "Open in Claude Code" flyout body — shared by the toolbar menu and row context menus */
export function OpenInClaudeItems(props: { issue: Issue; actions: HandoffActions }) {
  const c = locationChoices(props.issue);
  return (
    <>
      <div className="menu-header"><span>Claude Code</span></div>
      {c.pinned && <LocationItem loc={c.pinned} selected onPick={() => void props.actions.openInClaude(c.pinned!.id)} />}
      {c.project.length > 0 && <div className="menu-header"><span>{c.projectName}</span></div>}
      {c.project.map(l => <LocationItem key={l.id} loc={l} onPick={() => void props.actions.openInClaude(l.id)} />)}
      {c.others.length > 0 && <div className="menu-header"><span>{c.pinned || c.project.length ? 'Other locations' : 'Locations'}</span></div>}
      {c.others.map(l => <LocationItem key={l.id} loc={l} onPick={() => void props.actions.openInClaude(l.id)} />)}
      <MenuSep />
      <MenuItem icon={<IconPlus size={14} />} label="Choose a folder…" onClick={() => void props.actions.chooseAndOpen()} />
    </>
  );
}

export function IssueToolbar(props: { issue: Issue }) {
  const actions = useHandoffActions(props.issue);
  useHandoffShortcuts(actions);
  const menu = useMenu();
  const navigate = useNavigate();
  const pinned = useApp(s => s.snap?.locations.find(l => l.id === props.issue.locationId));
  return (
    <div className="issue-toolbar">
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
          <MenuSub icon={<IconSpark size={14} />} label="Open in Claude Code" right={pinned ? <span className="mi-loc">{pinned.name}</span> : undefined}>
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

/** issue rail row + picker: the one place this task happens */
export function IssueLocationRow(props: { issue: Issue }) {
  const snap = useApp(s => s.snap)!;
  const menu = useMenu();
  const navigate = useNavigate();
  const actions = useHandoffActions(props.issue);
  const loc = snap.locations.find(l => l.id === props.issue.locationId);
  // every open task should say where it happens — not just the ones handed to Claude Code
  const stateType = snap.states.find(s => s.id === props.issue.stateId)?.type;
  const needs = !loc && stateType !== 'completed' && stateType !== 'canceled';
  const c = locationChoices(props.issue);
  return (
    <>
      <button className={`prop-line ${loc ? '' : needs ? 'warn' : 'dim'}`} onClick={menu.open}
        title={loc ? tildify(loc.path, snap.workspace.homeDir) : 'The local folder this task happens in — Open in Claude Code starts there'}>
        <IconFolder size={14} />
        <span className="prop-line-label">{loc ? loc.name : needs ? 'Needs a location' : 'No location'}</span>
      </button>
      {menu.anchor && (
        <Menu anchor={menu.anchor} onClose={menu.close} width={260}>
          <div className="menu-header"><span>Set location…</span></div>
          {c.pinned && <LocationItem loc={c.pinned} selected onPick={() => {}} />}
          {c.project.length > 0 && <div className="menu-header"><span>{c.projectName}</span></div>}
          {c.project.map(l => <LocationItem key={l.id} loc={l} onPick={() => void actions.setLocation(l.id)} />)}
          {c.others.length > 0 && <div className="menu-header"><span>{c.pinned || c.project.length ? 'Other locations' : 'Locations'}</span></div>}
          {c.others.map(l => <LocationItem key={l.id} loc={l} onPick={() => void actions.setLocation(l.id)} />)}
          <MenuSep />
          <MenuItem icon={<IconPlus size={14} />} label="Add a folder…" onClick={() => void actions.chooseAndPin()} />
          {loc && <MenuItem icon={<IconClose size={13} />} label="No location" onClick={() => void actions.setLocation(null)} />}
          <MenuItem icon={<IconTools size={14} />} label="Manage locations…" onClick={() => navigate('/settings/handoff')} />
        </Menu>
      )}
    </>
  );
}

/** project rail row: the locations this project's work happens in (a location can serve several projects) */
export function ProjectLocationsRow(props: { project: { id: string; name: string; locationIds: string[] } }) {
  const snap = useApp(s => s.snap)!;
  const toast = useApp(s => s.toast);
  const menu = useMenu();
  const navigate = useNavigate();
  const { project } = props;
  const linked = project.locationIds.map(id => snap.locations.find(l => l.id === id)).filter((l): l is Location => !!l);
  // the menu stays open for several toggles, so each one builds on the last — not on props a refresh hasn't caught up with
  const ids = useRef(project.locationIds);
  useEffect(() => { ids.current = project.locationIds; }, [project.locationIds]);
  const save = async (next: string[]) => { ids.current = next; await api.setProjectLocations(project.id, next); await useApp.getState().bootstrap(); };
  const toggle = (id: string) => void save(ids.current.includes(id) ? ids.current.filter(x => x !== id) : [...ids.current, id]);
  const add = async () => {
    const locs = await pickLocations(`Add folders to ${project.name} (⌘-click to pick several)`, true);
    if (!locs.length) return;
    await save([...ids.current.filter(x => !locs.some(l => l.id === x)), ...locs.map(l => l.id)]);
    toast({ title: locs.length === 1 ? `${locs[0]!.name} added to ${project.name}` : `${locs.length} locations added to ${project.name}`, line: locs.length > 1 ? locs.map(l => l.name).join(', ') : undefined });
  };
  return (
    <>
      <button className="rail-kv" onClick={menu.open} title={linked.map(l => tildify(l.path, snap.workspace.homeDir)).join('\n') || 'Where this project\'s work happens'}>
        <span className="rail-kv-label">Locations</span>
        <span className={`rail-kv-value ${linked.length ? '' : 'dim'}`}>
          <IconFolder size={13} />
          <span className="rail-kv-text">{linked.length ? linked.map(l => l.name).join(', ') : 'Add location'}</span>
        </span>
      </button>
      {menu.anchor && (
        <Menu anchor={menu.anchor} onClose={menu.close} width={260}>
          <div className="menu-header"><span>Locations for {project.name}</span></div>
          {/* raw rows so toggling several keeps the menu open */}
          {snap.locations.map(l => (
            <button key={l.id} className="menu-item" onClick={() => toggle(l.id)}>
              <span className="mi-icon"><IconFolder size={14} /></span>
              <span className="mi-label">{l.name}<span className="mi-hint">{tildify(l.path, snap.workspace.homeDir)}</span></span>
              <span className="mi-right">{ids.current.includes(l.id) && <IconCheck size={13} />}</span>
            </button>
          ))}
          {snap.locations.length > 0 && <MenuSep />}
          {/* a raw row: the menu stays open, so the new folders show up ticked and you can keep going */}
          <button className="menu-item" onClick={() => void add()}>
            <span className="mi-icon"><IconPlus size={14} /></span><span className="mi-label">Add folders…</span>
          </button>
          <MenuItem icon={<IconTools size={14} />} label="Manage locations…" onClick={() => navigate('/settings/handoff')} />
        </Menu>
      )}
    </>
  );
}

/** Settings: every registered location — rename, see where it's used, remove */
export function LocationsSettings() {
  const snap = useApp(s => s.snap)!;
  const toast = useApp(s => s.toast);
  const home = snap.workspace.homeDir;
  const [missing, setMissing] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let live = true;
    void Promise.all(snap.locations.map(async l => [l.id, !(await api.checkDirectory(l.path)).exists] as const))
      .then(rows => { if (live) setMissing(Object.fromEntries(rows)); });
    return () => { live = false; };
  }, [snap.locations]);
  const add = async (path?: string) => {
    const locs = path
      ? await api.createLocation(path).then(r => r.error !== undefined ? (toast({ title: 'Could not add the location', line: r.error }), []) : [r.location])
      : await pickLocations('Add locations (⌘-click to pick several)', true);
    if (!locs.length) return;
    await useApp.getState().bootstrap();
    toast({ title: locs.length === 1 ? `Added ${locs[0]!.name}` : `Added ${locs.length} locations`, line: locs.length === 1 ? tildify(locs[0]!.path, home) : locs.map(l => l.name).join(', ') });
  };
  return (
    <div className="card settings-block">
      <div className="loc-head">
        <div>
          <div className="field-label">Locations</div>
          <div className="field-help">Folders coding agents work in — usually git repos. Link them to projects on the project page; each issue picks one.</div>
        </div>
        <button className="btn" onClick={() => void add()}><IconPlus size={12} /> Add folders…</button>
      </div>
      {snap.locations.length === 0 && <div className="field-help" style={{ padding: '10px 0 2px' }}>No locations yet.</div>}
      {snap.locations.map(l => {
        const projects = snap.projects.filter(p => p.locationIds.includes(l.id));
        const issues = snap.issues.filter(i => i.locationId === l.id && !i.deletedAt && !i.archivedAt).length;
        return (
          <div key={l.id} className="loc-row">
            <IconFolder size={14} />
            <div className="loc-main">
              <LocationName loc={l} />
              <code className="loc-path">{tildify(l.path, home)}</code>
              {missing[l.id] && <span className="dir-field-warn">Missing on this machine</span>}
            </div>
            <div className="loc-uses">
              {projects.map(p => <span key={p.id} className="loc-chip"><span className="fav-emoji">{p.icon}</span>{p.name}</span>)}
              {issues > 0 && <span className="loc-count">{issues} issue{issues === 1 ? '' : 's'}</span>}
            </div>
            <button className="icon-btn" title={issues ? `Remove — ${issues} issue${issues === 1 ? '' : 's'} will need a new location` : 'Remove location'}
              onClick={async () => { await api.deleteLocation(l.id); await useApp.getState().bootstrap(); toast({ title: `Removed ${l.name}` }); }}>
              <IconClose size={12} />
            </button>
          </div>
        );
      })}
      <div className="loc-add-path">
        <DirectoryField value="" placeholder="…or paste a path, e.g. ~/code/my-repo" pickPrompt="Add a location" onSave={dir => { if (dir) void add(dir); }} />
      </div>
    </div>
  );
}

function LocationName(props: { loc: Location }) {
  const [draft, setDraft] = useState(props.loc.name);
  useEffect(() => { setDraft(props.loc.name); }, [props.loc.name]);
  const save = async () => {
    const n = draft.trim();
    if (!n || n === props.loc.name) { setDraft(props.loc.name); return; }
    const r = await api.renameLocation(props.loc.id, n);
    if (r.error !== undefined) { useApp.getState().toast({ title: 'Could not rename', line: r.error }); setDraft(props.loc.name); return; }
    await useApp.getState().bootstrap();
  };
  return (
    <input className="loc-name" value={draft} spellCheck={false} onChange={e => setDraft(e.target.value)} onBlur={() => void save()}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { e.stopPropagation(); setDraft(props.loc.name); } }} />
  );
}
