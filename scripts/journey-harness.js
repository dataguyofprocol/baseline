/* Journey harness: drives the running Baseline app the way a person would (keys, clicks,
   typing) and checks the result in the UI and through /api/bootstrap. One row per journey. */
(() => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const results = [];
  const t = {
    results, sleep,
    fail(m) { throw new Error(m); },
    async nav(h, ms = 600) { location.hash = '#' + h; await sleep(ms); },
    key(k, o = {}) {
      const el = document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body;
      const code = o.code ?? (k.length === 1 ? (/[a-z]/i.test(k) ? 'Key' + k.toUpperCase() : /\d/.test(k) ? 'Digit' + k : k === '/' ? 'Slash' : k === '[' ? 'BracketLeft' : k === ' ' ? 'Space' : '') : k);
      const ev = new KeyboardEvent('keydown', { key: k, code, bubbles: true, cancelable: true, metaKey: !!o.meta, shiftKey: !!o.shift, altKey: !!o.alt, ctrlKey: !!o.ctrl });
      el.dispatchEvent(ev); el.dispatchEvent(new KeyboardEvent('keyup', { key: k, code, bubbles: true })); return ev;
    },
    async press(k, o = {}, ms = 320) { t.key(k, o); await sleep(ms); },
    menuOpen() { return !!document.querySelector('.menu:not(.closing)'); },
    async closeAll() { for (let i = 0; i < 6 && (t.menuOpen() || document.querySelector('.overlay, .modal-palette')); i++) { t.key('Escape'); await sleep(350); } if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); },
    q: sel => document.querySelector(sel),
    qa: sel => [...document.querySelectorAll(sel)],
    vis: e => !!e && e.getClientRects().length > 0,
    byText(text, sel = 'button, a, .menu-item, [role=button], [role=switch]') { const all = t.qa(sel).filter(t.vis); return all.find(e => e.textContent.trim() === text) ?? all.find(e => e.textContent.trim().startsWith(text)); },
    menuItem(text) { const m = [...document.querySelectorAll('.menu:not(.closing)')].pop(); return m && ([...m.querySelectorAll('.menu-item, button')].find(e => e.textContent.trim().startsWith(text)) ?? [...m.querySelectorAll('.menu-item, button')].find(e => e.textContent.includes(text))); },
    async click(target, ms = 420) { const el = typeof target === 'string' ? (t.q(target) ?? t.byText(target)) : target; if (!el) throw new Error('no element: ' + target); el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.click(); await sleep(ms); return el; },
    async type(el, value, ms = 260) { if (typeof el === 'string') el = t.q(el); if (!el) throw new Error('no input'); el.focus(); const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); await sleep(ms); },
    async write(pm, text) { pm.focus(); document.execCommand('insertText', false, text); await sleep(260); },
    snap: () => fetch('/api/bootstrap').then(r => r.json()),
    async issue(key) { const s = await t.snap(); const [k, n] = key.split('-'); const tm = s.teams.find(x => x.key === k); return s.issues.find(i => i.teamId === tm.id && i.number === Number(n)); },
    async keyOf(id) { const s = await t.snap(); const i = s.issues.find(x => x.id === id); return `${s.teams.find(x => x.id === i.teamId).key}-${i.number}`; },
    text: () => (document.querySelector('.main') ?? document.body).innerText,
    async sync() { window.dispatchEvent(new Event('focus')); await sleep(800); },
    post: (url, body, method = 'POST') => fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()),
    async ctx(el) { const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 40, clientY: r.top + 10 })); await sleep(500); },
    async hover(el) { for (const n of ['mouseover', 'mouseenter']) el.dispatchEvent(new MouseEvent(n, { bubbles: true })); el.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true })); el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true })); await sleep(350); },
    rows: () => t.qa('[data-issue-row]').length,
    /** click a menu trigger until its menu is really open (a fading menu can swallow the first click) */
    async openMenu(sel, ms = 450) { for (let i = 0; i < 4; i++) { await t.waitClosed(); await t.click(sel, ms); if (t.menuOpen()) return; } throw new Error('menu did not open: ' + sel); },
    rowSwitch(label) { const r = [...document.querySelectorAll('.menu:not(.closing) .dopts-row, .menu:not(.closing) .menu-item')].find(e => e.textContent.trim().startsWith(label)); return r?.querySelector('[role=switch], .switch, button') ?? r; },
    async waitClosed() { for (let i = 0; i < 20 && document.querySelector('.menu.closing'); i++) await sleep(60); },
    ok(row, pass, detail = '') { results.push({ row, pass: !!pass, detail: String(detail).slice(0, 220) }); },
    async run(row, fn) { await t.closeAll(); try { const r = await fn(); t.ok(row, r !== false, typeof r === 'string' ? r : ''); } catch (e) { t.ok(row, false, e.message); } await t.closeAll(); },
    report: () => results.map(r => `${r.pass ? 'PASS' : 'FAIL'} ${r.row}${r.detail ? ' — ' + r.detail : ''}`),
  };
  window.__t = t;
  const sections = window.__sections = [];
  const S = (name, fn) => sections.push({ name, fn });
  window.__runAll = async (only) => { results.length = 0; const errs = []; const onErr = e => errs.push(location.hash + ' ' + (e.message ?? e.reason)); window.addEventListener('error', onErr); window.addEventListener('unhandledrejection', onErr);
    for (const s of sections) if (!only || only.includes(s.name)) await s.fn(t);
    window.removeEventListener('error', onErr); window.removeEventListener('unhandledrejection', onErr);
    if (errs.length) t.ok('page errors during the run', false, errs.slice(0, 5).join(' | '));
    localStorage.setItem('__harness', JSON.stringify(results)); return t.report(); };

  /* ================= 1. shell & navigation ================= */
  S('shell', async t => {
    await t.nav('/inbox');
    await t.run('1.1 Sidebar: Inbox, My issues, Workspace (Projects, Views, Pulse, Customers, More), Favorites, Your teams', () => {
      const s = t.q('.sidebar').innerText; const miss = ['Inbox', 'My issues', 'Workspace', 'Projects', 'Views', 'Pulse', 'Customers', 'More', 'Favorites', 'Your teams'].filter(n => !s.includes(n));
      if (miss.length) t.fail('missing ' + miss); return 'all present';
    });
    await t.run('1.2 Team sub-items: Home, Triage (count), Issues, Cycles › Current/Upcoming, Projects, Views', async () => {
      for (const b of t.qa('.nav-team')) if (b.getAttribute('aria-expanded') !== 'true') await t.click(b, 250);
      const subs = t.qa('.nav-sub').map(x => x.innerText.replace(/\s+/g, ' '));
      if (!subs.every(x => ['Home', 'Issues', 'Projects', 'Views'].every(k => x.includes(k)))) t.fail(subs.join(' | '));
      if (!subs.some(x => /Triage \d/.test(x))) t.fail('no triage count'); if (!subs.some(x => x.includes('Current') && x.includes('Upcoming'))) t.fail('no current/upcoming');
      return subs.join(' | ');
    });
    await t.run('1.3 Team row "…" menu', async () => {
      await t.click('.nav-team-more'); const m = t.q('.menu:not(.closing)').innerText;
      if (!['Team overview', 'Issues', 'Cycles', 'Triage', 'Archive', 'Team settings', 'Copy link'].every(x => m.includes(x))) t.fail(m); return m.replace(/\n/g, ', ');
    });
    await t.run('1.4 Cycles › Current / Upcoming open the right cycle', async () => {
      const s = await t.snap(); const core = s.teams.find(x => x.key === 'CORE'); const now = new Date().toISOString();
      const cur = s.cycles.find(c => c.teamId === core.id && c.startsAt <= now && c.endsAt >= now); const up = s.cycles.filter(c => c.teamId === core.id && c.startsAt > now).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
      await t.nav('/team/CORE/cycles/current', 900); if (!location.hash.endsWith(cur.id)) t.fail('current → ' + location.hash);
      await t.nav('/team/CORE/cycles/upcoming', 900); if (!location.hash.endsWith(up.id)) t.fail('upcoming → ' + location.hash);
      return `current #${cur.number}, upcoming #${up.number}`;
    });
    await t.run('1.5 Team Home: Overview (description, resources), Documents, Members, Go to', async () => {
      await t.click(t.qa('.nav-sub a').find(a => a.textContent.trim() === 'Home')); const ov = t.text();
      await t.nav('/team/CORE/overview/documents'); const docs = t.text(); await t.nav('/team/CORE/overview/members'); const mem = t.text();
      if (!(ov.includes('Team resources') && ov.includes('Go to') && docs.includes('Release runbook') && mem.includes('Parth Batra'))) t.fail('missing content'); return 'overview / documents / members';
    });
    await t.run('1.6 "+" beside Your teams → Create a new team', async () => {
      await t.nav('/inbox'); await t.click('.nav-section-add'); if (!(location.hash === '#/settings/new-team' && t.text().includes('Create a new team'))) t.fail(location.hash);
      await t.type(t.qa('.settings-content input')[0], 'Design Ops', 300); const ident = t.qa('.settings-content input')[1].value; return 'page opens; identifier derived: ' + ident;
    });
    await t.run('1.7 G-chords as Linear maps them: I M A(ctive) E(verything) B T C V W(upcoming) U(views) D(rafts) P X S', async () => {
      const want = { i: '/inbox', m: '/my-issues', a: '/active', e: '/all', b: '/backlog', t: '/triage', c: '/cycles', v: '/cycles/', w: '/cycles/', u: '/views', d: '/drafts', p: '/projects', x: '/archive', s: '/settings' }; const bad = [];
      for (const [k, frag] of Object.entries(want)) { await t.nav('/team/CORE/all', 380); await t.press('g', {}, 120); await t.press(k, {}, 520); if (!location.hash.includes(frag)) bad.push(k + '→' + location.hash); }
      if (bad.length) t.fail(bad.join(' ')); return '14 chords';
    });
    await t.run('1.8 ⌘K palette is scoped to the open issue', async () => {
      await t.nav('/issue/CORE-1', 800); await t.press('k', { meta: true }, 500); const txt = t.q('.modal-palette')?.innerText ?? '';
      if (!(txt.includes('CORE-1 · ') && txt.includes('Assign to me'))) t.fail(txt.slice(0, 100)); return 'scoped to CORE-1 with issue actions';
    });
    await t.run('1.9 Search page (/) matches titles, IDs and comment text', async () => {
      await t.nav('/inbox', 400); await t.press('/', {}, 650); if (location.hash !== '#/search') t.fail('hash ' + location.hash);
      const hits = () => t.rows() + t.qa('[data-search-row="Issue"]').length;
      const inp = t.qa('input').find(t.vis); await t.type(inp, 'light theme needs', 800); const c = hits(); await t.type(inp, 'CORE-3', 800); const k = hits(); await t.type(inp, 'Theme switching', 800); const ti = hits();
      if (!c || !k || !ti) t.fail(`comment ${c} key ${k} title ${ti}`); return `comment text ${c}, key ${k}, title ${ti}`;
    });
    await t.run('1.10 ⌘Z undoes a property change', async () => {
      await t.nav('/issue/CORE-2', 800); const before = (await t.issue('CORE-2')).priority;
      await t.press('p', {}, 500); if (!t.menuOpen()) t.fail('P menu'); await t.press(before === 1 ? '2' : '1', {}, 950);
      const mid = (await t.issue('CORE-2')).priority; await t.press('z', { meta: true }, 1100); const after = (await t.issue('CORE-2')).priority;
      if (!(mid !== before && after === before)) t.fail(`before ${before} mid ${mid} after ${after}`); return `priority ${before}→${mid}→${after}`;
    });
    await t.run('1.11 [ toggles the sidebar, ⌘B flips list ↔ board', async () => {
      await t.nav('/team/CORE/all', 800); const c0 = t.q('.sidebar').classList.contains('collapsed'); await t.press('['); const c1 = t.q('.sidebar').classList.contains('collapsed'); await t.press('[');
      const b0 = !!t.q('.board'); await t.press('b', { meta: true }, 650); const b1 = !!t.q('.board'); await t.press('b', { meta: true }, 650);
      if (c0 === c1 || b0 === b1) t.fail(`sidebar ${c0}/${c1} board ${b0}/${b1}`); return 'both toggle';
    });
    await t.run('1.12 Issue shortcuts never act on a list left behind (S on a project page)', async () => {
      await t.nav('/team/CORE/all', 700); await t.press('j', {}, 200); const s = await t.snap(); await t.nav('/projects/' + s.projects[0].id, 900);
      await t.press('s', {}, 450); if (t.menuOpen()) t.fail('S opened an issue menu on a project page'); return 'no stray menu';
    });
  });

  /* ================= 2. capture work ================= */
  S('create', async t => {
    await t.run('2.1 C opens the modal: team, title, rich description, properties, draft, create-more, ⌘↵', async () => {
      await t.nav('/team/CORE/all', 700); await t.press('c', {}, 650); const m = t.q('.cm-root'); if (!m) t.fail('no modal');
      await t.type(m.querySelector('input, textarea'), 'Harness: created from C', 300); const txt = m.innerText;
      const miss = ['CORE', 'Save draft', 'Create more', 'Create issue', 'Priority', 'Labels'].filter(x => !txt.includes(x)); if (miss.length) t.fail('missing ' + miss);
      if (!m.querySelector('.ProseMirror')) t.fail('no rich description');
      await t.click(t.byText('Create more'), 200); t.key('Enter', { meta: true }); await sleep(1300);
      const s = await t.snap(); if (!s.issues.some(i => i.title === 'Harness: created from C')) t.fail('not created'); if (!t.q('.cm-root')) t.fail('create-more closed the modal');
      return 'created; create-more kept the modal open';
    });
    await t.run('2.2 Save draft; Drafts page lists it; reopening restores it', async () => {
      await t.nav('/team/CORE/all', 600); await t.press('c', {}, 650); await t.type(t.q('.cm-root input, .cm-root textarea'), 'Harness draft', 300); await t.click(t.byText('Save draft'), 650);
      await t.nav('/drafts', 700); const listed = t.text().includes('Harness draft'); await t.click(t.qa('.static-row').find(r => r.innerText.includes('Harness draft')), 800);
      const restored = (t.q('.cm-root input, .cm-root textarea')?.value ?? '') === 'Harness draft'; const d = t.byText('Discard'); if (d) await t.click(d, 300);
      if (!listed || !restored) t.fail(`listed ${listed} restored ${restored}`); return 'listed on Drafts, restored in the modal';
    });
    await t.run('2.3 C is context-aware (project page, cycle page, triage page)', async () => {
      const s = await t.snap(); const p = s.projects[0]; const core = s.teams.find(x => x.key === 'CORE'); const now = new Date().toISOString(); const cur = s.cycles.find(c => c.teamId === core.id && c.startsAt <= now && c.endsAt >= now);
      await t.nav('/projects/' + p.id, 800); await t.press('c', {}, 650); const a = t.q('.cm-pills')?.innerText.includes(p.name); await t.closeAll();
      await t.nav(`/team/CORE/cycles/${cur.id}`, 800); await t.press('c', {}, 650); const b = t.q('.cm-pills')?.innerText.includes(`Cycle ${cur.number}`); await t.closeAll();
      await t.nav('/team/AGO/triage', 800); await t.press('c', {}, 650); const c = t.q('.cm-pills')?.innerText.startsWith('Triage');
      if (!a || !b || !c) t.fail(`project ${a} cycle ${b} triage ${c}`); return 'project, cycle and triage prefilled';
    });
    await t.run('2.4 Rich text: / commands (headings, lists, checklist, code, quote) and @mentions', async () => {
      await t.nav('/issue/CORE-3', 900); const pm = t.qa('.ProseMirror')[0]; pm.focus(); document.execCommand('selectAll'); const orig = pm.innerText;
      document.execCommand('insertText', false, '/'); await sleep(500); const slash = t.q('.suggest-pop')?.innerText ?? ''; t.key('Escape'); await sleep(200);
      document.execCommand('selectAll'); document.execCommand('insertText', false, '@Ad'); await sleep(500); const at = t.q('.suggest-pop')?.innerText ?? ''; t.key('Escape'); await sleep(200);
      document.execCommand('undo'); document.execCommand('undo'); document.execCommand('undo'); pm.blur(); await sleep(400);
      const miss = ['Heading', 'Bullet', 'Numbered', 'Check', 'Code', 'Quote'].filter(x => !new RegExp(x, 'i').test(slash)); if (miss.length) t.fail('slash missing ' + miss + ' :: ' + slash.slice(0, 60)); if (!at.includes('Ada')) t.fail('mention: ' + at.slice(0, 40));
      return 'slash menu + people suggestions' + (orig ? '' : '');
    });
    await t.run('2.5 Attach a file from the create modal (uploaded on create, served back)', async () => {
      const file = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'harness.png', { type: 'image/png' });
      await t.nav('/team/CORE/all', 600); await t.press('c', {}, 650); await t.type(t.q('.cm-root input, .cm-root textarea'), 'Harness: attachment from modal', 200);
      const inp = t.q('.cm-root input[type=file]'); if (!inp) t.fail('no file input'); const dt = new DataTransfer(); dt.items.add(file); inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true })); await sleep(300);
      const chip = t.q('.cm-files')?.innerText.includes('harness.png'); t.key('Enter', { meta: true }); await sleep(1500);
      const s = await t.snap(); const iss = s.issues.find(i => i.title === 'Harness: attachment from modal'); const att = iss && s.attachments.find(a => a.issueId === iss.id && a.title === 'harness.png');
      if (!chip || !att) t.fail(`chip ${chip} attachment ${!!att}`); const res = await fetch(att.url); if (!res.ok) t.fail('served ' + res.status);
      return `uploaded (${att.size} bytes), served ${res.status}`;
    });
    await t.run('2.6 Attach a file and paste-style upload on the issue page', async () => {
      const id = (await t.issue('CORE-3')).id; await t.nav('/issue/CORE-3', 900); const inp = t.qa('input[type=file]').find(i => i.closest('.issue-col, .issue-main, .content')); if (!inp) t.fail('no issue file input');
      const dt = new DataTransfer(); dt.items.add(new File(['hello'], 'notes.txt', { type: 'text/plain' })); inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true })); await sleep(1300);
      const s = await t.snap(); if (!s.attachments.some(a => a.issueId === id && a.title === 'notes.txt')) t.fail('not attached'); return 'notes.txt attached to CORE-3';
    });
    await t.run('2.7 Cycle and Milestone pills in the create modal', async () => {
      const s = await t.snap(); const p = s.projects.find(x => s.milestones.some(m => m.projectId === x.id));
      await t.nav('/projects/' + p.id, 800); await t.press('c', {}, 650); const pills = t.q('.cm-pills').innerText; if (!pills.includes('Milestone') || !t.q('.cm-pills [title="Cycle"]')) t.fail(pills.replace(/\n/g, ' | '));
      await t.click(t.q('.cm-pills [title="Cycle"]'), 400); const cm = t.q('.menu:not(.closing)').innerText; await t.click(t.menuItem('Cycle'), 400);
      await t.type(t.q('.cm-root input, .cm-root textarea'), 'Harness: in a cycle', 200); t.key('Enter', { meta: true }); await sleep(1300);
      const made = (await t.snap()).issues.find(i => i.title === 'Harness: in a cycle'); if (!made?.cycleId) t.fail('cycle not set (⌘↵ after a pill menu)');
      return `pills shown; cycle menu: ${cm.replace(/\n/g, ' ').slice(0, 50)}; ⌘↵ after picking created it in a cycle`;
    });
  });

  /* ================= 3. triage ================= */
  S('triage', async t => {
    const s0 = await t.snap(); const ago = s0.teams.find(x => x.key === 'AGO'); const tri = s0.states.find(x => x.teamId === ago.id && x.type === 'triage');
    for (const title of ['Harness triage A', 'Harness triage B', 'Harness triage C', 'Harness triage D']) await t.post('/api/issues', { teamId: ago.id, title, stateId: tri.id });
    await t.sync();
    await t.run('3.1 Triage queue lists issues filed by agents and teammates', async () => { await t.nav('/team/AGO/triage', 900); const n = t.qa('.inbox-row').length; if (n < 4) t.fail(n + ' rows'); return n + ' waiting'; });
    await t.run('3.2 Accept (1) moves to Todo and advances', async () => {
      await t.nav('/team/AGO/triage', 900); const before = t.qa('.inbox-row').length; const title = (t.q('.inbox-row.selected .inbox-title') ?? t.q('.inbox-row .inbox-title')).innerText;
      await t.press('1', {}, 1100); const after = t.qa('.inbox-row').length; const s = await t.snap(); const st = s.states.find(x => x.id === s.issues.find(i => i.title === title).stateId);
      if (after !== before - 1 || st.type === 'triage') t.fail(`rows ${before}→${after} state ${st.type}`); return `accepted into ${st.name}; ${before}→${after}`;
    });
    await t.run('3.3 Duplicate (2) opens the issue picker; Decline (3) cancels', async () => {
      await t.nav('/team/AGO/triage', 900); await t.press('2', {}, 600); const dup = t.menuOpen(); await t.closeAll();
      const title = (t.q('.inbox-row.selected .inbox-title') ?? t.q('.inbox-row .inbox-title')).innerText; await t.press('3', {}, 1100);
      const s = await t.snap(); const st = s.states.find(x => x.id === s.issues.find(i => i.title === title).stateId); if (!dup || st.type !== 'canceled') t.fail(`dup ${dup} state ${st.type}`); return `picker opens; declined → ${st.name}`;
    });
    await t.run('3.4 Snooze (H) hides it until its time; Display › Show snoozed brings it back', async () => {
      await t.nav('/team/AGO/triage', 900); await t.openMenu('[title="Display options"]'); const sw = t.menuItem('Show snoozed'); if (sw?.getAttribute('aria-checked') === 'true') await t.click(sw, 500); await t.closeAll(); const before = t.qa('.inbox-row').length; const title = (t.q('.inbox-row.selected .inbox-title') ?? t.q('.inbox-row .inbox-title')).innerText;
      await t.press('h', {}, 600); if (!t.menuOpen()) t.fail('H'); await t.click(t.menuItem('Tomorrow') ?? t.qa('.menu:not(.closing) .menu-item')[0], 1100);
      const after = t.qa('.inbox-row').length; const iss = (await t.snap()).issues.find(i => i.title === title);
      await t.openMenu('[title="Display options"]'); await t.click(t.menuItem('Show snoozed'), 500); await t.closeAll(); const shown = t.qa('.inbox-row').length;
      await t.openMenu('[title="Display options"]'); await t.click(t.menuItem('Show snoozed'), 450);
      if (!iss.snoozedUntil || after !== before - 1 || shown !== before) t.fail(`rows ${before}→${after}, shown ${shown}, until ${iss.snoozedUntil}`); return `snoozed until ${iss.snoozedUntil.slice(0, 16)}`;
    });
    await t.run('3.5 Triage filters, ordering and "Create triage issue"', async () => {
      await t.nav('/team/AGO/triage', 900); await t.press('f', {}, 500); await t.type(t.qa('.menu:not(.closing) input').pop(), 'Harness triage', 400); await t.click(t.menuItem('Content') ?? t.qa('.menu:not(.closing) .menu-item')[0], 600); await t.closeAll();
      const pill = t.q('.filterbar')?.innerText ?? ''; const c = t.byText('Clear'); if (c) await t.click(c, 400);
      await t.openMenu('[title="Display options"]'); await t.click(t.menuItem('Newest first'), 450); await t.closeAll(); const newest = t.q('.inbox-row .inbox-title')?.innerText;
      await t.openMenu('[title="Display options"]'); await t.click(t.menuItem('Oldest first'), 450); await t.closeAll();
      await t.click('[title="Create triage issue"]', 650); const pills = t.q('.cm-pills')?.innerText ?? '';
      if (!pill.includes('Harness triage') || !pills.startsWith('Triage')) t.fail(`pill "${pill}" create "${pills.slice(0, 20)}"`); return `filter pill "${pill.replace(/\n/g, ' ')}"; newest first: ${newest}; + files into Triage`;
    });
  });

  /* ================= 4. issue page ================= */
  S('issue', async t => {
    await t.run('4.1 Breadcrumb names the source list; "n / total"; J/K moves through it', async () => {
      await t.nav('/team/CORE/active', 900); await t.press('j', {}, 300); await t.press('Enter', {}, 950); const h1 = location.hash; const top = t.q('.topbar').innerText; const pos = /(\d+)\s*\/\s*(\d+)/.exec(top);
      await t.press('j', {}, 950); const h2 = location.hash; await t.press('k', {}, 950); const h3 = location.hash;
      if (!h1.startsWith('#/issue/') || !/Core|Active/.test(top) || !pos || h2 === h1 || h3 !== h1) t.fail(`open ${h1} crumb ${top.slice(0, 40)} pos ${pos?.[0]} j ${h2} k ${h3}`); return `${pos[0]}; J/K ok`;
    });
    await t.run('4.2 Shortcut menus: S P A L ⇧D ⇧E ⇧C ⇧P ⇧M ⌘⇧P ⌘⇧M ⇧H, M then B/X/R/M', async () => {
      await t.nav('/issue/CORE-4', 900); const bad = [];
      for (const [k, o] of [['s'], ['p'], ['a'], ['l'], ['D', { shift: true }], ['E', { shift: true }], ['C', { shift: true }], ['P', { shift: true }], ['M', { shift: true }], ['p', { meta: true, shift: true }], ['m', { meta: true, shift: true }], ['H', { shift: true }]]) { await t.press(k, o, 470); if (!t.menuOpen()) bad.push(k); await t.closeAll(); }
      for (const k of ['b', 'x', 'r', 'm']) { await t.press('m', {}, 150); await t.press(k, {}, 470); if (!t.menuOpen()) bad.push('M→' + k); await t.closeAll(); }
      if (bad.length) t.fail('no menu for ' + bad); return '16 menus open';
    });
    await t.run('4.3 I, ⇧S, ⌥F, ⇧R, ⌘⇧O act on the open issue', async () => {
      await t.nav('/issue/CORE-4', 900); const s0 = await t.snap(); const me = s0.currentUser.id; const id = (await t.issue('CORE-4')).id; const bad = [];
      const a0 = (await t.issue('CORE-4')).assigneeId; await t.press('i', {}, 950); const a1 = (await t.issue('CORE-4')).assigneeId; await t.press('i', {}, 950); if (a0 === a1) bad.push('I');
      const sub = async () => (await t.snap()).subscriptions.some(x => x.issueId === id && x.userId === me); const s1 = await sub(); await t.press('S', { shift: true }, 950); const s2 = await sub(); await t.press('S', { shift: true }, 950); if (s1 === s2) bad.push('⇧S');
      const fav = async () => (await t.snap()).favorites.some(f => f.refId === id); const f1 = await fav(); await t.press('f', { alt: true }, 950); const f2 = await fav(); await t.press('f', { alt: true }, 950); if (f1 === f2) bad.push('⌥F');
      await t.press('R', { shift: true }, 500); if (!['TEXTAREA', 'INPUT'].includes(document.activeElement?.tagName)) bad.push('⇧R'); document.activeElement?.blur();
      await t.press('o', { meta: true, shift: true }, 700); if (!(t.q('.cm-root')?.innerText ?? '').includes('sub-issue')) bad.push('⌘⇧O');
      if (bad.length) t.fail('failed ' + bad); return 'all act';
    });
    await t.run('4.4 Property menus: filter field and number keys', async () => {
      await t.nav('/issue/CORE-4', 900); await t.press('s', {}, 500); const m = t.q('.menu:not(.closing)'); const items = [...m.querySelectorAll('.menu-item')]; const sel = items.findIndex(x => x.className.includes('selected'));
      const before = (await t.issue('CORE-4')).stateId; await t.press(String(sel === 0 ? 2 : 1), {}, 950); const after = (await t.issue('CORE-4')).stateId;
      if (after !== before) { await t.post(`/api/issues/${(await t.issue('CORE-4')).id}`, { stateId: before }, 'PATCH'); await t.sync(); }
      if (!m.querySelector('input') || after === before) t.fail(`filter ${!!m.querySelector('input')} changed ${after !== before}`); return 'filter field; digit picks';
    });
    await t.run('4.5 One activity timeline: events and comments by time', async () => {
      const s = await t.snap(); const k = await t.keyOf(s.comments[0].issueId); await t.nav('/issue/' + k, 900); const act = t.q('.activity');
      if (!act.querySelector('.cmt') || !/created|changed|moved|added|set/i.test(act.innerText)) t.fail('timeline'); return k + ': events + comments';
    });
    await t.run('4.6 Comment threads: post, react, reply, resolve, edit, delete', async () => {
      await t.nav('/issue/CORE-5', 900); const id = (await t.issue('CORE-5')).id;
      await t.write(t.qa('.ProseMirror').pop(), 'Harness comment'); t.key('Enter', { meta: true }); await sleep(1200);
      let s = await t.snap(); const c = s.comments.find(x => x.issueId === id && x.body.includes('Harness comment')); if (!c) t.fail('not posted');
      const cmt = () => t.qa('.cmt').find(e => e.innerText.includes('Harness comment'));
      await t.click(cmt().querySelector('[title="Add reaction"]'), 400); await t.click(t.qa('.menu:not(.closing) .reaction-pick')[0], 700);
      await t.click(cmt().querySelector('[title="Reply"]'), 600); const replyBox = document.activeElement?.classList.contains('ProseMirror') ? document.activeElement : t.qa('.ProseMirror').filter(p => p.closest('.cmt-thread, .thread, .reply-box, .reply')).pop(); if (!replyBox) t.fail('no reply box'); await t.write(replyBox, 'Harness reply'); t.key('Enter', { meta: true }); await sleep(1200);
      await t.click(cmt().querySelector('[title="Resolve thread"]'), 900);
      s = await t.snap(); const c2 = s.comments.find(x => x.id === c.id); const reply = s.comments.find(x => x.parentId === c.id);
      await t.post(`/api/comments/${c.id}`, { resolved: false }, 'PATCH'); await t.sync(); await t.nav('/issue/CORE-5', 900);
      const r = t.qa('.cmt').find(e => e.innerText.includes('Harness reply')); await t.click(r.querySelector('[title="More"]'), 400); const menu = t.q('.menu:not(.closing)').innerText; await t.click(t.menuItem('Delete'), 900);
      s = await t.snap(); const gone = !s.comments.some(x => x.body.includes('Harness reply'));
      if (!Object.keys(c2.reactions).length || !reply || !c2.resolvedAt || !menu.includes('Edit') || !gone) t.fail(`react ${Object.keys(c2.reactions).length} reply ${!!reply} resolved ${!!c2.resolvedAt} edit ${menu.includes('Edit')} deleted ${gone}`);
      return 'posted, reacted, replied, resolved, edit offered, deleted';
    });
    await t.run('4.7 Subscribe / unsubscribe; subscribers shown', async () => {
      await t.nav('/issue/CORE-5', 900); const l0 = t.q('.subscribe-btn').innerText; await t.click(t.q('.subscribe-btn'), 900); const l1 = t.q('.subscribe-btn').innerText; await t.click(t.q('.subscribe-btn'), 900);
      if (l0 === l1) t.fail('no flip'); return `${l0} → ${l1}`;
    });
    await t.run('4.8 @mention notifies you; issue keys become links', async () => {
      const s = await t.snap(); const ada = s.users.find(u => u.name.startsWith('Ada')); const id = (await t.issue('CORE-6')).id;
      await t.post(`/api/issues/${id}/comments`, { body: `@${s.currentUser.name} can you check CORE-1?`, userId: ada.id }); await t.sync();
      const n = (await t.snap()).notifications.find(x => x.type === 'issueMentioned' && x.issueId === id); await t.nav('/issue/CORE-6', 900);
      const link = t.qa('.cmt a.issue-ref').find(a => a.textContent === 'CORE-1'); if (!n || !link) t.fail(`notified ${!!n} linked ${!!link}`); return 'notified; CORE-1 linked; mention chip ' + t.qa('.cmt .mention').length;
    });
    await t.run('4.9 ⌃L adds a link', async () => {
      await t.nav('/issue/CORE-6', 900); await t.press('l', { ctrl: true }, 500); const inp = t.qa('.menu:not(.closing) input')[0]; if (!inp) t.fail('⌃L');
      await t.type(inp, 'https://example.com/spec', 200); t.key('Enter'); await sleep(900); const id = (await t.issue('CORE-6')).id;
      if (!(await t.snap()).attachments.some(a => a.issueId === id && a.url.includes('example.com/spec'))) t.fail('not saved'); return 'link attached';
    });
    await t.run('4.10 Milestone in the rail', async () => {
      const s = await t.snap(); const i = s.issues.find(x => x.milestoneId); const k = await t.keyOf(i.id); await t.nav('/issue/' + k, 900); const ms = s.milestones.find(m => m.id === i.milestoneId);
      if (!t.q('.props-rail').innerText.includes(ms.name)) t.fail('rail'); return `${k}: ${ms.name}`;
    });
    await t.run('4.11 Move to another team (⌘⇧M): new key, page follows', async () => {
      await t.nav('/issue/CORE-7', 900); const id = (await t.issue('CORE-7')).id; await t.press('m', { meta: true, shift: true }, 500); await t.click(t.menuItem('Agent Surface'), 1400);
      const s = await t.snap(); const iss = s.issues.find(x => x.id === id); const team = s.teams.find(x => x.id === iss.teamId); const h = location.hash;
      await t.post(`/api/issues/${id}/team`, { teamId: s.teams.find(x => x.key === 'CORE').id }); await t.sync();
      if (team.key !== 'AGO' || !h.includes(`AGO-${iss.number}`)) t.fail(`team ${team.key} page ${h}`); return `CORE-7 → AGO-${iss.number}`;
    });
    await t.run('4.12 Mark as duplicate (M then M): cancels and relates', async () => {
      const core = (await t.snap()).teams.find(x => x.key === 'CORE'); const { issue } = await t.post('/api/issues', { teamId: core.id, title: 'Harness duplicate source' }); await t.sync();
      const k = await t.keyOf(issue.id); await t.nav('/issue/' + k, 900); await t.press('m', {}, 150); await t.press('m', {}, 500); await t.type(t.qa('.menu:not(.closing) input')[0], 'CORE-1', 500); await t.click(t.qa('.menu:not(.closing) .menu-item')[0], 1200);
      const s = await t.snap(); const st = s.states.find(x => x.id === s.issues.find(i => i.id === issue.id).stateId); const rel = s.relations.find(r => r.issueId === issue.id && r.type === 'duplicate');
      if (st.type !== 'canceled' || !rel) t.fail(`state ${st.type} rel ${!!rel}`); return `${k} canceled; duplicate of ${await t.keyOf(rel.relatedIssueId)}`;
    });
    await t.run('4.13 Remind me (⇧H) creates a timed inbox reminder', async () => {
      await t.nav('/issue/CORE-8', 900); const id = (await t.issue('CORE-8')).id; await t.press('H', { shift: true }, 500); await t.type(t.qa('.menu:not(.closing) input')[0], 'in 2 hours', 300); t.key('Enter'); await sleep(1000);
      const n = (await t.snap()).notifications.find(x => x.type === 'issueReminder' && x.issueId === id); if (!n?.snoozedUntil) t.fail('no reminder'); return 'due ' + n.snoozedUntil.slice(11, 16) + ' UTC';
    });
    await t.run('4.14 Peek (Space) from a list; J moves the peek', async () => {
      await t.nav('/team/CORE/all', 900); await t.press('j', {}, 250); await t.press(' ', {}, 850); const p1 = t.q('.peek-panel')?.innerText.slice(0, 60); await t.press('j', {}, 850); const p2 = t.q('.peek-panel')?.innerText.slice(0, 60); await t.press(' ', {}, 600);
      if (!p1 || p1 === p2) t.fail(`peek ${!!p1} moved ${p1 !== p2}`); return 'opens and follows J';
    });
    await t.run('4.15 Archived (E) and trashed (⌘⌫) issue URLs open with Unarchive / Restore', async () => {
      await t.nav('/issue/CORE-9', 900); await t.press('e', {}, 1200); await t.nav('/issue/CORE-9', 900); const un = t.byText('Unarchive issue'); if (!un) t.fail('no unarchive'); await t.click(un, 1000);
      await t.nav('/issue/CORE-9', 900); await t.press('Backspace', { meta: true }, 1200); await t.nav('/issue/CORE-9', 900); const re = t.qa('button').filter(t.vis).find(b => /Restore/.test(b.textContent)); if (!re) t.fail('no restore'); await t.click(re, 1000);
      if (!(await t.issue('CORE-9'))) t.fail('not back'); return 'Unarchive and Restore both bring it back';
    });
    await t.run('4.16 Create related → blocking issue is wired on create', async () => {
      await t.nav('/team/CORE/all', 900); const row = t.q('[data-issue-row]'); const src = row.getAttribute('data-issue-row'); await t.ctx(row); const cr = t.menuItem('Create related'); await t.hover(cr); await t.click(cr, 400);
      const sub = t.qa('.menu:not(.closing)').pop().innerText.replace(/\n/g, ', '); await t.click(t.menuItem('Blocking issue'), 700); await t.type(t.q('.cm-root input, .cm-root textarea'), 'Harness related blocker', 200); t.key('Enter', { meta: true }); await sleep(1300);
      const s = await t.snap(); const n = s.issues.find(i => i.title === 'Harness related blocker'); const rel = n && s.relations.find(r => [r.issueId, r.relatedIssueId].includes(n.id) && [r.issueId, r.relatedIssueId].includes(src));
      if (!rel) t.fail('no relation'); return `related (${rel.type}); options: ${sub.slice(0, 80)}`;
    });
    await t.run('4.17 Convert to project: sub-issues move in, issue archived', async () => {
      const core = (await t.snap()).teams.find(x => x.key === 'CORE'); const { issue } = await t.post('/api/issues', { teamId: core.id, title: 'Harness convert me' }); await t.post('/api/issues', { teamId: core.id, title: 'Harness child', parentId: issue.id }); await t.sync();
      await t.nav('/issue/' + await t.keyOf(issue.id), 900); await t.click(t.q('.topbar .topbar-more'), 400); const c = t.menuItem('Convert to'); await t.hover(c); await t.click(c, 400); await t.click(t.menuItem('Project'), 1500);
      const s = await t.snap(); const p = s.projects.find(x => x.name === 'Harness convert me'); const ch = s.issues.find(i => i.title === 'Harness child');
      if (!p || ch?.projectId !== p.id || s.issues.some(i => i.id === issue.id)) t.fail('convert'); return 'project created, child moved';
    });
    await t.run('4.18 Convert to template / recurring issue', async () => {
      await t.nav('/issue/CORE-10', 900); const title = (await t.issue('CORE-10')).title; const open = async () => { await t.click(t.q('.topbar .topbar-more'), 400); const c = t.menuItem('Convert to'); await t.hover(c); await t.click(c, 400); };
      await open(); await t.click(t.menuItem('Template'), 900); await t.closeAll(); await open(); const r = t.menuItem('Recurring'); await t.hover(r); await t.click(r, 400); await t.click(t.menuItem('Every week'), 900);
      const s = await t.snap(); if (!s.templates.some(x => x.title === title) || !s.recurring.some(x => x.title === title)) t.fail('missing'); return 'template + weekly recurring';
    });
    await t.run('4.19 Customer requests on an issue', async () => {
      await t.nav('/issue/CORE-6', 900); await t.click('[title="Add customer request"]', 500); await t.click(t.menuItem('Acme Robotics'), 400);
      await t.type(t.q('.creq-form textarea'), 'Harness: they need this by Q1', 200); await t.click(t.byText('Add request'), 900);
      const id = (await t.issue('CORE-6')).id; const r = (await t.snap()).customerRequests.find(x => x.issueId === id && x.body.includes('Harness')); if (!r) t.fail('not saved');
      if (!t.q('[data-customer-requests]')?.innerText.includes('Acme Robotics')) t.fail('section not shown after adding'); return 'added from the toolbar icon; section appears with Acme Robotics';
    });
  });

  /* ================= 5. lists, filters, views ================= */
  S('lists', async t => {
    const clear = async () => { await t.closeAll(); const c = t.byText('Clear'); if (c) await t.click(c, 500); };
    await t.nav('/team/CORE/all', 900); await clear();
    await t.run('5.1 Filter menu lists every field', async () => {
      await t.nav('/team/CORE/all', 900); await t.press('f', {}, 500); const m = t.q('.menu:not(.closing)').innerText;
      const miss = ['Status', 'Assignee', 'Creator', 'Priority', 'Estimate', 'Labels', 'Relations', 'Sub-issues', 'Dates', 'Project', 'Milestone', 'Cycle', 'Subscribers', 'Links', 'Content'].filter(x => !m.includes(x));
      await t.click(t.menuItem('Dates'), 400); const d = t.q('.menu:not(.closing)').innerText; await t.closeAll(); const dmiss = ['Due date', 'Created date', 'Updated date'].filter(x => !d.includes(x));
      if (miss.length || dmiss.length) t.fail('missing ' + [...miss, ...dmiss]); return 'Linear’s groups; Dates › Due / Created / Updated; Advanced filter';
    });
    await t.run('5.2 Pills: field · operator · values · ×; is not; Clear; Save; hidden-by-filters footer', async () => {
      await t.nav('/team/CORE/all', 900); const n0 = t.rows(); await t.press('f', {}, 500); await t.click(t.menuItem('Priority'), 400); await t.click(t.menuItem('Urgent'), 400); await t.closeAll();
      const pill = t.q('.filterbar .fpill'); const parts = [...pill.querySelectorAll('.fp-part')].length; const n1 = t.rows(); const foot = t.q('.content').innerText.replace(/\n/g, ' ').match(/(\d+) issues? hidden by filters/)?.[0];
      await t.click(pill.querySelector('.fp-op'), 500); await t.closeAll(); const n2 = t.rows(); const save = !!t.byText('Save'); await clear(); const n3 = t.rows();
      if (parts < 4 || n1 >= n0 || n2 <= n1 || n3 !== n0 || !save || !foot) t.fail(`parts ${parts} rows ${n0}/${n1}/${n2}/${n3} save ${save} footer ${foot}`); return `rows ${n0}→${n1}→(is not) ${n2}→(clear) ${n3}; "${foot}"`;
    });
    await t.run('5.3 Display options: layout, grouping, sub-grouping, ordering, completed, sub-issues, triage, empty groups, properties', async () => {
      await t.nav('/team/CORE/all', 900); await t.openMenu('[title="Display options"]'); const m = t.q('.menu:not(.closing)').innerText;
      const miss = ['List', 'Board', 'Grouping', 'Sub-grouping', 'Ordering', 'recency', 'Completed issues', 'sub-issues', 'triage', 'empty groups', 'ID', 'Status', 'Assignee', 'Priority', 'Labels', 'Project', 'Cycle', 'Estimate', 'Due date', 'Milestone', 'Created', 'Updated'].filter(x => !new RegExp(x, 'i').test(m)); if (miss.length) t.fail('missing ' + miss); return 'all present';
    });
    await t.run('5.4 Board: swimlanes from sub-grouping, estimate sums in column headers', async () => {
      await t.nav('/team/CORE/all', 900); await t.press('b', { meta: true }, 700); await t.openMenu('[title="Display options"]');
      const row = t.qa('.menu:not(.closing) .dopts-row').find(r => /Rows|Sub-grouping/.test(r.innerText)); const b = row.querySelector('button, select'); await t.click(b, 400); await t.click(t.menuItem('Priority'), 600); await t.closeAll();
      const lanes = t.qa('[class*=lane]').length; const heads = t.qa('.board-col-header').map(h => h.innerText.replace(/\s+/g, ' ')).slice(0, 3).join(' / ');
      await t.openMenu('[title="Display options"]'); const row2 = t.qa('.menu:not(.closing) .dopts-row').find(r => /Rows|Sub-grouping/.test(r.innerText)); await t.click(row2.querySelector('button, select'), 400); await t.click(t.menuItem('No'), 500); await t.closeAll(); await t.press('b', { meta: true }, 600);
      if (!lanes) t.fail('no lanes'); return `${lanes} lane elements; ${heads}`;
    });
    await t.run('5.5 Right-click menu', async () => {
      await t.nav('/team/CORE/all', 900); await t.ctx(t.q('[data-issue-row]')); const m = t.q('.menu:not(.closing)').innerText;
      const miss = ['Status', 'Priority', 'Assignee', 'Labels', 'More properties', 'Create related', 'Mark as', 'Copy', 'Make a copy', 'Move', 'Open in', 'Favorite', 'Remind', 'Delete', 'Convert to'].filter(x => !new RegExp(x, 'i').test(m)); if (miss.length) t.fail('missing ' + miss); return m.split('\n').filter(x => x.length > 2).slice(0, 18).join(', ');
    });
    await t.run('5.6 Selection: X, ⇧-click, ⌘-click, ⌘A; bulk bar', async () => {
      await t.nav('/team/CORE/all', 900); await t.press('Escape', {}, 300); const r = () => t.qa('[data-issue-row]'); const n = () => t.qa('[data-issue-row].selected').length;
      await t.press('j', {}, 200); await t.press('x', {}, 400); const a = n(); const xi = r().findIndex(e => e.classList.contains('selected'));
      r()[xi + 3].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })); await sleep(400); const b = n();
      const target = r()[xi + 8]; target.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true })); await sleep(400); const c = n(); await sleep(300); const bar = t.q('.bulk-bar')?.innerText.replace(/\n/g, ' ') ?? ''; if (!bar.includes('selected')) t.fail('no bulk bar');
      await t.press('Escape', {}, 400); const e = n(); await t.press('a', { meta: true }, 500); const d = n(); await t.press('Escape', {}, 400);
      if (!(a === 1 && b > a && c === b + 1 && e === 0 && d >= r().length)) t.fail(`x ${a} ⇧ ${b} ⌘ ${c} esc ${e} ⌘A ${d}`); return `X ${a}, ⇧ ${b}, ⌘ ${c}, Esc ${e}, ⌘A ${d}; bar: ${bar.slice(0, 60)}`;
    });
    await t.run('5.7 Saved views: save as view, rename, dirty → Save / Discard', async () => {
      await t.nav('/team/CORE/all', 900); await t.press('f', {}, 500); await t.click(t.menuItem('Priority'), 400); await t.click(t.menuItem('High'), 400); await t.closeAll();
      await t.click(t.byText('Save'), 1000); const vh = location.hash; if (document.activeElement?.tagName === 'INPUT') { await t.type(document.activeElement, 'Harness view', 200); t.key('Enter'); await sleep(700); }
      await t.press('f', {}, 500); await t.click(t.menuItem('Assignee'), 400); await t.click(t.qa('.menu:not(.closing) .menu-item')[1], 400); await t.closeAll();
      const dirty = !!t.byText('Save view') && !!t.byText('Discard changes'); await t.click(t.byText('Discard changes'), 600); const clean = !t.byText('Save view'); const v = (await t.snap()).views.find(x => x.name === 'Harness view');
      await t.nav('/team/CORE/all', 700); await clear();
      if (!vh.startsWith('#/views/') || !v || !dirty || !clean) t.fail(`view ${vh} ${!!v} dirty ${dirty} clean ${clean}`); return 'saved, renamed, dirty → discarded';
    });
    await t.run('5.8 Views page: Issues · Projects tabs; ⌥V saves the list on screen', async () => {
      await t.nav('/views', 700); const tabs = t.q('.subnav').innerText; await t.nav('/projects', 900); await t.press('v', { alt: true }, 1300); const h = location.hash; const pv = (await t.snap()).views.filter(x => x.kind === 'projects').length;
      if (!tabs.includes('Issues') || !tabs.includes('Projects') || !h.startsWith('#/views/') || !pv) t.fail(`tabs ${tabs} hash ${h} pv ${pv}`); return `tabs Issues · Projects; ⌥V → ${h}`;
    });
    await t.run('5.9 Archive and Trash pages', async () => {
      const core = (await t.snap()).teams.find(x => x.key === 'CORE'); const { issue } = await t.post('/api/issues', { teamId: core.id, title: 'Harness trash me' }); await fetch(`/api/issues/${issue.id}`, { method: 'DELETE' }); await t.sync();
      await t.nav('/trash', 900); const listed = t.text().includes('Harness trash me'); const btns = t.qa('button').filter(t.vis).map(b => (b.title || b.textContent).trim()).join(' ');
      await t.nav('/team/CORE/archive', 900); const arch = t.text().includes('Archive');
      if (!listed || !/Restore/.test(btns) || !/Empty trash/.test(btns) || !arch) t.fail(`listed ${listed} btns ${btns.slice(0, 80)}`); return 'trash: Restore, Delete forever, Empty trash; archive page';
    });
    await t.run('5.10 Advanced filter: AND / OR groups', async () => {
      await t.nav('/team/CORE/all', 900); await t.press('f', {}, 500); await t.click(t.menuItem('Advanced filter'), 700);
      await t.click(t.qa('.adv-panel button')[0], 500); await t.click(t.menuItem('Priority'), 400); await t.click(t.menuItem('Urgent'), 600); await t.closeAll(); const one = t.rows();
      const pill = () => t.qa('.filterbar .fpill, .filterbar button').find(e => /Advanced|condition/i.test(e.innerText)); await t.click(pill(), 600);
      const add = [...t.q('.adv-panel').querySelectorAll('button')].find(b => /Filter|Add/.test(b.textContent)); await t.click(add, 500); await t.click(t.menuItem('Priority'), 400); await t.click(t.menuItem('High'), 600); await t.closeAll(); const and = t.rows();
      await t.click(pill(), 600); const op = [...t.q('.adv-panel').querySelectorAll('button, select')].find(b => /^(and|or)$/i.test(b.textContent.trim()) || b.tagName === 'SELECT'); if (op.tagName === 'SELECT') await t.type(op, 'or', 300); else { await t.click(op, 400); const o = t.menuItem('or') ?? t.menuItem('any'); if (o) await t.click(o, 400); } await t.closeAll(); const or = t.rows();
      await clear(); if (!(and === 0 && or > one)) t.fail(`one ${one} and ${and} or ${or}`); return `Urgent: ${one}; Urgent AND High: ${and}; Urgent OR High: ${or}`;
    });
  });

  /* ================= 6. projects ================= */
  S('projects', async t => {
    const P = async () => (await t.snap()).projects.find(x => x.name === 'Agent Handoff');
    await t.run('6.1 Projects list: health, priority, lead, target, issues, status %, labels', async () => {
      await t.nav('/projects', 900); const head = t.q('.plist-head').innerText; const miss = ['Health', 'Priority', 'Lead', 'Target date', 'Issues', 'Status'].filter(x => !head.includes(x));
      if (miss.length || !t.q('.plabel-chip') || !/No updates|On track/.test(t.text())) t.fail('missing ' + miss); return head.replace(/\n/g, ' · ') + ' + label chips';
    });
    await t.run('6.2 Projects filters (incl. labels) and display', async () => {
      await t.nav('/projects', 900); const n0 = t.qa('.pl-name').length; await t.press('f', {}, 500); const fm = t.q('.menu:not(.closing)').innerText; await t.click(t.menuItem('Labels'), 400); await t.click(t.menuItem('Apps'), 600); await t.closeAll(); const n1 = t.qa('.pl-name').length;
      await t.click(t.byText('Clear'), 400); await t.openMenu('[title="Display options"]'); const dm = t.q('.menu:not(.closing)').innerText;
      const fmiss = ['Status', 'Priority', 'Lead', 'Members', 'Health', 'Team', 'Labels', 'Target date'].filter(x => !fm.includes(x)); const dmiss = ['Grouping', 'Ordering', 'closed', 'Labels'].filter(x => !new RegExp(x, 'i').test(dm));
      if (fmiss.length || dmiss.length || n1 >= n0) t.fail(`f ${fmiss} d ${dmiss} rows ${n0}→${n1}`); return `labels filter ${n0}→${n1}; display ok`;
    });
    await t.run('6.3 Board and Timeline layouts', async () => {
      await t.nav('/projects', 900); await t.openMenu('[title="Display options"]'); await t.click(t.byText('Board'), 600); const b = !!t.q('[class*=board]'); await t.click(t.byText('Timeline'), 700); const tl = !!t.q('[class*=timeline]'); await t.click(t.byText('List'), 500);
      if (!b || !tl) t.fail(`board ${b} timeline ${tl}`); return 'both render';
    });
    await t.run('6.4 Named project statuses (incl. custom "In Review") in the status menu', async () => {
      const p = await P(); await t.nav('/projects/' + p.id, 900); await t.click('[data-pprop="status"]', 500); const m = t.q('.menu:not(.closing)').innerText; await t.click(t.menuItem('In Review'), 900);
      const s = await t.snap(); const p2 = s.projects.find(x => x.id === p.id); const st = s.projectStatuses.find(x => x.id === p2.statusId);
      if (!['Backlog', 'Planned', 'In Progress', 'In Review', 'Completed', 'Canceled'].every(x => m.includes(x)) || st?.name !== 'In Review' || p2.status !== 'started') t.fail(`${st?.name}/${p2.status}`); return 'set “In Review” (category: started)';
    });
    await t.run('6.5 Project page tabs; details panel (⌘I)', async () => {
      const p = await P(); await t.nav('/projects/' + p.id, 900); const tabs = t.q('.subnav').innerText; const d0 = !!t.q('.proj-details'); await t.press('i', { meta: true }, 500); const d1 = !!t.q('.proj-details'); await t.press('i', { meta: true }, 500);
      await t.nav(`/projects/${p.id}/issues`, 800); const n = t.rows(); if (!/Overview/.test(tabs) || !/Activity/.test(tabs) || d0 === d1 || !n) t.fail(`tabs ${tabs} details ${d0}/${d1} ${n}`); return `Overview · Activity · Issues (${n}); ⌘I toggles details`;
    });
    await t.run('6.6 Overview: hero, properties, resources, update, description, milestones, customer requests', async () => {
      const p = await P(); await t.nav('/projects/' + p.id, 900); const txt = t.text(); const miss = ['Properties', 'Resources', 'Description'].filter(x => !txt.includes(x));
      if (miss.length || !t.q('.proj-hero-icon') || !t.q('.res-chip') || !t.q('[title="Add customer request"]')) t.fail('missing ' + miss); return 'hero, properties, resources (+ customer request), update, description';
    });
    await t.run('6.7 Documents: from template via resources; editor page; team Documents tab', async () => {
      const p = await P(); await t.nav('/projects/' + p.id, 900); await t.click(t.byText('Add document or link…'), 500); const m = t.q('.menu:not(.closing)').innerText; await t.click(t.menuItem('Spec'), 1300);
      const title = t.q('.doc-title')?.value; const body = t.q('.doc-page .ProseMirror')?.innerText ?? ''; await t.nav('/team/CORE/overview/documents', 800); const listed = t.text().includes('Spec:');
      if (!m.includes('New document') || !m.includes('Add link') || title !== 'Spec: ' || !body.includes('Problem') || !listed) t.fail(`title "${title}" listed ${listed}`); return 'template applied; listed under the team';
    });
    await t.run('6.8 Milestones with progress', async () => {
      const p = await P(); await t.nav('/projects/' + p.id, 900); const txt = t.text(); if (!/Alpha/.test(txt) || !/\d+%/.test(txt)) t.fail('milestones'); return 'Alpha / Beta with %';
    });
    await t.run('6.9 Post an update with health; Activity tab', async () => {
      const p = await P(); await t.nav('/projects/' + p.id, 900); await t.click(t.q('.update-card.empty') ?? t.byText('New update'), 600);
      const pick = t.qa('.health-pick').find(b => b.innerText.includes('At risk')); if (pick) await t.click(pick, 200); await t.write(t.qa('.update-card .ProseMirror').pop(), 'Harness weekly update'); await t.click(t.byText('Post update'), 1100);
      const u = (await t.snap()).projectUpdates.find(x => x.body.includes('Harness weekly update')); await t.nav(`/projects/${p.id}/activity`, 800);
      if (!u || u.health !== 'atRisk') t.fail(`update ${!!u} ${u?.health}`); return 'posted (at risk); activity tab renders';
    });
    await t.run('6.10 Project templates', async () => {
      await t.nav('/projects', 800); await t.click(t.byText('New project'), 700); const b = t.qa('.modal button').find(x => /template/i.test(x.textContent)); await t.click(b, 500); const m = t.q('.menu:not(.closing)')?.innerText ?? ''; await t.closeAll();
      await t.nav('/settings/project-templates', 700); if (!m.includes('Feature launch') || !t.text().includes('Feature launch')) t.fail('template'); return 'offered in New project; managed in Settings › Projects › Templates';
    });
    await t.run('6.11 Dependencies from the properties "…" menu', async () => {
      const p = await P(); await t.nav('/projects/' + p.id, 900); await t.click('[data-pprop="more"]', 500); const m = t.q('.menu:not(.closing)').innerText; await t.click(t.menuItem('Dependencies'), 500);
      const target = t.qa('.menu:not(.closing) .menu-item').find(e => /Design System/.test(e.innerText)); if (target) await t.click(target, 900); const rel = (await t.snap()).projectRelations.find(r => r.relatedProjectId === p.id);
      if (!m.includes('Start date') || !m.includes('Labels') || !rel) t.fail(`menu ${m} rel ${!!rel}`); return '… menu: Start date, Dependencies, Labels; dependency added';
    });
    await t.run('6.12 Project labels: P then L, group exclusivity, settings page', async () => {
      const p = await P(); await t.nav('/projects/' + p.id, 900); await t.press('p', {}, 120); await t.press('l', {}, 650); const m = t.q('.menu:not(.closing)')?.innerText ?? '';
      await t.click(t.menuItem('Apps'), 800); await t.closeAll(); const s = await t.snap(); const id = n => s.projectLabels.find(x => x.name === n).id; const p2 = s.projects.find(x => x.id === p.id);
      await t.nav('/settings/project-labels', 700); const set = t.text();
      if (!m.includes('Area') || !p2.labelIds.includes(id('Apps')) || p2.labelIds.includes(id('Agents')) || !set.includes('New group')) t.fail(`menu ${m.slice(0, 30)} labels ${p2.labelIds}`); return 'P then L; Apps replaced Agents; settings lists groups';
    });
    await t.run('6.13 Project bell: per-project inbox notifications', async () => {
      const p = await P(); await t.nav('/projects/' + p.id, 900); await t.click('[data-project-bell]', 500); const m = t.q('.menu:not(.closing)').innerText; const on = t.qa('.menu:not(.closing) .mi-check.on').length; await t.click(t.menuItem('An issue is added'), 700);
      const s = await t.snap(); const sub = s.projectSubscriptions.find(x => x.projectId === p.id && x.userId === s.currentUser.id); const ada = s.users.find(u => u.name.startsWith('Ada'));
      await t.post('/api/issues', { teamId: p.teamId, title: 'Harness added to project by Ada', projectId: p.id, actorId: ada.id }); await t.sync();
      const n = (await t.snap()).notifications.find(x => x.type === 'projectIssueAdded' && x.projectId === p.id);
      if (!m.includes('Update schedule') || !sub?.issueAdded || !n) t.fail(`menu ${m.slice(0, 40)} sub ${sub?.issueAdded} notified ${!!n}`); return `toggled "issue added" (was ${on} on); Ada's new issue notified you`;
    });
    await t.run('6.14 Update schedule: weekly cadence, due hint, lead reminder in the inbox', async () => {
      const p = await P(); await t.nav('/projects/' + p.id, 900); const hint = t.q('.update-due')?.innerText ?? '';
      const s = await t.snap(); const lead = s.projects.find(x => x.leadId === s.currentUser.id && x.status !== 'completed'); await t.post(`/api/projects/${lead.id}`, { updateCadence: 'weekly' }, 'PATCH');
      await fetch('/api/bootstrap'); const r = (await t.snap()).notifications.filter(x => x.type === 'projectUpdateReminder');
      if (!hint) t.fail('no due hint'); return `hint: "${hint}"; reminders in inbox: ${r.length}`;
    });
    await t.run('6.15 Customer requests on a project', async () => {
      const s = await t.snap(); const m = s.projects.find(x => x.name === 'Mobile Companion'); await t.nav('/projects/' + m.id, 900); const txt = t.q('[data-customer-requests]')?.innerText ?? '';
      if (!txt.includes('Acme Robotics')) t.fail(txt.slice(0, 60)); return 'Acme Robotics request shown';
    });
  });

  /* ================= 7. cycles ================= */
  S('cycles', async t => {
    await t.run('7.1 Cycles page: timeline with current / upcoming / previous, capacity, success', async () => {
      await t.nav('/team/CORE/cycles', 900); const txt = t.text(); const miss = ['Current', 'Upcoming'].filter(x => !txt.includes(x)); if (miss.length) t.fail('missing ' + miss); return txt.split('\n').slice(0, 8).join(' · ').slice(0, 120);
    });
    await t.run('7.2 Cycle page: list/board, burn-up, breakdown', async () => {
      await t.nav('/team/CORE/cycles/current', 1000); const txt = t.text(); const chart = !!t.q('svg path, .burnup, [class*=burn]');
      if (!chart || !t.rows() || !/Assignees|Labels|Priority/.test(txt)) t.fail(`chart ${chart} rows ${t.rows()}`); return `${t.rows()} issues, burn-up chart, breakdown`;
    });
    await t.run('7.3 Cycle automation settings: length, cooldown, upcoming, rollover', async () => {
      const core = (await t.snap()).teams.find(x => x.key === 'CORE'); await t.post(`/api/teams/${core.id}`, { autoCycles: true }, 'PATCH'); await t.sync();
      await t.nav('/settings/team/CORE/cycles', 900); const txt = t.text(); const miss = ['Cycle duration', 'Cooldown', 'Upcoming', 'Roll over'].filter(x => !new RegExp(x, 'i').test(txt));
      await t.post(`/api/teams/${core.id}`, { autoCycles: false }, 'PATCH'); await t.sync(); if (miss.length) t.fail('missing ' + miss); return 'shown once automation is on';
    });
  });

  /* ================= 8. inbox ================= */
  S('inbox', async t => {
    await t.run('8.1 Inbox keys: U read/unread, H snooze, ⌫ delete; row menu', async () => {
      await t.nav('/inbox', 900); const sel = () => t.q('.inbox-row.selected'); if (!sel()) t.fail('no selection');
      const u0 = sel().classList.contains('unread'); await t.press('u', {}, 800); const u1 = sel()?.classList.contains('unread');
      await t.ctx(sel()); const menu = t.q('.menu:not(.closing)')?.innerText ?? ''; await t.closeAll();
      const n0 = t.qa('.inbox-row').length; await t.press('Backspace', {}, 900); const n1 = t.qa('.inbox-row').length;
      await t.press('h', {}, 600); const snooze = t.menuOpen(); await t.closeAll();
      if (u0 === u1 || n1 !== n0 - 1 || !snooze || !/Snooze/.test(menu)) t.fail(`U ${u0}/${u1} ⌫ ${n0}/${n1} H ${snooze}`); return `U flips, ⌫ ${n0}→${n1}, H opens snooze, menu: ${menu.replace(/\n/g, ', ').slice(0, 60)}`;
    });
    await t.run('8.2 Inbox filters (type incl. project kinds) and display', async () => {
      await t.nav('/inbox', 900); await t.openMenu('[title="Filter"]'); const m = t.q('.menu:not(.closing)').innerText; await t.closeAll(); await t.openMenu('[title="Display options"]'); const d = t.q('.menu:not(.closing)').innerText;
      const miss = ['Mentions', 'Project updates', 'Project activity', 'Update reminders'].filter(x => !m.includes(x)); const dmiss = ['Newest', 'snoozed', 'Priority', 'Focus'].filter(x => !new RegExp(x, 'i').test(d));
      if (miss.length || dmiss.length) t.fail(`filter ${miss} display ${dmiss}`); return 'type/from filters; ordering, snoozed, priority inbox, focus';
    });
    await t.run('8.3 Project notifications show and preview in the inbox', async () => {
      const s = await t.snap(); const ada = s.users.find(u => u.name.startsWith('Ada')); const p = s.projects.find(x => x.name === 'Agent Handoff');
      await t.post(`/api/projects/${p.id}/updates`, { userId: ada.id, body: 'Harness: Ada says we are on track', health: 'onTrack' }); await t.sync();
      await t.nav('/inbox', 900); const row = t.qa('.inbox-row').find(r => /added an issue to the project|project update|Project update due/i.test(r.innerText)); if (!row) t.fail('no project notification row');
      await t.click(row, 600); const prev = t.q('.proj-notice')?.innerText ?? ''; if (!prev.includes('Open project')) t.fail('no preview'); return row.innerText.replace(/\n/g, ' ').slice(0, 80);
    });
    await t.run('8.4 My issues: Assigned / Created / Subscribed / Activity', async () => {
      await t.nav('/my-issues', 900); const tabs = t.q('.subnav').innerText; if (!['Assigned', 'Created', 'Subscribed', 'Activity'].every(x => tabs.includes(x))) t.fail(tabs); return tabs.replace(/\n/g, ' · ');
    });
    await t.run('8.5 Priority inbox and Focus grouping', async () => {
      await t.nav('/inbox', 900); await t.openMenu('[title="Display options"]'); await t.click(t.rowSwitch('Enable priority inbox'), 500); await t.closeAll(); const h = t.qa('.inbox-group').map(g => g.innerText.split('\n')[0]);
      await t.openMenu('[title="Display options"]'); await t.click(t.menuItem('Focus'), 500); await t.closeAll(); const f = t.qa('.inbox-group').map(g => g.innerText.split('\n')[0]);
      await t.openMenu('[title="Display options"]'); await t.click(t.rowSwitch('Enable priority inbox'), 400); await t.click(t.menuItem('No grouping'), 400); await t.closeAll();
      if (!h.length || !f.length) t.fail(`priority ${h} focus ${f}`); return 'priority: ' + [...new Set(h)].join(', ') + ' · focus: ' + [...new Set(f)].join(', ');
    });
  });

  /* ================= 9. settings & workspace pages ================= */
  S('settings', async t => {
    await t.run('9.1 Settings nav mirrors Linear: Account · Issues · Projects · Features · Administration · Your teams', async () => {
      await t.nav('/settings/preferences', 800); const nav = t.q('.settings-nav').innerText; const miss = ['Preferences', 'Profile', 'Notifications', 'Issues', 'Projects', 'Statuses', 'Updates', 'Features', 'Documents', 'Customer requests', 'Pulse', 'Emojis', 'Security & access', 'Administration', 'Members', 'API', 'Import & export'].filter(x => !nav.includes(x));
      if (miss.length) t.fail('missing ' + miss); return 'all sections';
    });
    await t.run('9.2 Account pages: Preferences, Profile, Notifications', async () => {
      await t.nav('/settings/preferences', 700); const a = /home|week/i.test(t.text()); await t.nav('/settings/profile', 700); const b = /Name|Email/i.test(t.text()); await t.nav('/settings/notifications', 700); const c = /Priority inbox/.test(t.text()) && /Desktop/.test(t.text());
      if (!a || !b || !c) t.fail(`${a} ${b} ${c}`); return 'all three render with their fields';
    });
    await t.run('9.3 Project statuses settings: add, rename, delete a custom status', async () => {
      await t.nav('/settings/project-statuses', 800); const add = t.qa('.set-cat').find(c => c.innerText.startsWith('Planned')).querySelector('button'); await t.click(add, 400); await t.type(t.q('.set-list input'), 'Harness scoping', 200); t.key('Enter'); await sleep(900);
      let s = await t.snap(); const st = s.projectStatuses.find(x => x.name === 'Harness scoping'); if (!st) t.fail('not created');
      await t.post(`/api/project-statuses/${st.id}`, {}, 'DELETE'); s = await t.snap(); if (s.projectStatuses.some(x => x.id === st.id)) t.fail('not deleted'); return 'added under Planned, then deleted';
    });
    await t.run('9.4 Project updates settings: workspace update schedule', async () => {
      await t.nav('/settings/project-updates', 800); const sel = t.q('select[aria-label="Update schedule"]'); await t.type(sel, 'biweekly', 800); const f = (await t.snap()).workspace.features.updateCadence; await t.type(t.q('select[aria-label="Update schedule"]'), 'none', 600);
      if (f !== 'biweekly') t.fail('saved ' + f); return 'schedule saved';
    });
    await t.run('9.5 Documents settings: document templates', async () => {
      await t.nav('/settings/documents', 800); if (!t.text().includes('Spec')) t.fail('no template'); return 'template listed (used in 6.7)';
    });
    await t.run('9.6 Customer requests settings: enable, default team, statuses, tiers', async () => {
      await t.nav('/settings/customer-requests', 800); const txt = t.text(); const miss = ['Enable Customer requests', 'Default team', 'Customer statuses', 'Customer tiers', 'Active', 'Prospect'].filter(x => !txt.includes(x));
      await t.type(t.qa('.settings-content input').find(i => /New tier/.test(i.placeholder)), 'Enterprise', 200); t.key('Enter'); await sleep(800); const tier = (await t.snap()).customerTiers.find(x => x.name === 'Enterprise');
      if (miss.length || !tier) t.fail(`missing ${miss} tier ${!!tier}`); return 'all fields; tier added';
    });
    await t.run('9.7 Pulse settings and Pulse feed', async () => {
      await t.nav('/settings/pulse', 800); await t.type(t.q('select[aria-label="Pulse summary schedule"]'), 'daily', 700); const f = (await t.snap()).workspace.features;
      await t.nav('/pulse', 900); const cards = t.qa('.pulse-card').length; if (!f.pulseEnabled || f.pulseSchedule !== 'daily' || !cards) t.fail(`${f.pulseEnabled} ${f.pulseSchedule} cards ${cards}`);
      await fetch('/api/bootstrap'); const dig = (await t.snap()).notifications.some(x => x.type === 'pulseDigest'); return `${cards} updates in the feed; daily summary ${dig ? 'delivered to inbox' : 'scheduled'}`;
    });
    await t.run('9.8 Custom emojis: upload, react with it, :name: renders', async () => {
      await t.nav('/settings/emojis', 800); const svg = new File([`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="7" fill="#5e6ad2"/></svg>`], 'shipit.svg', { type: 'image/svg+xml' });
      const inp = t.q('.settings-content input[type=file]'); const dt = new DataTransfer(); dt.items.add(svg); inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true })); await sleep(300); await t.click(t.byText('Upload'), 1000);
      const e = (await t.snap()).emojis.find(x => x.name === 'shipit'); if (!e) t.fail('not uploaded');
      const id = (await t.issue('CORE-5')).id; await t.post(`/api/issues/${id}/comments`, { body: 'Harness :shipit:' }); await t.sync(); await t.nav('/issue/CORE-5', 900);
      const img = t.qa('.cmt img.custom-emoji').length; const c = t.qa('.cmt').find(x => x.innerText.includes('Harness')); await t.click(c.querySelector('[title="Add reaction"]'), 400); const inPicker = !!t.q('.menu:not(.closing) img.custom-emoji'); await t.closeAll();
      if (!img || !inPicker) t.fail(`rendered ${img} picker ${inPicker}`); return ':shipit: uploaded, rendered in a comment, offered in the reaction picker';
    });
    await t.run('9.9 Customers page, customer page, new issue from a customer', async () => {
      await t.nav('/customers', 900); const rows = t.qa('.wt-row').length; await t.click(t.qa('.wt-row').find(r => r.innerText.includes('Acme')), 800);
      const txt = t.text(); if (!txt.includes('Requests') || !txt.includes('Mobile Companion')) t.fail('customer page');
      await t.click(t.byText('New issue'), 700); await t.type(t.q('.cm-root input, .cm-root textarea'), 'Harness: asked for by Acme', 200); t.key('Enter', { meta: true }); await sleep(1600);
      const s = await t.snap(); const iss = s.issues.find(i => i.title === 'Harness: asked for by Acme'); const req = iss && s.customerRequests.find(r => r.issueId === iss.id);
      if (!req) t.fail('new issue not linked to the customer'); return `${rows} customers; Acme page lists requests; New issue → linked request`;
    });
    await t.run('9.10 Teams page and Members page', async () => {
      await t.nav('/teams', 800); const tt = t.q('.wt-head')?.innerText ?? ''; const tr = t.qa('.wt-row').length; await t.nav('/members', 800); const mt = t.q('.wt-head')?.innerText ?? ''; const mr = t.qa('.wt-row').length;
      if (!/Membership/.test(tt) || !/Last seen/.test(mt) || !tr || !mr) t.fail(`${tt} ${mt}`); return `${tr} teams (${tt.replace(/\n/g, ' · ')}); ${mr} members`;
    });
    await t.run('9.11 Customize sidebar: badge style and per-item visibility (hidden items move to More)', async () => {
      await t.nav('/inbox', 700); const more = t.qa('.sidebar .nav-item').find(b => b.innerText.trim() === 'More'); await t.click(more, 400); const mm = t.q('.menu:not(.closing)').innerText; await t.click(t.menuItem('Customize sidebar'), 700);
      await t.type(t.q('select[aria-label="Teams visibility"]'), 'show', 800); const shown = t.q('.sidebar').innerText.includes('Teams'); await t.type(t.q('select[aria-label="Default badge style"]'), 'dot', 700); const dot = !!t.q('.nav-dot');
      await t.type(t.q('select[aria-label="Teams visibility"]'), 'hide', 600); await t.type(t.q('select[aria-label="Default badge style"]'), 'count', 600);
      if (!mm.includes('Members') || !mm.includes('Teams') || !shown) t.fail(`more ${mm} shown ${shown}`); return `More: ${mm.replace(/\n/g, ', ')}; Teams shown when set; dot badges ${dot}`;
    });
    await t.run('9.12 Workspace settings: General, Teams, Members, Labels, Templates, Coding tools, Import & export', async () => {
      const bad = []; for (const sec of ['workspace', 'teams', 'members', 'labels', 'templates', 'handoff', 'data']) { await t.nav('/settings/' + sec, 500); if (t.text().length < 40) bad.push(sec); } if (bad.length) t.fail(bad); return 'all render';
    });
    await t.run('9.13 Per-team settings: triage, estimates, cycle automation, workflow, recurring', async () => {
      await t.nav('/settings/team/CORE', 900); const txt = t.text(); const miss = ['Triage', 'Estimate', 'Cycle', 'Workflow', 'Recurring'].filter(x => !new RegExp(x, 'i').test(txt)); if (miss.length) t.fail('missing ' + miss); return 'all sections';
    });
    await t.run('9.14 ? opens the help menu; ⌘/ opens the searchable shortcuts drawer', async () => {
      await t.nav('/inbox', 600); await t.press('?', {}, 600); const help = t.q('.menu:not(.closing)')?.innerText ?? ''; await t.closeAll();
      await t.press('/', { meta: true }, 600); const ov = t.q('.shortcuts-modal'); const inp = ov?.querySelector('input'); if (!inp) t.fail('no drawer'); await t.type(inp, 'save as view', 400); const txt = ov.innerText;
      if (!help.includes('Keyboard shortcuts') || !txt.includes('Save as view') || txt.includes('Open command menu')) t.fail(`help ${help.slice(0, 30)} drawer ${txt.slice(0, 60)}`); return 'help menu; drawer search narrows to Save as view';
    });
    await t.run('9.15 Personal API keys: create a read-only key, call the API with it, revoke it', async () => {
      await t.nav('/settings/security', 800); await t.click(t.byText('New API key'), 700); if (!location.hash.endsWith('/settings/security/new-api-key')) t.fail('form route ' + location.hash);
      await t.type('#api-key-name', 'Harness key', 150); await t.click(t.qa('.radio-row').find(r => r.innerText.includes('Only select permissions')).querySelector('input'), 300);
      await t.click(t.qa('.check-row').find(r => r.innerText.startsWith('Read')).querySelector('input'), 200); await t.click(t.byText('Create'), 900);
      const token = t.q('[data-api-token]')?.textContent; if (!token?.startsWith('bl_api_')) t.fail('no token shown');
      const h = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
      const read = (await fetch('/api/bootstrap', { headers: h })).status; const write = (await fetch('/api/issues', { method: 'POST', headers: h, body: JSON.stringify({ teamId: (await t.snap()).teams[0].id, title: 'x' }) })).status;
      const bad = (await fetch('/api/bootstrap', { headers: { Authorization: 'Bearer bl_api_nope' } })).status;
      await t.click(t.byText('Done'), 700); const mine = () => t.qa('[data-api-key]').find(r => r.querySelector('input')?.value === 'Harness key'); const row = mine(); if (!row?.innerText.includes('Last used')) t.fail('row ' + row?.innerText);
      await t.nav('/settings/api', 800); const issued = t.qa('[data-issued-keys] [data-api-key]').some(r => r.innerText.includes('Harness key'));
      await t.nav('/settings/security', 700); const r2 = mine(); const rv = [...r2.querySelectorAll('button')].find(b => b.textContent === 'Revoke'); await t.click(rv, 300); await t.click([...r2.querySelectorAll('button')].find(b => /Revoke\?/.test(b.textContent)), 800);
      const after = (await fetch('/api/bootstrap', { headers: h })).status;
      if (read !== 200 || write !== 403 || bad !== 401 || !issued || after !== 401) t.fail(`read ${read} write ${write} bad ${bad} issued ${issued} after ${after}`);
      return 'shown once; reads 200, writes 403, bad key 401; listed under Administration › API; revoked → 401';
    });
  });

  /* ================= 11. initiatives, releases, SLAs, asks, loops, GitHub ================= */
  S('more', async t => {
    await t.run('11.1 Initiatives: sidebar, G then N, create, add project, post update, status', async () => {
      await t.nav('/inbox', 500); if (!t.q('.sidebar').innerText.includes('Initiatives')) t.fail('no sidebar item');
      await t.press('g', {}, 120); await t.press('n', {}, 600); if (location.hash !== '#/initiatives') t.fail('G then N → ' + location.hash);
      await t.click(t.byText('New initiative'), 600); await t.type(t.q('.small-modal input'), 'Harness initiative', 200); await t.click(t.byText('Create initiative'), 1000);
      if (!location.hash.startsWith('#/initiatives/in_')) t.fail('not on the page: ' + location.hash);
      await t.click(t.byText('Add project…'), 500); await t.click(t.qa('.menu:not(.closing) .menu-item')[0], 800); await t.closeAll();
      await t.click(t.byText('Write an initiative update'), 400); await t.type(t.q('.ini-update-input'), 'Harness: kicking off', 200); await t.click(t.byText('Post update'), 900);
      await t.click('[data-iprop="status"]', 400); await t.click(t.menuItem('Active'), 800);
      const ini = (await t.snap()).initiatives.find(i => i.name === 'Harness initiative');
      if (!ini || ini.projectIds.length !== 1 || ini.status !== 'active' || ini.health !== 'onTrack') t.fail(`ini ${!!ini} projects ${ini?.projectIds.length} status ${ini?.status} health ${ini?.health}`);
      return 'created; project added; update posted (health on track); status Active';
    });
    await t.run('11.2 Project page shows its initiatives', async () => {
      const s = await t.snap(); const p = s.projects.find(x => x.name === 'Agent Handoff'); await t.nav('/projects/' + p.id, 900);
      const chip = t.q('[data-pprop="initiatives"]')?.innerText ?? ''; if (!chip.includes('Agent-first tracker')) t.fail(chip); return 'chip: ' + chip;
    });
    await t.run('11.3 Releases: create, add issues, issue Release property, ship it', async () => {
      await t.nav('/releases', 700); await t.type(t.q('.rel-new input'), 'v9.9.9', 150); t.key('Enter'); await sleep(1100);
      if (!location.hash.startsWith('#/releases/rl_')) t.fail('not on release page');
      await t.click(t.byText('Add issues'), 500); await t.click(t.qa('.menu:not(.closing) .menu-item')[0], 800); await t.closeAll();
      const rows = t.rows(); await t.click('[data-rprop="stage"]', 400); await t.click(t.menuItem('Released'), 800);
      const r = (await t.snap()).releases.find(x => x.name === 'v9.9.9'); const k = await t.keyOf((await t.snap()).issues.find(i => i.releaseId === r.id).id);
      await t.nav('/issue/' + k, 900); const rail = t.q('[data-prop="release"]')?.innerText;
      if (!rows || r.stage !== 'released' || !r.releasedAt || rail !== 'v9.9.9') t.fail(`rows ${rows} stage ${r.stage} rail ${rail}`); return `${k} in v9.9.9 (released); rail shows it`;
    });
    await t.run('11.4 SLAs: add a rule in settings; urgent issues get a deadline badge; SLA filter', async () => {
      await t.nav('/settings/slas', 700); const before = (await t.snap()).slaRules.length;
      await t.type(t.q('.sla-form > input'), 'Harness: high in 48h', 150); await t.click(t.qa('.sla-prios .prop-chip').find(b => b.innerText.includes('High')), 200); await t.type(t.q('input[aria-label="SLA hours"]'), '48', 150); await t.click(t.byText('Add rule'), 900);
      const s = await t.snap(); if (s.slaRules.length !== before + 1) t.fail('rule not added');
      const urgent = s.issues.find(i => i.priority === 1 && i.slaBreachesAt); if (!urgent) t.fail('no urgent issue with an SLA');
      await t.nav('/issue/' + await t.keyOf(urgent.id), 900); const badge = t.q('.props-rail .sla-badge')?.innerText;
      await t.nav('/team/CORE/all', 800); await t.press('f', {}, 500); await t.click(t.menuItem('SLA status'), 400); await t.click(t.menuItem('Within SLA'), 600); await t.closeAll(); const n = t.rows(); const c = t.byText('Clear'); if (c) await t.click(c, 400);
      if (!badge || !n) t.fail(`badge ${badge} filtered ${n}`); return `rule added; rail: "${badge}"; SLA filter → ${n} rows`;
    });
    await t.run('11.5 Asks: open a form, required check, submit → issue in triage', async () => {
      await t.nav('/asks', 700); await t.click(t.qa('.ask-card')[0], 700); await t.click(t.byText('Submit'), 600); const err = t.q('.ask-error')?.innerText ?? '';
      const inputs = t.qa('.ask-form .ask-q'); await t.type(inputs[0].querySelector('input'), 'Harness ask: export crashes', 150); const sel = inputs.map(q => q.querySelector('select')).find(Boolean); if (sel) await t.type(sel, sel.options[1].value, 150);
      await t.click(t.byText('Submit'), 1100); const done = t.q('.ask-done')?.innerText ?? '';
      const s = await t.snap(); const iss = s.issues.find(i => i.title === 'Harness ask: export crashes'); const st = iss && s.states.find(x => x.id === iss.stateId);
      if (!err.includes('Required') || !iss || st.type !== 'triage') t.fail(`err "${err}" issue ${!!iss} state ${st?.type}`); return `validation: "${err}"; ${done}`;
    });
    await t.run('11.6 Loops: build one in the editor, it fires on issue create; Run now logs', async () => {
      await t.nav('/settings/loops', 700); await t.click(t.byText('New loop'), 500); await t.type(t.q('.loop-editor input'), 'Harness loop', 150);
      await t.type(t.q('select[aria-label="Loop team"]'), (await t.snap()).teams.find(x => x.key === 'CORE').id, 200); await t.type(t.q('input[aria-label="Comment text"]'), 'Harness loop saw {issue.key}', 150); await t.click(t.byText('Create loop'), 900);
      const core = (await t.snap()).teams.find(x => x.key === 'CORE'); const { issue } = await t.post('/api/issues', { teamId: core.id, title: 'Harness loop target' }); await t.sync();
      const k = await t.keyOf(issue.id); const c = (await t.snap()).comments.find(x => x.issueId === issue.id && x.body.includes(`Harness loop saw ${k}`));
      await t.nav('/settings/loops', 700); const row = t.qa('.set-row').find(r => r.innerText.includes('Harness loop')); await t.click([...row.querySelectorAll('button')].find(b => b.textContent === 'Run now'), 900);
      const s2 = await t.snap(); const lp = s2.loops.find(l => l.name === 'Harness loop'); const runs = s2.loopRuns.filter(r => r.loopId === lp.id);
      if (!c || runs.length < 2) t.fail(`comment ${!!c} runs ${runs.length}`); return `commented on ${k}; ${runs.length} runs logged`;
    });
    await t.run('11.7 GitHub: settings, In Review state, PR links by branch, status follows the PR, PR row + filter', async () => {
      await t.nav('/settings/github', 900); const txt = t.text(); if (!txt.includes('GitHub CLI') || !txt.includes('Branch format')) t.fail('settings page');
      const sw = t.q('button[aria-label="Enable GitHub"]'); if (sw.getAttribute('aria-checked') !== 'true') await t.click(sw, 1200);
      const s = await t.snap(); const core = s.teams.find(x => x.key === 'CORE'); if (!s.states.some(x => x.teamId === core.id && x.name === 'In Review')) t.fail('no In Review state');
      const todo = s.issues.find(i => i.teamId === core.id && s.states.find(x => x.id === i.stateId).type === 'unstarted' && !s.issuePrs.some(l => l.issueId === i.id)); const k = await t.keyOf(todo.id);
      const pr = (st, rd) => t.post('/api/git/pull-requests', { repo: 'example/app', number: 777, title: 'Harness PR', body: '', url: 'https://github.com/example/app/pull/777', state: st, branch: `parth/${k.toLowerCase()}-harness`, base: 'main', author: 'parth', reviewDecision: rd, checks: 'success', updatedAt: new Date().toISOString(), mergedAt: st === 'merged' ? new Date().toISOString() : null });
      const name = async () => { const x = await t.snap(); return x.states.find(st => st.id === x.issues.find(i => i.id === todo.id).stateId).name; };
      await pr('open', null); const a = await name(); await pr('open', 'review_required'); const b = await name(); await pr('merged', 'approved'); const c = await name(); await t.sync();
      await t.nav('/issue/' + k, 900); const row = t.q('[data-pull-requests] .pr-row')?.innerText.replace(/\n/g, ' ') ?? '';
      await t.nav('/team/CORE/all', 800); await t.press('f', {}, 500); await t.click(t.menuItem('Pull requests'), 400); await t.click(t.menuItem('Merged PR'), 600); await t.closeAll(); const n = t.rows(); const cl = t.byText('Clear'); if (cl) await t.click(cl, 400);
      if (a !== 'In Progress' || b !== 'In Review' || c !== 'Done' || !row.includes('Harness PR') || !n) t.fail(`${a} → ${b} → ${c}; row "${row}"; filter ${n}`);
      return `${k}: ${a} → ${b} → ${c}; PR row shown; "Merged PR" filter → ${n}`;
    });
  });

  /* ================= 12. second side-by-side pass ================= */
  S('parity', async t => {
    await t.run('12.1 Create modal: Linear chrome (team key chip, pill properties, no scrim), V opens it full screen', async () => {
      await t.nav('/team/CORE/all', 600); await t.press('c', {}, 600); const head = t.q('.cm-header .cm-team')?.innerText.trim(); const scrim = getComputedStyle(t.q('.overlay')).backgroundColor; const pill = getComputedStyle(t.q('.cm-pills .prop-chip')).borderRadius; const assignee = t.qa('.cm-pills .prop-chip').map(b => b.innerText.trim()).find(x => /Assignee|Parth/.test(x));
      await t.closeAll(); await t.press('v', {}, 600); const full = !!t.q('.modal-create.expanded'); await t.closeAll();
      if (!head?.endsWith('CORE') || !/rgba\(0, 0, 0, 0\)|transparent/.test(scrim) || !pill.startsWith('9999') || assignee !== 'Assignee' || !full) t.fail(`head ${head} scrim ${scrim} pill ${pill} assignee ${assignee} full ${full}`);
      return 'CORE chip; no scrim; pill chips; unassigned by default (Auto-assign off); V → full screen';
    });
    await t.run('12.2 ⌘K lists Linear’s groups; O then U / O then L open pickers; user and label pages', async () => {
      await t.nav('/team/CORE/all', 500); await t.press('k', { meta: true }, 600); const heads = t.qa('.modal-palette .menu-header').map(h => h.innerText.trim()); await t.closeAll();
      const miss = ['Issues', 'Projects', 'Documents', 'Views', 'Initiatives', 'Filter', 'Templates', 'Navigation', 'Miscellaneous', 'Help'].filter(x => !heads.includes(x));
      await t.press('o', {}, 120); await t.press('u', {}, 600); const ph = t.q('.modal-palette input')?.placeholder; await t.press('Enter', {}, 900); const prof = location.hash.startsWith('#/profiles/') && t.text().includes('Assigned');
      await t.nav('/team/CORE/all', 500); await t.press('o', {}, 120); await t.press('l', {}, 600); await t.press('Enter', {}, 900); const lab = location.hash.startsWith('#/labels/') && !!t.q('.topbar .crumb-menu');
      if (miss.length || ph !== 'Open user…' || !prof || !lab) t.fail(`missing ${miss} ph ${ph} profile ${prof} label ${lab}`); return 'groups as Linear; O-pickers land on a profile and a label page';
    });
    await t.run('12.3 Filter menu folds dates into Dates; context menu matches Linear (More properties, Make a copy…, Move, Open in)', async () => {
      await t.nav('/team/CORE/all', 600); await t.press('f', {}, 500); const fm = t.q('.menu:not(.closing)').innerText; const dates = fm.includes('Dates') && !fm.includes('Created date'); await t.closeAll();
      await t.ctx(t.qa('[data-issue-row]')[2]); const cm = t.q('.menu:not(.closing)').innerText; await t.click(t.menuItem('Make a copy'), 700); const copy = !!t.q('.cm-title input')?.value; await t.closeAll();
      const miss = ['More properties', 'Create related', 'Mark as', 'Copy', 'Convert to', 'Make a copy', 'Move', 'Open in', 'Favorite', 'Remind me', 'Delete'].filter(x => !cm.includes(x));
      if (!dates || miss.length || !copy || cm.includes('Subscribe')) t.fail(`dates ${dates} missing ${miss} copy ${copy}`); return 'Dates submenu; Linear’s context menu; Make a copy prefills the create modal';
    });
    await t.run('12.4 Settings: Profile (picture, title, username), Notifications (priority + desktop), Preferences automations', async () => {
      await t.nav('/settings/profile', 600); const pr = t.text(); await t.nav('/settings/notifications', 600); const no = t.text(); await t.nav('/settings/notifications/desktop', 600); const de = t.text(); await t.nav('/settings/preferences', 600); const pf = t.text();
      const miss = [['Profile picture', pr], ['Title', pr], ['Username', pr], ['Priority inbox', no], ['Desktop', no], ['Reactions', de], ['Document changes', de], ['Auto-assign to self', pf], ['On move to started status', pf], ['Underline links', pf]].filter(([w, txt]) => !txt.includes(w)).map(([w]) => w);
      if (miss.length) t.fail('missing ' + miss); return 'all present';
    });
    await t.run('12.5 Team settings hub links to General, Members, labels, templates, recurring, statuses, workflows, triage, cycles', async () => {
      await t.nav('/settings/team/CORE', 700); const hub = t.text(); const pages = ['general', 'members', 'labels', 'templates', 'recurring', 'statuses', 'workflow', 'triage', 'cycles']; const bad = [];
      for (const pg of pages) { await t.nav('/settings/team/CORE/' + pg, 450); if (t.text().length < 80) bad.push(pg); }
      if (!hub.includes('Danger zone') || !hub.includes('Workflows & automations') || bad.length) t.fail('hub/pages ' + bad); return '9 subpages render';
    });
    await t.run('12.6 Workflows & automations: auto-close sub-issues when the parent closes', async () => {
      const s = await t.snap(); const core = s.teams.find(x => x.key === 'CORE'); const done = s.states.find(x => x.teamId === core.id && x.type === 'completed');
      await t.post(`/api/teams/${core.id}/workflow`, { closeSubIssues: true }, 'PUT');
      const { issue: parent } = await t.post('/api/issues', { teamId: core.id, title: 'Harness parent' }); const { issue: kid } = await t.post('/api/issues', { teamId: core.id, title: 'Harness kid', parentId: parent.id });
      await t.post(`/api/issues/${parent.id}`, { stateId: done.id }, 'PATCH'); const after = (await t.snap()).issues.find(i => i.id === kid.id);
      await t.post(`/api/teams/${core.id}/workflow`, { closeSubIssues: false }, 'PUT');
      if (after.stateId !== done.id) t.fail('sub-issue not closed'); return 'sub-issue moved to Done by the Automation agent';
    });
    await t.run('12.7 Search: one field, tabs for issues / projects / initiatives / documents', async () => {
      await t.nav('/search', 600); await t.type(t.q('.search-top input'), 'agent', 600); const kinds = new Set(t.qa('[data-search-row]').map(r => r.dataset.searchRow)); const tabs = t.qa('.subnav .seg').map(b => b.innerText.replace(/\d+/g, '').trim());
      await t.type(t.q('.search-top input'), '', 200);
      if (!kinds.has('Issue') || !kinds.has('Project') || tabs.join() !== 'All,Issues,Projects,Initiatives,Documents') t.fail(`kinds ${[...kinds]} tabs ${tabs}`); return [...kinds].join(', ');
    });
    await t.run('12.8 Team archive has Issues / Cycles / Recently deleted issues; unknown pages say Not found', async () => {
      await t.nav('/team/CORE/archive', 700); const tabs = t.qa('.subnav .seg').map(b => b.innerText.trim()).join(); await t.nav('/no-such-page', 500); const nf = t.text().includes('Not found');
      if (tabs !== 'Issues,Cycles,Recently deleted issues' || !nf) t.fail(`tabs ${tabs} notfound ${nf}`); return 'tabs; Not found page';
    });
    await t.run('12.9 Project board cards and timeline header follow Linear', async () => {
      await t.nav('/projects', 700);
      await t.click(t.q('[title="Display options"]'), 400); await t.click(t.byText('Board'), 500); await t.closeAll(); const card = t.q('.pcard'); const props = !!card?.querySelector('.pcard-props') && /issue/.test(card?.innerText ?? '');
      await t.click(t.q('[title="Display options"]'), 400); await t.click(t.byText('Timeline'), 600); await t.closeAll(); const today = t.q('.tl-today span')?.innerText ?? ''; const ctl = !!t.q('.tl-controls select');
      await t.click(t.q('[title="Display options"]'), 400); await t.click(t.byText('List'), 500); await t.closeAll();
      if (!props || !/^[A-Z]{3} \d+$/.test(today) || !ctl) t.fail(`card ${props} today ${today} controls ${ctl}`); return `cards with status/priority/lead + issue count; today pill ${today}`;
    });
    await t.run('12.10 Resting on a favorite project shows its preview card', async () => {
      await t.nav('/inbox', 500); const link = t.qa('.sidebar a.nav-item').find(a => a.getAttribute('href')?.includes('/projects/') && a.innerText.includes('Agent Handoff')); if (!link) t.fail('no favorite');
      link.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body })); await sleep(800);
      const card = t.q('[data-hover-card]')?.innerText ?? ''; link.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })); await sleep(200);
      if (!card.includes('Agent Handoff') || !/% of \d+/.test(card)) t.fail('card ' + card.slice(0, 60)); return card.replace(/\n/g, ' · ').slice(0, 90);
    });
  });

  S('bell', async t => {
    await t.run('11.8 Team bell: toggles, and a teammate’s new issue notifies you', async () => {
      await t.nav('/team/CORE/all', 800); await t.click('[data-team-bell]', 500); const m = t.q('.menu:not(.closing)').innerText; await t.click(t.menuItem('An issue is added to the team'), 700); await t.closeAll();
      const s = await t.snap(); const core = s.teams.find(x => x.key === 'CORE'); const ada = s.users.find(u => u.name.startsWith('Ada'));
      if (!s.teamSubscriptions[core.id]?.issueAdded) t.fail('not saved');
      await t.post('/api/issues', { teamId: core.id, title: 'Harness bell issue', actorId: ada.id }); await t.sync();
      const n = (await t.snap()).notifications.find(x => x.type === 'teamActivity' && x.body.includes('added'));
      if (!m.includes('triage queue') || !n) t.fail(`menu ${m.slice(0, 40)} notified ${!!n}`); return 'three options; Ada\'s new issue → inbox: ' + n.body;
    });
  });

  /* ================= 10. every route renders without errors ================= */
  S('routes', async t => {
    await t.run('10.1 Every route renders without console errors', async () => {
      const s = await t.snap(); const p = s.projects[0].id; const d = s.docs[0].id; const c = s.customers[0].id; const cyc = s.cycles.find(x => x.teamId === s.teams[0].id).id;
      const routes = ['/inbox', '/my-issues', '/my-issues/created', '/my-issues/subscribed', '/my-issues/activity', '/drafts', '/projects', `/projects/${p}`, `/projects/${p}/activity`, `/projects/${p}/issues`, '/views', '/views/projects', ...s.views.map(v => `/views/${v.id}`), '/pulse', '/customers', `/customers/${c}`, '/teams', '/members', '/initiatives', '/initiatives/view/all', ...s.initiatives.map(i => `/initiatives/${i.id}`), '/releases', ...s.releases.map(r => `/releases/${r.id}`), '/asks', ...s.askForms.map(f => `/asks/${f.id}`),
        '/team/CORE/all', '/team/CORE/active', '/team/CORE/backlog', '/team/CORE/overview', '/team/CORE/overview/documents', '/team/CORE/overview/members', '/team/CORE/cycles', `/team/CORE/cycles/${cyc}`, '/team/CORE/projects', '/team/CORE/views', '/team/CORE/views/projects', '/team/AGO/triage', '/team/CORE/archive', '/trash', '/search', `/docs/${d}`, '/issue/CORE-1',
        ...['preferences', 'profile', 'notifications', 'shortcuts', 'labels', 'templates', 'project-labels', 'project-templates', 'project-statuses', 'project-updates', 'documents', 'customer-requests', 'pulse', 'emojis', 'slas', 'asks', 'loops', 'github', 'initiatives', 'releases', 'workspace', 'teams', 'members', 'security', 'security/new-api-key', 'api', 'handoff', 'data', 'new-team', 'team/CORE', 'team/AGO'].map(x => '/settings/' + x)];
      const errs = []; const orig = console.error; console.error = (...a) => { errs.push(location.hash + ' ' + a.map(String).join(' ').slice(0, 120)); orig(...a); };
      for (const r of routes) { location.hash = '#' + r; await sleep(420); }
      console.error = orig; if (errs.length) t.fail(errs.slice(0, 4).join(' | ')); return routes.length + ' routes, no console errors';
    });
  });
})();
