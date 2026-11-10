// The root component: owns the reducer, the poll loop and the single input handler.
import { Box, Text, useApp, useInput, useStdout, useWindowSize, type Key } from 'ink';
import { Component, useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import type { Baseline } from '../client/index.js';
import { copyToClipboard } from '../cli/system.js';
import { currentInboxItem, errorText, runCommand, targetIssue, toast, type Ctx, type Layout } from './commands.js';
import { fetchData } from './data.js';
import { detailLines } from './detail.js';
import { contextsFor, hintsFor, keyName, lookup, takesText, type CommandId, type Context } from './keys.js';
import { contextOf } from './context.js';
import { displayWidth, isListRoute, tabIdFor, visibleTabs, type GroupBy, type Line, type Preset } from './model.js';
import type { SessionContext } from './session.js';
import { OverlayView } from './overlay-views.js';
import { DetailPane, DetailScreen, Footer, hintSegs, inboxNote, InboxScreen, ListScreen, ProjectsScreen, scrollLabel, tabBarLine, ToastLine } from './screens.js';
import { initialState, reducer, routeKey, type Action, type Route, type TuiState } from './state.js';
import { editField, type TextField } from './textfield.js';
import { SPINNER, theme } from './theme.js';
import { LineView } from './ui.js';

/** from this width the list gets a detail pane beside it */
const WIDE_COLS = 100;

export interface AppProps {
  bl: Baseline;
  actorId?: string;
  route?: Route;
  stack?: Route[];
  /** list display and cursor to start with (a restored session) */
  start?: { groupBy?: GroupBy; preset?: Preset; cursorKey?: string | null };
  /** told what the screen shows whenever that changes, for `baseline context` */
  onContext?: (c: SessionContext) => void;
  /** the native clipboard (tests pass a fake so they leave the real one alone) */
  clipboard?: (text: string) => boolean;
  /** ms between background refetches; agents write to the same database from other processes */
  pollMs?: number;
}

class ScreenBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null; key: string }> {
  state = { error: null as Error | null, key: this.props.resetKey };
  static getDerivedStateFromError(error: Error) { return { error }; }
  static getDerivedStateFromProps(props: { resetKey: string }, state: { key: string }) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Box flexDirection="column">
        <Text color={theme.error} bold>This screen hit a bug and couldn't render.</Text>
        <Text color={theme.muted}>{this.state.error.message}</Text>
        <Text color={theme.muted}>esc goes back; the rest of the app still works.</Text>
      </Box>
    );
  }
}

function currentField(s: TuiState): TextField | null {
  const o = s.overlay;
  return o.kind === 'search' || o.kind === 'picker' || o.kind === 'compose' ? o.input : null;
}

function BootScreen({ s, width, height }: { s: TuiState; width: number; height: number }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (s.status !== 'loading') return;
    const t = setInterval(() => setFrame(f => f + 1), 80);
    return () => clearInterval(t);
  }, [s.status]);
  const lines: Line[] = s.status === 'error'
    ? [[{ text: '✗ Couldn\'t load the workspace', color: theme.error, bold: true }], [], [{ text: s.error ?? 'Unknown error' }], [], [{ text: 'r', bold: true }, { text: ' retry   ', color: theme.muted }, { text: 'q', bold: true }, { text: ' quit', color: theme.muted }]]
    : [[{ text: `${SPINNER[frame % SPINNER.length]} `, color: theme.accent }, { text: 'Loading workspace…', color: theme.muted }]];
  const top = Math.max(0, Math.floor(height / 3));
  const pad = (l: Line) => [{ text: ' '.repeat(Math.max(0, Math.floor((width - Math.min(width, Math.max(...lines.map(x => x.reduce((n, sg) => n + displayWidth(sg.text), 0))))) / 2))) }, ...l];
  return (
    <Box flexDirection="column" width={width} height={height}>
      {Array.from({ length: top }, (_, i) => <Text key={`t${i}`}> </Text>)}
      {lines.map((l, i) => <LineView key={i} line={pad(l)} width={width} />)}
    </Box>
  );
}

export function App({ bl, actorId, route, stack, start, onContext, clipboard = copyToClipboard, pollMs = 4000 }: AppProps) {
  const [state, dispatchToReact] = useReducer(reducer, undefined, () => initialState(route, stack, start));
  const stateRef = useRef(state);
  stateRef.current = state;
  // keys replayed from one chunk can arrive before React renders, so the ref runs the reducer itself
  const dispatch = useCallback((a: Action) => { stateRef.current = reducer(stateRef.current, a); dispatchToReact(a); }, []);
  const { columns, rows } = useWindowSize();
  const { exit, suspendTerminal } = useApp();
  const { stdout } = useStdout();
  const epoch = useRef(0);
  const fetching = useRef(false);
  const writing = useRef(0);
  const suspended = useRef(false);
  const helpMax = useRef(0);

  const loadThreads = useCallback(async (issueId: string) => {
    try {
      dispatch({ type: 'threads', issueId, threads: await bl.workThreads(issueId) });
    } catch {
      // a key without access to agent work still shows the rest of the issue
    }
  }, [bl]);

  const refresh = useCallback(async () => {
    const started = epoch.current;
    fetching.current = true;
    dispatch({ type: 'syncStart' });
    try {
      const data = await fetchData(bl);
      // a write began while this was in flight; its own refetch will land after it
      if (epoch.current !== started) return;
      dispatch({ type: 'loaded', data, at: Date.now() });
      const r = stateRef.current.route;
      if (r.kind === 'issue') void loadThreads(r.issueId);
    } catch (e) {
      dispatch({ type: 'loadFailed', message: errorText(e) });
    } finally {
      fetching.current = false;
    }
  }, [bl, loadThreads]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const t = setInterval(() => {
      if (!fetching.current && !writing.current && !suspended.current) void refresh();
    }, pollMs);
    return () => clearInterval(t);
  }, [refresh, pollMs]);

  const openIssue = state.route.kind === 'issue' ? state.route.issueId : null;
  useEffect(() => { if (openIssue) void loadThreads(openIssue); }, [openIssue, loadThreads]);

  useEffect(() => {
    if (!state.toast) return;
    const id = state.toast.id;
    const t = setTimeout(() => dispatch({ type: 'clearToast', id }), state.toast.tone === 'error' ? 7000 : 3500);
    return () => clearTimeout(t);
  }, [state.toast]);

  const context = useMemo(() => (onContext ? contextOf(state, Date.now()) : null),
    [onContext, state.data, state.route, state.stack, state.cursor, state.expanded, state.groupBy, state.preset]);
  // a refetch rebuilds the same context; only a real change is worth a write
  const contextJson = context ? JSON.stringify(context) : '';
  useEffect(() => { if (context && onContext) onContext(context); }, [contextJson]);

  const data = state.data;
  const wide = columns >= WIDE_COLS;
  const contentW = Math.max(20, columns - 2);
  const bodyH = Math.max(1, rows - 4);
  const r = state.route;
  const hasPane = wide && (isListRoute(r) || r.kind === 'inbox');
  const listW = hasPane ? Math.floor(contentW * 0.45) : contentW;
  const paneW = contentW - listW;
  const activeTab = tabIdFor(r, state.stack);
  const { tabs, hidden } = data ? visibleTabs(data, Date.now(), contentW, activeTab) : { tabs: [], hidden: 0 };

  const threads = openIssue ? state.threads[openIssue] : undefined;
  const detail = useMemo(() => {
    if (!data || !openIssue) return null;
    const issue = data.issueById.get(openIssue);
    return issue ? detailLines(issue, data, threads ?? [], contentW, state.syncedAt ?? Date.now()) : null;
  }, [data, openIssue, threads, contentW, state.syncedAt]);

  const layout: Layout = { pageSize: bodyH, detailMax: detail ? Math.max(0, detail.length - bodyH) : 0, helpMax: helpMax.current, tabs };
  const contexts = contextsFor(state);

  const handleKey = (input: string, key: Key) => {
    if (suspended.current) return;
    const s = stateRef.current;
    const name = keyName(input, key);
    const ctxs = contextsFor(s);
    const run = (command: CommandId, keyPressed: string) => {
      const ctx: Ctx = {
        state: stateRef.current, dispatch, bl, actorId, layout: { ...layout, helpMax: helpMax.current }, refresh,
        beginWrite: () => {
          epoch.current++;
          writing.current++;
          let done = false;
          return () => { if (!done) { done = true; writing.current--; } };
        },
        suspend: async fn => {
          suspended.current = true;
          try { await suspendTerminal(fn); } finally { suspended.current = false; }
        },
        terminal: seq => { stdout.write(seq); },
        clipboard,
        exit: () => exit(),
        now: () => Date.now(),
      };
      runCommand(command, ctx, keyPressed).catch(e => toast(dispatch, 'error', errorText(e)));
    };
    const binding = lookup(ctxs, name);
    if (binding) return run(binding.command, name);
    const field = takesText(s) ? currentField(s) : null;
    const next = field ? editField(field, name, input) : null;
    if (next) dispatch({ type: 'editInput', input: next });
  };

  // tmux/cmux `send-keys jj` and fast key macros arrive as one chunk; outside a text field each
  // character is its own keypress, replayed a frame apart so each sees the state the last produced
  useInput((input, key) => {
    if (input.length < 2 || key.ctrl || key.meta || takesText(stateRef.current)) return handleKey(input, key);
    [...input].forEach((ch, i) => setTimeout(() => handleKey(ch, { ...key, return: ch === '\r' }), i * 16));
  });

  if (!data) {
    return (
      <Box flexDirection="column" width={columns} height={rows}>
        <BootScreen s={state} width={columns} height={rows - 2} />
        <ToastLine toast={state.toast} width={columns} />
        <Footer s={state} left={footerLeft(contexts, 0)} width={columns} target={targetLabel(bl)} />
      </Box>
    );
  }

  const now = Date.now();
  const cursorIssue = targetIssue(state, now);
  const inboxItem = r.kind === 'inbox' ? currentInboxItem(state, now) : undefined;
  const list = r.kind === 'inbox' ? <InboxScreen s={state} data={data} width={listW} height={bodyH} now={now} />
    : r.kind === 'projects' ? <ProjectsScreen s={state} data={data} width={contentW} height={bodyH} />
    : r.kind === 'issue' ? <DetailScreen s={state} lines={detail} width={contentW} height={bodyH} />
    : <ListScreen s={state} data={data} width={listW} height={bodyH} now={now} />;
  const screen = hasPane
    ? (
      <Box flexDirection="row">
        {list}
        <DetailPane issue={cursorIssue} note={inboxItem ? inboxNote(inboxItem, paneW - 3, now) : undefined} data={data} width={paneW} height={bodyH} now={now} />
      </Box>
    )
    : list;
  const right = r.kind === 'issue' && detail ? scrollLabel(state, detail.length, bodyH) : '';

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      <Box paddingX={1}><LineView line={tabBarLine(state, data, tabs, hidden, activeTab, contentW, right)} width={contentW} /></Box>
      <LineView line={[{ text: '─'.repeat(columns), color: theme.border }]} width={columns} />
      <Box flexDirection="row" height={bodyH} paddingX={1}>
        <ScreenBoundary resetKey={routeKey(r)}>{screen}</ScreenBoundary>
      </Box>
      <ToastLine toast={state.toast} width={columns} />
      <Footer s={state} left={footerLeft(contexts, tabs.length)} width={columns} target={targetLabel(bl)} />
      <OverlayView s={state} data={data} contexts={contexts} cols={columns} rows={rows} now={now} onHelpMax={n => { helpMax.current = n; }} />
    </Box>
  );
}

/** the footer's keys: the active contexts' hints from the keymap, "1-9" cut to the tabs there are */
function footerLeft(contexts: Context[], tabCount: number) {
  return hintSegs(hintsFor(contexts).map(h => (h.key === '1-9' && h.label === 'tabs' ? { ...h, key: `1-${Math.min(9, tabCount)}` } : h)));
}

function targetLabel(bl: Baseline): string {
  const t = bl.target;
  return t.kind === 'local' ? t.dbPath.split('/').pop() ?? 'local' : t.url.host;
}
