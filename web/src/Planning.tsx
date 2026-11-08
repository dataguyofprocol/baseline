import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp, shortDate } from './store.js';
import { api } from './api.js';
import { TopBar } from './AppShell.js';
import { Menu, MenuItem, useMenu } from './ui.js';
import { CalendarGrid, StateIcon } from './pickers.js';
import { Illustration } from './illustrations.js';
import { useViewPrefs, DEFAULT_VIEW_OPTIONS, type ViewOptions } from './IssueViews.js';
import { IssueListBody, ListToolbar } from './Views.js';
import { IconPlus, IconTrash, IconCalendar, IconRelease } from './icons.js';
import type { ReleaseStage } from '../../src/core/types.js';

const refresh = () => useApp.getState().bootstrap();
export const RELEASE_STAGE: Array<[ReleaseStage, string, string]> = [['planned', 'Planned', '#8a8f98'], ['started', 'In progress', '#f2c94c'], ['released', 'Released', '#5e6ad2'], ['canceled', 'Canceled', '#95a2b3']];

export function ReleaseStageIcon({ stage, size = 14 }: { stage: ReleaseStage; size?: number }) {
  const c = RELEASE_STAGE.find(x => x[0] === stage)?.[2];
  return <span style={{ display: 'inline-flex', color: c }}><StateIcon type={stage === 'planned' ? 'unstarted' : stage === 'started' ? 'started' : stage === 'released' ? 'completed' : 'canceled'} color={c} size={size} /></span>;
}

/* ================= Releases ================= */
export function ReleasesPage() {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const create = async () => { if (!name.trim()) return; const { release } = await api.createRelease({ name: name.trim() }); await refresh(); setName(''); navigate(`/releases/${release.id}`); };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <TopBar crumbs={[{ label: 'Releases' }]} />
      <div className="subnav"><div className="rel-new"><IconRelease size={14} /><input placeholder="New release, e.g. v1.5.0, then Enter to create" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void create(); }} /></div></div>
      <div className="content">
        {!snap.releases.length ? (
          <div className="empty-state"><Illustration name="releases" /><div className="empty-title">Releases</div><div className="empty-desc">Track which issues ship in each release. Create one above, then add issues from the issue's Release property.</div></div>
        ) : RELEASE_STAGE.map(([stage, label]) => {
          const list = snap.releases.filter(r => r.stage === stage);
          if (!list.length) return null;
          return (
            <div key={stage}>
              <div className="group-header"><ReleaseStageIcon stage={stage} /><span>{label}</span><span className="count">{list.length}</span><span className="gh-rule" /></div>
              {list.map(r => { const issues = snap.issues.filter(i => i.releaseId === r.id); const done = issues.filter(i => ['completed', 'canceled'].includes(snap.states.find(s => s.id === i.stateId)?.type ?? '')).length; return (
                <div key={r.id} className="wt-row wt-rel" onClick={() => navigate(`/releases/${r.id}`)}>
                  <span className="wt-name"><IconRelease size={14} /><span className="mono">{r.name}</span>{r.description && <span className="dim">{r.description.replace(/\s+/g, ' ').slice(0, 60)}</span>}</span>
                  <span className="mono">{r.releasedAt ? `Released ${shortDate(r.releasedAt)}` : r.targetDate ? shortDate(r.targetDate.slice(0, 10) + 'T12:00') : <span className="dim">No date</span>}</span>
                  <span className="mono">{done}/{issues.length} issues</span>
                </div>
              ); })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ReleasePage() {
  const { releaseId = '' } = useParams();
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const r = snap.releases.find(x => x.id === releaseId);
  const [opts, patchOpts, reset] = useViewPrefs<ViewOptions>(`baseline:view:release:${releaseId}`, { ...DEFAULT_VIEW_OPTIONS, filters: {} });
  const display = useMenu();
  const menu = useMenu();
  const [kind, setKind] = useState<'stage' | 'target' | 'add' | null>(null);
  const [q, setQ] = useState('');
  const issues = useMemo(() => snap.issues.filter(i => i.releaseId === releaseId), [snap.issues, releaseId]);
  if (!r) return <div className="empty-state"><div className="empty-title">Release not found</div></div>;
  const patch = async (b: Record<string, unknown>) => { await api.updateRelease(r.id, b); await refresh(); };
  const open = (k: typeof kind) => (e: React.MouseEvent) => { setKind(k); setQ(''); menu.open(e); };
  const key = (i: (typeof snap.issues)[number]) => `${snap.teams.find(t => t.id === i.teamId)?.key}-${i.number}`;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <TopBar crumbs={[{ label: 'Releases', to: '/releases', muted: true }, { label: r.name, icon: <IconRelease size={14} /> }]}
        more={<MenuItem icon={<IconTrash size={14} />} danger label="Delete release" onClick={async () => { await api.deleteRelease(r.id); await refresh(); navigate('/releases'); }} />} />
      <div className="rel-head">
        <button className="prop-chip ghost" data-rprop="stage" onClick={open('stage')}><ReleaseStageIcon stage={r.stage} size={13} />{RELEASE_STAGE.find(x => x[0] === r.stage)?.[1]}</button>
        <button className="prop-chip ghost" onClick={open('target')}><IconCalendar size={13} />{r.targetDate ? shortDate(r.targetDate.slice(0, 10) + 'T12:00') : 'Target date'}</button>
        {r.releasedAt && <span className="prop-chip ghost static">Released {shortDate(r.releasedAt)}</span>}
        <button className="prop-chip ghost" onClick={open('add')}><IconPlus size={13} />Add issues</button>
        <span style={{ flex: 1 }} />
        <ListToolbar opts={opts} onDisplay={display.open} />
      </div>
      <IssueListBody issues={issues} opts={opts} patch={patchOpts} reset={reset} multiTeam displayAnchor={display.anchor} closeDisplay={display.close}
        emptyTitle="No issues in this release yet" emptyDesc="Add issues here, or set Release on an issue." emptyHideCreate />
      {menu.anchor && kind && (
        <Menu anchor={menu.anchor} onClose={menu.close} width={kind === 'add' ? 320 : 240}>
          {kind === 'stage' && RELEASE_STAGE.map(([v, l]) => <MenuItem key={v} icon={<ReleaseStageIcon stage={v} />} label={l} selected={r.stage === v} onClick={() => void patch({ stage: v })} />)}
          {kind === 'target' && <><div className="menu-header"><span>Target date</span></div><CalendarGrid selected={r.targetDate?.slice(0, 10)} onPick={async iso => { await patch({ targetDate: iso }); menu.close(); }} /></>}
          {kind === 'add' && <>
            <div className="menu-input menu-filter" onClick={e => e.stopPropagation()}><input autoFocus placeholder="Search issues…" value={q} onChange={e => setQ(e.target.value)} /></div>
            {snap.issues.filter(i => i.releaseId !== r.id && `${key(i)} ${i.title}`.toLowerCase().includes(q.toLowerCase())).slice(0, 30).map(i => (
              <button key={i.id} className="menu-item" onClick={async e => { e.stopPropagation(); await api.updateIssue(i.id, { releaseId: r.id }); await refresh(); }}>
                <span className="mi-label"><span className="mono dim">{key(i)}</span> {i.title}</span>
              </button>
            ))}
          </>}
        </Menu>
      )}
    </div>
  );
}
