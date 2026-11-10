import { useEffect, useState, type ReactNode } from 'react';
import { reducedMotion } from './motion.js';
import { Avatar } from './pickers.js';
import { StatusDone, StatusStarted, StatusTodo, IconAgent, IconBranch, IconPr } from './icons.js';

/* Small looping mocks of each setup item's payoff, drawn with the app's own glyphs. Each one is a
   step machine: CSS transitions carry the change between steps, and under reduced motion the
   machine parks on its last step, so the mock is a still of the outcome. */

/** the current step of a loop of `steps`, advancing every `ms` */
function useCycle(steps: number, ms: number) {
  const [still] = useState(reducedMotion);
  const [step, setStep] = useState(still ? steps - 1 : 0);
  useEffect(() => {
    if (still) return;
    const t = setInterval(() => setStep(s => (s + 1) % steps), ms);
    return () => clearInterval(t);
  }, [steps, ms, still]);
  return step;
}

/** `text` typed out while `on`, empty again once it turns off */
function useTyped(text: string, on: boolean, perChar = 34) {
  const [still] = useState(reducedMotion);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!on) { setN(0); return; }
    if (still) return;
    const t = setInterval(() => setN(c => (c >= text.length ? c : c + 1)), perChar);
    return () => clearInterval(t);
  }, [on, text, perChar, still]);
  if (still) return on ? text : '';
  return text.slice(0, n);
}

type Person = { name: string; initials: string; color: string; avatarUrl?: string | null };

function Stage({ hue, children, className }: { hue: string; children: ReactNode; className?: string }) {
  return <div className={`vg${className ? ` ${className}` : ''}`} style={{ ['--hue' as string]: hue }} aria-hidden="true">{children}</div>;
}

type Status = 'todo' | 'progress' | 'review' | 'done';
function StatusGlyph({ status }: { status: Status }) {
  // keyed so each change pops in instead of swapping silently
  return (
    <span key={status} className="vg-status">
      {status === 'todo' && <StatusTodo size={14} style={{ color: 'var(--status-todo)' }} />}
      {status === 'progress' && <StatusStarted size={14} style={{ color: 'var(--status-started)' }} />}
      {status === 'review' && <StatusStarted size={14} style={{ color: 'var(--green)' }} />}
      {status === 'done' && <StatusDone size={14} morph style={{ color: 'var(--status-completed)' }} />}
    </span>
  );
}

/* ================= agent ================= */
export function AgentDemo({ issueKey, me }: { issueKey: string; me: Person }) {
  const step = useCycle(6, 1250);
  const status: Status = step === 0 ? 'todo' : step >= 4 ? 'review' : 'progress';
  const call = ['Start ' + issueKey, 'start_issue', 'post_progress', 'post_progress', 'finish_issue', 'finish_issue'][step];
  const fullNote = 'Found the loop in the auth callback. Adding a test, then the fix.';
  const note = useTyped(fullNote, step >= 2);
  const branch = `${me.name.split(/\s+/)[0].toLowerCase() || 'you'}/${issueKey.toLowerCase()}-fix-login-redirect`;
  return (
    <Stage hue="var(--ob-indigo)" className="vg-agent">
      <div className="vg-call">
        <span className="vg-call-glyph"><IconAgent size={12} /></span>
        <span key={call} className={`vg-call-text${step === 0 ? ' prompt' : ''}`}>{call}</span>
      </div>
      <div className="vg-card">
        <div className="vg-row">
          <StatusGlyph status={status} />
          <span className="vg-key">{issueKey}</span>
          <span className="vg-title">Fix login redirect loop</span>
          <span className={`vg-fade${step >= 1 ? ' on' : ''}`}><Avatar user={me} size={16} /></span>
        </div>
        <div className={`vg-meta vg-fade${step >= 1 ? ' on' : ''}`}>
          <span className="vg-via">Agent via you</span>
          <span className="vg-branch"><IconBranch size={11} /><span>{branch}</span></span>
        </div>
        <div className={`vg-note vg-fade${step >= 2 ? ' on' : ''}`}>
          <span className="vg-note-by">Agent via you</span>
          {/* the whole note sits invisibly under the typed one, so the stage is sized for its last frame */}
          <span className="vg-note-text">
            <span className="vg-note-room">{fullNote}</span>
            <span>{note}{step >= 2 && step < 4 && <span className="vg-caret" />}</span>
          </span>
        </div>
      </div>
    </Stage>
  );
}

/* ================= GitHub ================= */
const PR_STEPS = [
  { pr: 'Open', prTone: 'var(--green)', issue: 'progress' as Status, label: 'In Progress' },
  { pr: 'In review', prTone: 'var(--status-started)', issue: 'review' as Status, label: 'In Review' },
  { pr: 'Merged', prTone: 'var(--ob-indigo)', issue: 'done' as Status, label: 'Done' },
  { pr: 'Merged', prTone: 'var(--ob-indigo)', issue: 'done' as Status, label: 'Done' },
];

export function GitHubDemo({ issueKey }: { issueKey: string }) {
  const step = useCycle(4, 1800);
  const s = PR_STEPS[step];
  return (
    <Stage hue="var(--ob-teal)" className="vg-gh">
      <div className="vg-card vg-pr">
        <IconPr size={13} />
        <span className="vg-key">#42</span>
        <span className="vg-title mono">fix-login-redirect</span>
        <span key={s.pr} className="vg-badge" style={{ ['--tone' as string]: s.prTone }}>{s.pr}</span>
      </div>
      <div className="vg-wire">
        {step < 3 && <span key={step} className="vg-spark" />}
      </div>
      <div className="vg-card">
        <div className="vg-row">
          <StatusGlyph status={s.issue} />
          <span className="vg-key">{issueKey}</span>
          <span className="vg-title">Fix login redirect loop</span>
          <span key={s.label} className="vg-state">{s.label}</span>
        </div>
      </div>
    </Stage>
  );
}

/* ================= invite ================= */
const TEAMMATES: Person[] = [
  { name: 'Maya', initials: 'MA', color: 'var(--ob-apricot)' },
  { name: 'Sam', initials: 'SA', color: 'var(--ob-teal)' },
  { name: 'Lee', initials: 'LE', color: 'var(--ob-indigo)' },
];

export function InviteDemo({ me, team, issueKey }: { me: Person; team: string; issueKey: string }) {
  const step = useCycle(6, 1250);
  const joined = Math.min(step, 3);
  return (
    <Stage hue="var(--ob-apricot)" className="vg-invite">
      <div className="vg-stack">
        <span className="vg-av"><Avatar user={me} size={24} /></span>
        {TEAMMATES.map((p, i) => (
          <span key={p.name} className={`vg-av vg-join${i < joined ? ' on' : ''}`}><Avatar user={p} size={24} /></span>
        ))}
        <span className="vg-team">
          {team} · <span key={joined} className="vg-count">{joined + 1}</span> {joined === 0 ? 'member' : 'members'}
        </span>
      </div>
      <div className={`vg-bubble${step >= 4 ? ' on' : ''}`}>
        <span className="vg-mention">@Maya</span> can you take {issueKey}? The agent finished the first pass.
      </div>
    </Stage>
  );
}

/* ================= first issue ================= */
export function IssueDemo({ issueKey }: { issueKey: string }) {
  const step = useCycle(6, 1250);
  const title = 'Add a dark mode toggle to settings';
  const typed = useTyped(title, step >= 1 && step < 3, 30);
  const landed = step >= 3;
  return (
    <Stage hue="var(--ob-indigo)" className="vg-issue">
      <div className={`vg-compose${landed ? ' sent' : ''}`}>
        <span key={step === 0 ? 'press' : 'idle'} className={`kbd vg-kbd${step === 0 ? ' press' : ''}`}>C</span>
        <span className="vg-compose-text">
          {landed ? <span className="vg-placeholder">Issue title</span> : typed || <span className="vg-placeholder">Issue title</span>}
          {!landed && step >= 1 && <span className="vg-caret" />}
        </span>
      </div>
      <div className="vg-list">
        <div className="vg-slot">
          {landed && (
            <div className="vg-row vg-landed">
              <StatusGlyph status="todo" />
              <span className="vg-key">{issueKey}</span>
              <span className="vg-title">{title}</span>
            </div>
          )}
        </div>
        <div className="vg-row vg-ghost"><span className="vg-bar" style={{ width: '62%' }} /></div>
        <div className="vg-row vg-ghost"><span className="vg-bar" style={{ width: '44%' }} /></div>
      </div>
    </Stage>
  );
}
