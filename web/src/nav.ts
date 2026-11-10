import { useApp, visibleList, useCursor, useSelection } from './store.js';
import type { Issue } from '../../src/core/types.js';

export interface Origin { label: string; to: string }

let lastList: Origin | null = null;
let navIds: string[] = [];
let navOrigin: Origin | null = null;
let navRoute = '';

export function labelForPath(path: string): string | null {
  const snap = useApp.getState().snap;
  if (!snap) return null;
  if (path === '/inbox') return 'Inbox';
  if (path === '/my-issues') return 'My issues';
  if (path === '/search') return 'Search';
  if (path === '/trash') return 'Trash';
  let m = /^\/views\/([^/]+)$/.exec(path);
  if (m) return snap.views.find(v => v.id === m![1])?.name ?? 'View';
  m = /^\/projects\/([^/]+)/.exec(path);
  if (m) return snap.projects.find(p => p.id === m![1])?.name ?? 'Project';
  m = /^\/team\/([^/]+)\/cycles\/([^/]+)$/.exec(path);
  if (m) { const c = snap.cycles.find(x => x.id === m![2]); return c ? (c.name || `Cycle ${c.number}`) : 'Cycle'; }
  m = /^\/team\/([^/]+)(?:\/([^/]+))?$/.exec(path);
  if (m) {
    const t = snap.teams.find(x => x.key.toLowerCase() === m![1].toLowerCase());
    const tab = m[2] ?? 'all';
    const sub = ({ all: 'All issues', active: 'Active', backlog: 'Backlog', triage: 'Triage', archive: 'Archive', cycles: 'Cycles' } as Record<string, string>)[tab];
    return t ? (sub && tab !== 'all' ? `${t.name} · ${sub}` : t.name) : null;
  }
  return null;
}

export function noteRoute(path: string) {
  if (path.startsWith('/issue/') || path.startsWith('/settings')) return;
  const label = labelForPath(path);
  if (label) lastList = { label, to: path };
}

export function navFor(issueId: string): { ids: string[]; origin: Origin | null } {
  if (!navIds.includes(issueId) || (visibleList.route !== navRoute && visibleList.issues.some(i => i.id === issueId))) {
    const ids = visibleList.issues.map(i => i.id);
    if (ids.includes(issueId)) { navIds = ids; navOrigin = lastList; navRoute = visibleList.route; }
    else { navIds = []; navOrigin = null; navRoute = ''; }
  }
  return { ids: navIds, origin: navOrigin };
}

export function exitPathFor(issue: Issue): string {
  if (navOrigin) return navOrigin.to;
  if (lastList) return lastList.to;
  const team = useApp.getState().snap?.teams.find(t => t.id === issue.teamId);
  return team ? `/team/${team.key}/all` : '/inbox';
}

export function neighbour(issueId: string, delta: 1 | -1): string | null {
  const i = navIds.indexOf(issueId);
  if (i < 0) return null;
  return navIds[i + delta] ?? null;
}

export function shortcutTargets(): Issue[] {
  const s = useApp.getState();
  const snap = s.snap;
  if (!snap) return [];
  if (s.peekIssueId) { const i = snap.issues.find(x => x.id === s.peekIssueId); return i ? [i] : []; }
  const page = pageIssue();
  if (page) return [page];
  const sel = useSelection.getState().ids;
  if (sel.length) return snap.issues.filter(i => sel.includes(i.id));
  const c = listIssueAtCursor();
  return c ? [c] : [];
}

export function pageIssue(): Issue | null {
  const m = /^#\/issue\/([^/?]+)/.exec(location.hash);
  if (!m) return null;
  const snap = useApp.getState().snap!;
  const km = /^(.+)-(\d+)$/.exec(decodeURIComponent(m[1]));
  const team = snap.teams.find(t => t.key.toLowerCase() === (km?.[1] ?? '').toLowerCase());
  return snap.issues.find(i => i.teamId === team?.id && i.number === Number(km?.[2])) ?? null;
}


export function listIssueAtCursor(): Issue | null {
  if (visibleList.route && visibleList.route !== location.hash.split('?')[0]) return null;
  const { index } = useCursor.getState();
  if (index < 0 || index >= visibleList.issues.length) return null;
  return visibleList.issues[index] ?? null;
}
