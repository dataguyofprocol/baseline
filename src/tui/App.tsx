// The root component: owns the reducer, the poll loop and the single input handler.
import { Box, Text, useApp, useInput, useStdout, useWindowSize, type Key } from 'ink';
import { Component, useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import type { Baseline } from '../client/index.js';
import { copyToClipboard } from '../cli/system.js';
import { errorText, runCommand, toast, type Ctx, type Layout } from './commands.js';
import { fetchData } from './data.js';
import { detailLines } from './detail.js';
import { contextsFor, isChordPrefix, keyName, lookup, takesText, type CommandId } from './keys.js';
import { contextOf } from './context.js';
import { displayWidth, isListRoute, type GroupBy, type Line, type Preset } from './model.js';
import type { SessionContext } from './session.js';
import { OverlayView } from './overlay-views.js';
import { DetailScreen, Footer, headerLine, InboxScreen, ListScreen, PeekPane, ProjectsScreen, scrollLabel, Sidebar, ToastLine } from './screens.js';
import { initialState, reducer, routeKey, type Action, type Route, type TuiState } from './state.js';
import { editField, type TextField } from './textfield.js';
import { SPINNER, theme } from './theme.js';
import { LineView } from './ui.js';

const SIDEBAR_MIN_COLS = 90;
const SIDEBAR_W = 26;
const CHORD_MS = 1000;
/** the peek pane opens on its own from these widths, so the list keeps room for its columns */
const PEEK_COLS_WITH_SIDEBAR = 150;
const PEEK_COLS = 120;

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
  return o.kind === 'palette' || o.kind === 'search' || o.kind === 'picker' || o.kind === 'compose' ? o.input : null;
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

  useEffect(() => {
    if (!state.pending) return;
    const t = setTimeout(() => dispatch({ type: 'pending', key: null }), CHORD_MS);
    return () => clearTimeout(t);
  }, [state.pending]);

  const context = useMemo(() => (onContext ? contextOf(state, Date.now()) : null),
    [onContext, state.data, state.route, state.stack, state.cursor, state.expanded, state.groupBy, state.preset]);
  // a refetch rebuilds the same context; only a real change is worth a write
  const contextJson = context ? JSON.stringify(context) : '';
  useEffect(() => { if (context && onContext) onContext(context); }, [contextJson]);

  const sidebarFits = columns >= SIDEBAR_MIN_COLS;
  const sidebarVisible = sidebarFits && !state.sidebarHidden;
  const mainW = columns - (sidebarVisible ? SIDEBAR_W : 0);
  const contentW = Math.max(20, mainW - 2);
  const bodyH = Math.max(1, rows - 4);
  const data = state.data;

  const threads = openIssue ? state.threads[openIssue] : undefined;
  const detail = useMemo(() => {
    if (!data || !openIssue) return null;
    const issue = data.issueById.get(openIssue);
    return issue ? detailLines(issue, data, threads ?? [], contentW, state.syncedAt ?? Date.now()) : null;
  }, [data, openIssue, threads, contentW, state.syncedAt]);

  const peekVisible = isListRoute(state.route) && (state.peek ?? columns >= (sidebarVisible ? PEEK_COLS_WITH_SIDEBAR : PEEK_COLS));
  const peekW = peekVisible ? Math.max(28, Math.min(60, Math.floor(contentW * 0.42))) : 0;
  const listW = peekVisible ? contentW - peekW - 3 : contentW;
  const layout: Layout = { pageSize: bodyH, detailMax: detail ? Math.max(0, detail.length - bodyH) : 0, helpMax: helpMax.current, sidebarVisible, sidebarFits, peekVisible };
  const contexts = contextsFor(state, sidebarVisible);

  const handleKey = (input: string, key: Key) => {
    if (suspended.current) return;
    const s = stateRef.current;
    const name = keyName(input, key);
    const ctxs = contextsFor(s, sidebarVisible);
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
    if (s.pending) {
      dispatch({ type: 'pending', key: null });
      const chord = lookup(ctxs, `${s.pending} ${name}`);
      // an unknown ending cancels the chord, as in Linear and vim
      return chord ? run(chord.command, name) : undefined;
    }
    if (!takesText(s) && isChordPrefix(ctxs, name)) return dispatch({ type: 'pending', key: name });
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
        <Footer s={state} contexts={contexts} width={columns} target={targetLabel(bl)} />
      </Box>
    );
  }

  const now = Date.now();
  const r = state.route;
  const screen = r.kind === 'issue' ? <DetailScreen s={state} lines={detail} width={contentW} height={bodyH} />
    : r.kind === 'inbox' ? <InboxScreen s={state} data={data} width={contentW} height={bodyH} now={now} />
    : r.kind === 'projects' ? <ProjectsScreen s={state} data={data} width={contentW} height={bodyH} />
    : peekVisible
      ? (
        <Box flexDirection="row">
          <ListScreen s={state} data={data} width={listW} height={bodyH} now={now} />
          <PeekPane s={state} data={data} width={peekW} height={bodyH} now={now} />
        </Box>
      )
      : <ListScreen s={state} data={data} width={contentW} height={bodyH} now={now} />;
  const right = r.kind === 'issue' && detail ? scrollLabel(state, detail.length, bodyH) : '';

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      <Box flexDirection="row" height={rows - 2}>
        {sidebarVisible ? <Sidebar s={state} data={data} width={SIDEBAR_W} height={rows - 2} now={now} /> : null}
        <Box flexDirection="column" width={mainW} paddingX={1}>
          <LineView line={headerLine(state, data, contentW, right, now)} width={contentW} />
          <LineView line={[]} width={contentW} />
          <ScreenBoundary resetKey={routeKey(r)}>{screen}</ScreenBoundary>
        </Box>
      </Box>
      <ToastLine toast={state.toast} width={columns} />
      <Footer s={state} contexts={contexts} width={columns} target={targetLabel(bl)} />
      <OverlayView s={state} data={data} contexts={contexts} cols={columns} rows={rows} now={now} onHelpMax={n => { helpMax.current = n; }} />
    </Box>
  );
}

function targetLabel(bl: Baseline): string {
  const t = bl.target;
  return t.kind === 'local' ? t.dbPath.split('/').pop() ?? 'local' : t.url.host;
}
