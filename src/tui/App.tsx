// The root component: owns the reducer, the poll loop and the single input handler.
import { Box, Text, useApp, useInput, useStdout, useWindowSize, type Key } from 'ink';
import { Component, useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import type { Baseline } from '../client/index.js';
import { copyToClipboard } from '../cli/system.js';
import { errorText, handoff, runCommand, targetIssue, todayRow, toast, type Ctx, type Layout } from './commands.js';
import { menuTrail, MENUS } from './menus.js';
import { fetchData, type TuiData } from './data.js';
import { detailLayout, floatingPickerRows, PICKER_ROWS, pickerLines, todayPaneLines, type IssueUi } from './detail.js';
import { contextsFor, hintsFor, keyName, lookup, takesText, type CommandId, type Context } from './keys.js';
import { contextOf } from './context.js';
import { displayWidth, isListRoute, tabIdFor, tildePath, visibleTabs, type GroupBy, type Line, type Preset, type Seg } from './model.js';
import { filteredOptions, PICKER_TITLE } from './overlays.js';
import type { SessionContext } from './session.js';
import { helpRows, OverlayView } from './overlay-views.js';
import { DetailPane, DetailScreen, Footer, hintSegs, ListScreen, scrollLabel, tabBarLine, TodayScreen, ToastLine } from './screens.js';
import { issueNeeds, paneStarting, type Pane } from './today.js';
import type { LocalRepo } from '../ops/operation.js';
import { initialState, reducer, routeKey, type Action, type Route, type TuiState } from './state.js';
import { editField, type TextField } from './textfield.js';
import { SPINNER, theme } from './theme.js';
import { fieldBlock, LineView } from './ui.js';

/** from this width the list gets a detail pane beside it */
const WIDE_COLS = 100;

export interface AppProps {
  bl: Baseline;
  actorId?: string;
  route?: Route;
  stack?: Route[];
  /** list display and cursor to start with (a restored session), and whether to open on the first-launch card */
  start?: { groupBy?: GroupBy; preset?: Preset; cursorKey?: string | null; intro?: boolean };
  /** told what the screen shows whenever that changes, for `baseline context` */
  onContext?: (c: SessionContext) => void;
  /** the native clipboard (tests pass a fake so they leave the real one alone) */
  clipboard?: (text: string) => boolean;
  /** ms between background refetches; agents write to the same database from other processes */
  pollMs?: number;
  /** tmux panes this TUI started agents in (issue → pane), and where a new one is remembered (null: forgotten) */
  panes?: Record<string, Pane>;
  onPane?: (issueId: string, pane: Pane | null) => void;
  /** the git repo an issue starts in; tests pass one that touches no repo */
  repo?: (cwd: string) => LocalRepo;
  /** whether new tmux panes are possible (default: $TMUX is set) */
  tmux?: boolean;
  /** the In flight spinner turns (tests switch it off so frames stay still) */
  animate?: boolean;
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
  return o.kind === 'picker' || o.kind === 'find' ? o.query : o.kind === 'compose' ? o.input : o.kind === 'sheet' && o.sheet.type === 'note' ? o.sheet.input : null;
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

export function App({ bl, actorId, route, stack, start, onContext, clipboard = copyToClipboard, pollMs = 4000, panes, onPane, repo, tmux, animate = true }: AppProps) {
  const [state, dispatchToReact] = useReducer(reducer, undefined, () => initialState(route, stack, { ...start, panes }));
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
  const findRows = useRef(0);

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

  // the agent and copy menus show the branch and the command before you pick, so fetch the handoff as they open
  const wantsHandoff = state.overlay.kind === 'menu' && state.overlay.path.some(m => m === 'agent' || m === 'copy') ? state.overlay.issueId
    : state.overlay.kind === 'find' && state.data ? targetIssue(state, Date.now())?.id ?? null : null;
  useEffect(() => {
    const issue = wantsHandoff ? stateRef.current.data?.issueById.get(wantsHandoff) : undefined;
    if (issue) void handoff({ bl, dispatch, state: stateRef.current }, issue, true);
  }, [wantsHandoff, bl]);
  useEffect(() => { if (openIssue) void loadThreads(openIssue); }, [openIssue, loadThreads]);

  useEffect(() => {
    if (!state.saved) return;
    const id = state.saved.id;
    const t = setTimeout(() => dispatch({ type: 'clearSaved', id }), 3000);
    return () => clearTimeout(t);
  }, [state.saved]);

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
  const hasPane = wide && (isListRoute(r) || r.kind === 'today');
  const listW = hasPane ? Math.floor(contentW * (r.kind === 'today' ? 0.55 : 0.45)) : contentW;
  const paneW = contentW - listW;
  const activeTab = tabIdFor(r, state.stack);
  const { tabs, hidden } = data ? visibleTabs(data, Date.now(), contentW, activeTab) : { tabs: [], hidden: 0 };

  const threads = openIssue ? state.threads[openIssue] : undefined;
  const o = state.overlay;
  const cursorIssue = data ? targetIssue(state, Date.now()) : undefined;
  // a picker opens under its field wherever that field is on screen: the detail pane, or the issue page
  const onScreen = (id: string) => (hasPane && cursorIssue?.id === id) || openIssue === id;
  const inlineOn = o.kind === 'picker' && onScreen(o.issueId) ? o : null;
  // so does a title being edited: it is edited where it is shown
  const titleOn = o.kind === 'compose' && o.target === 'title' && onScreen(o.issueId) ? o : null;
  const saved = state.saved;
  const issueUi = (width: number, issueId: string | undefined): IssueUi => ({
    saved: saved && saved.issueId === issueId ? saved.field : null,
    picker: inlineOn && data ? { field: inlineOn.field, lines: indent(pickerLines(inlineOn, data, width - 2, PICKER_ROWS)) } : null,
    title: titleOn ? fieldBlock(titleOn.input, width, 'Issue title', 3).map(l => l.map(x => ({ ...x, bold: true }))) : null,
  });
  const pageUi = useMemo((): IssueUi => (data && openIssue ? issueUi(contentW, openIssue) : {}), [data, openIssue, inlineOn, titleOn, contentW, saved]);
  const focusComment = r.kind === 'issue' ? r.focusComment : undefined;
  const layoutOf = useMemo(() => {
    if (!data || !openIssue) return null;
    const issue = data.issueById.get(openIssue);
    return issue ? detailLayout(issue, data, threads ?? data.threads.get(openIssue) ?? [], contentW, state.syncedAt ?? Date.now(), { ...pageUi, focusComment }) : null;
  }, [data, openIssue, threads, contentW, state.syncedAt, pageUi, focusComment]);
  // a page opened at a comment can scroll that comment up to the top, clear of the reply sheet below it
  const detail = layoutOf ? (focusComment ? [...layoutOf.lines, ...Array.from({ length: Math.max(0, rows - 8) }, (): Line => [])] : layoutOf.lines) : null;
  // a mention opens scrolled to its comment (a little above it), until you scroll yourself
  const focusAt = focusComment && layoutOf ? layoutOf.anchors[focusComment] : undefined;
  const detailStart = focusAt !== undefined ? Math.max(0, focusAt - 4) : 0;
  const pinned = detail && pageUi.picker ? detail.indexOf(pageUi.picker.lines[0]) - 1 : undefined;

  const overlayPage = o.kind === 'picker' ? (inlineOn ? PICKER_ROWS : floatingPickerRows(rows)) : o.kind === 'help' ? helpRows(rows)
    : o.kind === 'menu' ? MENUS[o.path[o.path.length - 1]].rows.length : 0;
  const layout: Layout = { pageSize: bodyH, detailMax: detail ? Math.max(0, detail.length - bodyH) : 0, detailStart, helpMax: helpMax.current, overlayPage, tabs };
  const contexts = contextsFor(state);
  const needs = data ? issueNeeds(data, Date.now()) : [];
  const needAt = r.kind === 'issue' ? needs.findIndex(n => n.issue.id === r.issueId) : -1;

  const handleKey = (input: string, key: Key) => {
    if (suspended.current) return;
    const s = stateRef.current;
    const name = keyName(input, key);
    const ctxs = contextsFor(s);
    const run = (command: CommandId, keyPressed: string) => {
      const ctx: Ctx = {
        state: stateRef.current, dispatch, bl, actorId, layout: { ...layout, helpMax: helpMax.current, overlayPage: s.overlay.kind === 'find' ? findRows.current : layout.overlayPage }, refresh,
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
        repo, onPane, tmux,
      };
      runCommand(command, ctx, keyPressed).catch(e => toast(dispatch, 'error', errorText(e)));
    };
    const binding = lookup(ctxs, name);
    if (binding) return run(binding.command, name);
    if (s.overlay.kind === 'menu') return run('menuKey', name);
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
      <Box flexDirection="column" width="100%" height={rows} overflow="hidden">
        <BootScreen s={state} width={columns} height={rows - 2} />
        <ToastLine toast={state.toast} width={columns} />
        <Footer s={state} left={footerLeft(state, null, contexts, 0)} width={columns} target={targetLabel(bl)} />
      </Box>
    );
  }

  const now = Date.now();
  const dim = o.kind !== 'none';
  const paneUi: IssueUi = openIssue ? {} : issueUi(paneW - 3, cursorIssue?.id);
  const tRow = r.kind === 'today' ? todayRow(state, now) : undefined;
  const list = r.kind === 'today' ? <TodayScreen s={state} data={data} width={listW} height={bodyH} now={now} dim={dim} animate={animate} />
    : r.kind === 'issue' ? <DetailScreen s={state} lines={detail} width={contentW} height={bodyH} pinned={pinned} start={detailStart} />
    : <ListScreen s={state} data={data} width={listW} height={bodyH} now={now} dim={dim} />;
  // a picker or a title being edited opens in the pane's field rows, so the pane shows the plain issue then
  const paneLinesFor = !inlineOn && !titleOn && tRow && tRow.kind !== 'doneHeader' && tRow.kind !== 'done'
    ? todayPaneLines(tRow.kind === 'flight' ? { kind: 'flight', row: tRow.row, pane: !!state.panes[tRow.id], starting: paneStarting(data, tRow.id, state.panes[tRow.id]) } : tRow, data, paneW - 3, bodyH, now, paneUi)
    : undefined;
  const screen = hasPane
    ? (
      <Box flexDirection="row">
        {list}
        <DetailPane issue={tRow?.kind === 'doneHeader' ? undefined : cursorIssue} lines={paneLinesFor} data={data} width={paneW} height={bodyH} now={now} ui={paneUi} />
      </Box>
    )
    : list;
  const needLabel = needAt >= 0 && (r.kind === 'issue' && r.needs) ? `${needAt + 1} of ${needs.length} needs you` : '';
  const right = [needLabel, r.kind === 'issue' && detail ? scrollLabel(state, detail.length, bodyH, detailStart) : ''].filter(Boolean).join('   ');

  return (
    <Box flexDirection="column" width="100%" height={rows} overflow="hidden">
      <Box paddingX={1}><LineView line={tabBarLine(state, data, tabs, hidden, activeTab, contentW, right)} width={contentW} /></Box>
      <LineView line={[{ text: '─'.repeat(columns), color: theme.border }]} width={columns} />
      <Box flexDirection="row" height={bodyH} paddingX={1}>
        <ScreenBoundary resetKey={routeKey(r)}>{screen}</ScreenBoundary>
      </Box>
      <ToastLine toast={state.toast} width={columns} />
      <Footer s={state} left={footerLeft(state, data, contexts, tabs.length)} width={columns} target={targetLabel(bl)} />
      {inlineOn || titleOn ? null : <OverlayView s={state} data={data} contexts={contexts} cols={columns} rows={rows} now={now} onHelpMax={n => { helpMax.current = n; }} onFindRows={n => { findRows.current = n; }} tabs={tabs.length} target={cardTarget(bl)} tmux={tmux ?? !!process.env.TMUX} />}
    </Box>
  );
}

const indent = (lines: Line[]): Line[] => lines.map(l => [{ text: '  ' }, ...l]);

/** what an open overlay is about, bold at the start of the footer */
function overlayTitle(s: TuiState, data: TuiData | null): string {
  const o = s.overlay;
  const key = (id: string) => { const i = data?.issueById.get(id); return i ? data!.keyOf(i) : ''; };
  switch (o.kind) {
    case 'picker': return `${PICKER_TITLE[o.field]} for ${key(o.issueId)}`;
    case 'find': return 'Find';
    case 'compose': return o.target === 'issue' ? 'New issue' : `Rename ${key(o.issueId)}`;
    case 'help': return o.intro ? '' : 'Keys';
    case 'menu': case 'none': case 'sheet': return '';
  }
}

/** the footer's keys: the active contexts' hints from the keymap, after the open overlay's title; "1-9" is cut to
 *  the tabs or options there are */
function footerLeft(s: TuiState, data: TuiData | null, contexts: Context[], tabCount: number): Seg[] {
  const o = s.overlay;
  if (o.kind === 'menu') {
    // which-key: the letters this menu answers to, after the keys that led here
    const keys = MENUS[o.path[o.path.length - 1]].rows.map(r => r.key).join(' ');
    return [{ text: `${menuTrail(o.path).join(' › ')} › `, bold: true }, { text: '_', color: theme.accent, bold: true }, { text: `   waiting for the next key: ${keys}`, color: theme.muted }];
  }
  if (o.kind === 'help' && o.intro) return hintSegs([{ key: 'enter', label: 'start' }]);
  const options = o.kind === 'picker' && data ? filteredOptions(o, data).length : 0;
  const hints = hintsFor(contexts).map(h => {
    if (h.key !== '1-9') return h;
    const n = Math.min(9, o.kind === 'picker' ? options : tabCount);
    return { ...h, key: n > 1 ? `1-${n}` : '1', label: o.kind === 'picker' && o.field === 'labels' ? 'toggle' : h.label };
  });
  const title = overlayTitle(s, data);
  return [...(title ? [{ text: title, bold: true }, { text: '   ' }] : []), ...hintSegs(hints)];
}

/** where the data lives, the way the first-launch card says it */
function cardTarget(bl: Baseline): string {
  const t = bl.target;
  return t.kind === 'local' ? `local · ${tildePath(t.dbPath)}` : `server · ${t.url.host}`;
}

function targetLabel(bl: Baseline): string {
  const t = bl.target;
  return t.kind === 'local' ? t.dbPath.split('/').pop() ?? 'local' : t.url.host;
}
