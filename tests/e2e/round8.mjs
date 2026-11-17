// Round 8 checks in the built app (layout, workspaces, wording, home, tours, help). Hidden + muted
// throughout: the speaker level (post-gain analyser) is measured whenever something plays and must be 0.
// No sound checks. Usage: node tests/e2e/round8.mjs [--dev] [--only=1,5]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, newProfileDir, ROOT, RESULTS, screenshot, sleep, td, windowInfo } from './harness.mjs';

const dev = process.argv.includes('--dev');
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
setTimeout(() => { console.error('GLOBAL TIMEOUT (15 min)'); process.exit(2); }, 15 * 60000).unref();
const report = { startedAt: new Date().toISOString(), mode: dev ? 'dev' : 'packaged', items: {}, soundChecks: [], speakerLevels: [] };
const want = (n) => !only || only.includes(String(n));

function record(item, data) {
  report.items[item] = { ...(report.items[item] ?? {}), ...data };
  console.log(`item ${item}:`, JSON.stringify(data).slice(0, 1500));
}
function check(cond, msg) {
  if (!cond) throw new Error('CHECK FAILED: ' + msg);
}
const ev = (page, fn, arg) => page.evaluate(fn, arg);
async function assertSilent(page, label, ms = 600) {
  const lv = await page.evaluate((m) => window.mgTest.levels(m), ms);
  const ok = lv.postPeak === 0;
  console.log(`  level[${label}] pre=${lv.prePeak.toFixed(4)} post(speakers)=${lv.postPeak} ${ok ? 'SILENT' : '!!! NOT SILENT'}`);
  report.speakerLevels.push({ label, pre: +lv.prePeak.toFixed(4), speakers: lv.postPeak });
  if (!ok) throw new Error(`Output not silent during ${label}`);
}
async function size(app, w, h) {
  await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [w, h]);
  await sleep(700);
}
async function example(page, id) {
  await ev(page, (i) => window.mgTest.openExample(i), id);
  await ev(page, () => window.mgTest.waitReady(60000));
  await ev(page, () => window.mgTest.waitRender().catch(() => {}));
  await sleep(300);
}
const click = (page, sel) => ev(page, (s) => {
  const el = document.querySelector(s);
  if (!el) throw new Error('not found: ' + s);
  el.click();
}, sel);
const exists = (page, sel) => ev(page, (s) => !!document.querySelector(s), sel);
/** Score area as a share of the window (inner) area. */
const scoreShare = (page) => ev(page, () => {
  const r = document.querySelector('.score').getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height), win: [innerWidth, innerHeight], share: +((r.width * r.height) / (innerWidth * innerHeight)).toFixed(3) };
});
/** Every interactive control in the page without a tooltip (own title or an enclosing titled label). */
const untitled = (page) => ev(page, () => {
  const sel = 'button, select, input, textarea, summary, [role=button], [role=tab]';
  const all = [...document.querySelectorAll(sel)];
  const bad = all.filter((el) => !(el.getAttribute('title') || el.closest('label[title]')))
    .map((el) => `${el.tagName.toLowerCase()}${el.dataset.testid ? '#' + el.dataset.testid : ''} "${(el.textContent || el.value || '').trim().slice(0, 30)}" in ${(el.closest('[data-testid]')?.dataset.testid) ?? el.parentElement?.className}`);
  const sig = all.map((el) => el.tagName + '|' + (el.dataset.testid ?? '') + '|' + (el.getAttribute('title') ?? '') + '|' + (el.textContent ?? '').trim().slice(0, 40));
  const help = [...document.querySelectorAll('[data-help]')].map((el) => el.dataset.help);
  return { count: all.length, sig, bad, help };
});

let app, page, profileDir;
try {
  profileDir = newProfileDir();
  ({ app, page } = await launch({ dev, profileDir }));
  const win = await windowInfo(app);
  const masterGain = await ev(page, () => window.mgTest.state().masterGain);
  console.log('window:', JSON.stringify(win), 'masterGain at start:', masterGain);
  if (win.some((w) => w.visible || w.focused)) throw new Error('Window became visible/focused!');
  if (masterGain !== 0) throw new Error('master gain not 0 at start');
  report.window = win;
  check(!(await ev(page, () => window.mgTest.tourState().running)), 'tour started in a hidden window without --tour');

  // ---------- 1: the music is the main thing on screen ----------
  if (want(1)) {
    const sizes = {};
    for (const [w, h] of [[1280, 720], [1920, 1080]]) {
      await size(app, w, h);
      await ev(page, () => { window.mgTest.resetLayout(); window.mgTest.closeDialogs(); window.mgTest.fullScore(false); window.mgTest.setWorkspace('arrange'); });
      await example(page, 'ode-to-joy');
      await sleep(500);
      const def = await scoreShare(page);
      const scaleFit = await ev(page, () => window.mgTest.scale());
      await screenshot(app, `r8-1-default-${w}x${h}`);
      await ev(page, () => window.mgTest.fullScore(true));
      await sleep(600);
      const full = await scoreShare(page);
      await screenshot(app, `r8-1-fullscore-${w}x${h}`);
      // F11 / Esc
      await ev(page, () => window.mgTest.key('Escape'));
      await sleep(200);
      const escBack = !(await ev(page, () => window.mgTest.ui().fullScore));
      await ev(page, () => window.mgTest.key('F11'));
      const f11 = await ev(page, () => window.mgTest.ui().fullScore);
      await ev(page, () => window.mgTest.key('Escape'));
      sizes[`${w}x${h}`] = { default: def, fullScore: full, fitScale: scaleFit, escReturns: escBack, f11 };
      check(def.share >= 0.6, `score share ${def.share} < 60 % at ${w}x${h}`);
      check(full.share > def.share && escBack && f11, 'full score / F11 / Esc');
    }
    // Zoom: Ctrl +, Ctrl -, Ctrl 0 (fit); Ctrl + wheel
    const z0 = await ev(page, () => window.mgTest.scale());
    await ev(page, () => window.mgTest.key('=', { ctrl: true }));
    await sleep(400);
    const zIn = await ev(page, () => window.mgTest.scale());
    await ev(page, () => window.mgTest.key('-', { ctrl: true }));
    await ev(page, () => window.mgTest.key('-', { ctrl: true }));
    await sleep(400);
    const zOut = await ev(page, () => window.mgTest.scale());
    await ev(page, () => document.querySelector('.score').dispatchEvent(new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true })));
    await sleep(300);
    const zWheel = await ev(page, () => window.mgTest.scale());
    await ev(page, () => window.mgTest.key('0', { ctrl: true }));
    await sleep(400);
    const zFit = await ev(page, () => ({ s: window.mgTest.scale(), zoom: window.mgTest.layout().zoom }));
    console.log('  zoom', z0, zIn, zOut, zWheel, JSON.stringify(zFit));
    check(zIn > z0 && zOut < zIn && zWheel > zOut && zFit.zoom === 'fit' && Math.abs(zFit.s - z0) < 0.01, 'zoom');
    // Page vs scrolling view
    await ev(page, () => window.mgTest.setLayout({ view: 'scroll' }));
    await ev(page, () => window.mgTest.waitRender().catch(() => {}));
    await sleep(500);
    const scrollW = await ev(page, () => document.querySelector('.at-host').scrollWidth);
    await screenshot(app, 'r8-1-scrolling-view');
    await ev(page, () => window.mgTest.setLayout({ view: 'page' }));
    await ev(page, () => window.mgTest.waitRender().catch(() => {}));
    await sleep(500);
    const pageW = await ev(page, () => document.querySelector('.at-host').scrollWidth);
    // Panels: fold, resize, remembered (localStorage)
    await click(page, '[data-testid="left-fold"]');
    const folded = await ev(page, () => !window.mgTest.layout().leftOpen && !!document.querySelector('[data-testid="left-rail"]'));
    await click(page, '[data-testid="left-rail"]');
    await ev(page, () => window.mgTest.setLayout({ leftW: 300 }));
    const stored = await ev(page, () => JSON.parse(localStorage.getItem('mg.layout.v1')));
    await page.reload();
    await page.waitForFunction(() => !!window.mgTest?.hasPlayer(), null, { timeout: 30000 });
    const afterReload = await ev(page, () => window.mgTest.layout());
    await ev(page, () => window.mgTest.resetLayout());
    record(1, { sizes, zoom: { start: z0, ctrlPlus: zIn, ctrlMinus2: zOut, ctrlWheel: zWheel, ctrl0: zFit }, view: { scrollWidthScroll: scrollW, scrollWidthPage: pageW }, foldRail: folded, remembered: { stored: stored.leftW, afterReload: afterReload.leftW } });
    check(scrollW > pageW * 1.5, 'scrolling view is not one long line');
    check(folded && stored.leftW === 300 && afterReload.leftW === 300, 'panel fold / size not remembered');
  }

  await size(app, 1440, 900);

  // ---------- 2: workspaces + where every former toolbar button lives ----------
  if (want(2)) {
    await example(page, 'ode-to-joy');
    const shots = {};
    for (const ws of ['arrange', 'write', 'mix', 'rec']) {
      await click(page, `[data-ws="${ws}"]`);
      if (ws === 'arrange') await ev(page, () => window.mgTest.setLayout({ rightOpen: true }));
      if (ws === 'write') { await click(page, '[data-testid="edit-toggle"]'); await ev(page, () => window.mgTest.setCursor({ track: 0, staff: 0, bar: 0, voice: 0, beat: 0, string: 1 })); }
      await sleep(700);
      const tabs = await ev(page, () => [...document.querySelectorAll('.dock-tabs > button[data-testid^="dock-"]')].map((b) => b.dataset.testid.slice(5)).filter((x) => x !== 'fold' && x !== 'track'));
      shots[ws] = { tabs, band: await exists(page, '[data-testid="band-panel"]'), file: await screenshot(app, `r8-2-workspace-${ws}`) };
      if (ws === 'write') await ev(page, () => window.mgTest.setEditMode(false));
    }
    await ev(page, () => window.mgTest.setLayout({ rightOpen: false }));
    check(shots.arrange.tabs.length === 0 && shots.arrange.band, 'arrange');
    check(shots.write.tabs.join() === 'roll,drums,chords,prog,lyrics,midi', 'write tabs ' + shots.write.tabs);
    check(shots.mix.tabs.join() === 'mixer,auto,audio,sounds', 'mix tabs ' + shots.mix.tabs);
    check(shots.rec.tabs.join() === 'rec', 'rec tabs');
    // Each former toolbar button -> where it is now. `setup` opens the place, `sel` must then exist.
    const places = [
      ['New ▾ > Guitar / Bass song', 'File > New > Guitar song / Bass song; Home > Write from scratch', 'file:new', 'xpath:Guitar song'],
      ['New ▾ > Chord chart…', 'File > New > Start from chords…; Home > Start from chords', 'file:new', '[data-testid="new-chart"]'],
      ['New ▾ > Describe a song…', 'File > New > Describe a song…; Home; Tools', 'file:new', '[data-testid="new-describe"]'],
      ['Open…', 'File > Open… (Ctrl+O); Home > Open sheet music…', 'file', '[data-testid="menu-open"]'],
      ['Save / Save As…', 'File > Save, Save as… (Ctrl+S / Ctrl+Shift+S)', 'file', 'xpath:Save as…'],
      ['Package…', 'File > Save as one file…', 'file', 'xpath:Save as one file…'],
      ['⇩ Export…', 'File > Export > Audio, MIDI, sheet music, PDF…; Mix workspace ⇩ Export…', 'file:export', '[data-testid="export-open"]'],
      ['↶ Undo / ↷ Redo', 'Edit > Undo / Redo (Ctrl+Z / Ctrl+Y)', 'edit', '[data-testid="menu-undo"]'],
      ['▶ Play / ■ Stop', 'Play bar', null, '[data-testid="play"]'],
      ['Loop / Metronome / Count-in / Speed', 'Play bar', null, '[data-testid="playbar"] input[type=range]'],
      ['Transpose song − / +', 'Arrange workspace (next to the tabs); Song > Transpose song up/down', 'ws:arrange', '[data-testid="transpose-total"]'],
      ['✎ Edit', 'Write workspace ✎ Write notes; Edit > ✎ Write notes', 'ws:write', '[data-testid="edit-toggle"]'],
      ['Song ▾ (key/time/tempo, chord chart)', 'Song > Key, time & tempo changes… / Edit chord chart…; play bar tempo', 'song', '[data-testid="open-changes"]'],
      ['🎹 Compose (piano roll, drums, chords, progressions, MIDI)', 'Write workspace tabs', 'ws:write', '[data-testid="dock-roll"]'],
      ['🎚 Mixer', 'Mix workspace > Mixer; Tools > Mixer', 'ws:mix', '[data-testid="dock-mixer"]'],
      ['🎧 Recording', 'Recordings workspace; Tools > Recording to sheet music', 'ws:rec', '[data-testid="dock-rec"]'],
      ['⌨ Keyboard piano', 'Write workspace; Edit > ⌨ Keyboard piano; MIDI keyboard tab', 'ws:write', '[data-testid="kbd-piano"]'],
      ['⇪ Rocksmith…', 'File > Export > Rocksmith 2014…; Recordings wizard last step', 'file:export', '[data-testid="rs-open"]'],
      ['🎸 Band', 'Arrange workspace right panel (🎸 Band rail); Song > Band…', 'ws:arrange', '[data-testid="right-rail"], [data-testid="band-panel"]'],
      ['⚙ Settings (SoundFont)', 'Tools > Load a sound set / Use the built-in sound set; Mix workspace ⚙ Settings', 'tools', 'xpath:Load a sound set'],
      ['Dock: Automation / Audio / Lyrics / Sounds', 'Mix: Changes over time, Audio tracks, Sounds; Write: Lyrics & singing', 'ws:mix', '[data-testid="dock-auto"]'],
    ];
    const where = [];
    for (const [old, now, setup, sel] of places) {
      await ev(page, () => window.mgTest.closeDialogs());
      if (setup?.startsWith('ws:')) await ev(page, (w) => window.mgTest.setWorkspace(w), setup.slice(3));
      else if (setup) await ev(page, (m) => window.mgTest.menu(m), setup);
      await sleep(150);
      const ok = sel.startsWith('xpath:')
        ? await ev(page, (t) => [...document.querySelectorAll('button')].some((b) => b.textContent.includes(t)), sel.slice(6))
        : await exists(page, sel);
      where.push({ old, now, ok });
    }
    await ev(page, () => window.mgTest.closeDialogs());
    record(2, { workspaces: shots, where });
    check(where.every((w) => w.ok), 'not reachable: ' + where.filter((w) => !w.ok).map((w) => w.old).join(', '));
  }

  // ---------- 3: plain words ----------
  if (want(3)) {
    const seen = new Set();
    const look = async () => { for (const t of await ev(page, () => document.body.innerText.split('\n').map((s) => s.trim()).filter(Boolean))) seen.add(t); };
    await example(page, 'ode-to-joy');
    for (const tab of ['roll', 'drums', 'chords', 'prog', 'lyrics', 'midi', 'mixer', 'auto', 'audio', 'sounds', 'rec']) {
      await ev(page, (t) => window.mgTest.openDock(t), tab);
      await sleep(250);
      await look();
    }
    await ev(page, () => window.mgTest.setWorkspace('arrange'));
    for (const m of ['file', 'file:export', 'edit', 'view', 'song', 'tools', 'help']) { await ev(page, (x) => window.mgTest.menu(x), m); await sleep(100); await look(); }
    await ev(page, () => window.mgTest.closeDialogs());
    await ev(page, () => window.mgTest.openDialogKind('export')); await sleep(200); await look();
    await ev(page, () => window.mgTest.closeDialogs());
    const text = [...seen].join('\n');
    const want3 = ['Split into instruments', 'Turn audio into notes', 'Save as one file', 'Changes over time', 'Split into melody / bass / harmony', 'Count-in (clicks before playing)',
      'Recording to sheet music', 'Compare with the recording', 'Snap to grid', 'Whole song (mixdown)', 'Sheet music'];
    const found = Object.fromEntries(want3.map((w) => [w, text.includes(w)]));
    const gone = ['Song to Rocksmith', 'Package…', '〰 Automation'].filter((w) => text.includes(w));
    record(3, { found, oldWordsStillShown: gone });
    check(Object.values(found).every(Boolean), 'missing plain words: ' + Object.entries(found).filter(([, v]) => !v).map(([k]) => k));
    check(!gone.length, 'old words still shown: ' + gone);
  }

  // ---------- 4: home screen ----------
  if (want(4)) {
    await ev(page, () => window.mgTest.showHome(true));
    await sleep(400);
    await screenshot(app, 'r8-4-home');
    const cards = {};
    // Open…: the native dialog is answered by the test (never shown).
    await ev(page, (p) => window.mgTest.answerOpenDialog(p), td('ode-to-joy-piano.musicxml'));
    await click(page, '[data-testid="home-open"]');
    await ev(page, () => window.mgTest.waitReady(60000));
    cards.open = await ev(page, () => window.mgTest.song().title);
    for (const [id, test] of [['describe', (u) => u.describe], ['chords', (u) => u.chart], ['recording', (u) => u.workspace === 'rec' && u.dock === 'rec' && !u.home], ['write', (u) => u.workspace === 'write']]) {
      await ev(page, () => { window.mgTest.closeDialogs(); window.mgTest.showHome(true); });
      await sleep(150);
      await click(page, `[data-testid="home-${id}"]`);
      await sleep(400);
      cards[id] = test(await ev(page, () => window.mgTest.ui()));
    }
    await ev(page, () => window.mgTest.closeDialogs());
    const ex = {};
    for (const id of await ev(page, () => window.mgTest.examples())) {
      await ev(page, () => window.mgTest.showHome(true));
      await sleep(150);
      const before = await ev(page, () => window.mgTest.song()?.title);
      await click(page, `[data-example="${id}"]`);
      for (let k = 0; k < 100; k++) { const u = await ev(page, () => ({ home: window.mgTest.ui().home, t: window.mgTest.song()?.title })); if (!u.home && u.t !== before) break; await sleep(100); }
      await ev(page, () => window.mgTest.waitReady(60000));
      ex[id] = await ev(page, () => ({ title: window.mgTest.song().title, tracks: window.mgTest.song().tracks.length, bars: window.mgTest.song().bars.length }));
    }
    await ev(page, () => window.mgTest.showHome(true));
    await sleep(300);
    const recent = await ev(page, () => window.mgTest.ui().recent);
    await screenshot(app, 'r8-4-home-recent');
    await ev(page, () => window.mgTest.showHome(false));
    record(4, { cards, examples: ex, recent });
    check(cards.open && cards.describe && cards.chords && cards.recording && cards.write, 'a home card did not open its flow');
    check(Object.keys(ex).length >= 4 && Object.values(ex).every((e) => e.tracks > 0 && e.bars > 0), 'examples');
    check(recent.length >= 1, 'recent files');
  }

  // ---------- 5: guided tours (automated clicks follow every step) ----------
  if (want(5)) {
    const tours = await ev(page, () => window.mgTest.tours());
    const results = [];
    for (const t of tours) {
      await ev(page, () => { window.mgTest.closeDialogs(); window.mgTest.stop(); window.mgTest.setEditMode(false); window.mgTest.openDock(null); window.mgTest.setWorkspace('arrange'); window.mgTest.resetLayout(); });
      // Start it from the Help menu like a user would.
      await ev(page, () => window.mgTest.menu(null));
      await click(page, '[data-menu="help"]');
      if (t.id === 'first') await click(page, '[data-testid="menu-tour"]');
      else {
        await ev(page, () => window.mgTest.menu('help:more'));
        await sleep(100);
        await click(page, `[data-testid="tour-${t.id}"]`);
      }
      await sleep(400);
      const steps = [];
      for (let i = 0; i < 30; i++) {
        let st = await ev(page, () => window.mgTest.tourState());
        for (let k = 0; k < 30 && st.running && !st.judged; k++) { await sleep(100); st = await ev(page, () => window.mgTest.tourState()); }
        if (!st.running) break;
        const before = st.step;
        let how = 'next';
        if (st.waits) {
          how = 'do';
          const sel = st.target;
          if (sel === '[data-tour="instrument"]') {
            await ev(page, (s) => {
              const el = document.querySelector(s);
              const opt = [...el.options].find((o) => o.value !== el.value && /guitar/i.test(o.textContent));
              Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, opt.value);
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }, sel);
          } else if (sel === '.score') await ev(page, () => window.mgTest.setCursor({ track: 0, staff: 0, bar: 0, voice: 0, beat: 0, string: 1 }));
          else if (sel === '[data-testid="editbar"]') await ev(page, () => window.mgTest.key('D'));
          else {
            for (let k = 0; k < 40 && !(await exists(page, sel)); k++) await sleep(100);
            await click(page, sel);
          }
          if (sel === '[data-tour="play"]') { await sleep(800); await assertSilent(page, `tour ${t.id}: play`); }
          for (let k = 0; k < 40; k++) { const s2 = await ev(page, () => window.mgTest.tourState()); if (!s2.running || s2.step !== before) break; await sleep(100); }
        } else {
          await click(page, '[data-testid="tour-next"]');
          await sleep(200);
        }
        const after = await ev(page, () => window.mgTest.tourState());
        steps.push({ step: before, target: st.target, found: st.found, how, moved: !after.running || after.step !== before });
        if (t.id === 'first' && before === 0) await screenshot(app, 'r8-5-tour-first-step1');
        if (t.id === 'first' && before === 3) await screenshot(app, 'r8-5-tour-first-band');
      }
      await ev(page, () => window.mgTest.stop());
      const end = await ev(page, () => window.mgTest.tourState());
      results.push({ id: t.id, steps: t.steps, done: steps.length, finished: !!end.last?.finished && end.last.id === t.id, allMoved: steps.every((s) => s.moved), targetsFound: steps.every((s) => s.found !== false), detail: steps });
    }
    await ev(page, () => window.mgTest.closeDialogs());
    // First-run: a fresh profile with --tour starts the tour by itself; skipping it is remembered.
    const p2 = newProfileDir();
    const second = await launch({ dev, profileDir: p2, extraArgs: ['--tour'] });
    await sleep(1500);
    const firstRun = await second.page.evaluate(() => window.mgTest.tourState());
    await second.page.evaluate(() => document.querySelector('[data-testid="tour-skip"]')?.click());
    await sleep(300);
    const settings = JSON.parse(readFileSync(join(p2, 'settings.json'), 'utf8'));
    await second.app.close();
    const third = await launch({ dev, profileDir: p2, extraArgs: ['--tour'] });
    await sleep(1500);
    const again = await third.page.evaluate(() => window.mgTest.tourState().running);
    await third.app.close();
    record(5, { tours: results.map(({ detail, ...r }) => r), firstRun: { started: firstRun.running && firstRun.id === 'first', skippedRemembered: settings.tourDone === true, notShownAgain: !again } });
    report.items[5].detail = results.map((r) => ({ id: r.id, steps: r.detail }));
    check(results.every((r) => r.finished && r.allMoved && r.targetsFound && r.done === r.steps), 'a tour did not complete: ' + JSON.stringify(results.filter((r) => !(r.finished && r.allMoved && r.targetsFound)).map((r) => r.id)));
    check(firstRun.running && settings.tourDone === true && !again, 'first-run tour');
  }

  // ---------- 6: help everywhere (tooltips on every control, a help page per panel) ----------
  if (want(6)) {
    await example(page, 'ode-to-joy');
    await rendered(page);
    const sigs = new Set();
    const bad = new Map();
    const helps = new Set();
    const views = [];
    const audit = async (name) => {
      await sleep(250);
      const r = await untitled(page);
      r.sig.forEach((s) => sigs.add(s));
      r.bad.forEach((b) => bad.set(b, name));
      r.help.forEach((h) => helps.add(h));
      views.push({ name, controls: r.count, untitled: r.bad.length });
    };
    await ev(page, () => window.mgTest.showHome(true)); await audit('home');
    await ev(page, () => window.mgTest.showHome(false));
    await ev(page, () => { window.mgTest.setWorkspace('arrange'); window.mgTest.setLayout({ rightOpen: true }); }); await audit('arrange');
    await ev(page, () => document.querySelectorAll('details').forEach((d) => { d.open = true; })); await audit('arrange (more options open)');
    await ev(page, () => window.mgTest.setLayout({ rightOpen: false }));
    for (const tab of ['roll', 'drums', 'chords', 'prog', 'lyrics', 'midi', 'mixer', 'auto', 'audio', 'sounds', 'rec']) {
      await ev(page, (t) => window.mgTest.openDock(t), tab);
      if (tab === 'roll') await ev(page, () => { window.mgTest.setEditMode(true); window.mgTest.setCursor({ track: 0, staff: 0, bar: 0, voice: 0, beat: 0, string: 1 }); });
      await sleep(300);
      await ev(page, () => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
      await audit('dock ' + tab);
    }
    await ev(page, () => window.mgTest.setEditMode(false));
    // A track with a drum part and a guitar (drum grid, tuning dialog): add the band.
    await ev(page, () => window.mgTest.setStyle('rock'));
    await ev(page, () => window.mgTest.clickGenerate());
    await ev(page, () => window.mgTest.waitReady(30000));
    const di = await ev(page, () => window.mgTest.song().tracks.findIndex((t) => t.instrument.percussion));
    await ev(page, (i) => { window.mgTest.setSelTrack(i); window.mgTest.openDock('drums'); }, di);
    await ev(page, () => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
    await audit('dock drums (drum track)');
    await ev(page, () => window.mgTest.openDock(null));
    for (const m of ['file', 'file:new', 'file:open recent', 'file:try an example', 'file:export', 'edit', 'view', 'song', 'tools', 'help', 'help:more']) {
      await ev(page, (x) => window.mgTest.menu(x), m);
      await audit('menu ' + m);
    }
    await ev(page, () => window.mgTest.menu(null));
    for (const k of ['chart', 'describe', 'changes', 'export', 'rs', 'tuning', 'chordpicker', 'confirm']) {
      await ev(page, () => window.mgTest.closeDialogs());
      await ev(page, (x) => window.mgTest.openDialogKind(x), k);
      await ev(page, () => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
      await audit('dialog ' + k);
      if (k === 'confirm') await ev(page, () => document.querySelector('[data-testid="confirm"] button')?.click());
    }
    await ev(page, () => window.mgTest.closeDialogs());
    await ev(page, () => window.mgTest.help('')); await audit('help topics');
    await ev(page, () => window.mgTest.help('mixer')); await audit('help page');
    await ev(page, () => window.mgTest.help(null));
    await ev(page, () => window.mgTest.fullScore(true)); await audit('full score');
    await ev(page, () => window.mgTest.fullScore(false));
    await ev(page, () => window.mgTest.tourStart('first')); await audit('tour');
    await ev(page, () => window.mgTest.tourStop());
    await ev(page, () => window.mgTest.help('')); await sleep(200);
    await screenshot(app, 'r8-6-help-topics');
    await ev(page, () => window.mgTest.help('recording-to-sheet-music')); await sleep(200);
    await screenshot(app, 'r8-6-help-page');
    await ev(page, () => window.mgTest.help(null));
    const topics = await ev(page, () => window.mgTest.helpTopics());
    const ids = new Set(topics.map((t) => t.id));
    const missingPages = [...helps].filter((h) => !ids.has(h));
    const badSteps = topics.filter((t) => t.steps !== 3).map((t) => t.id);
    record(6, { controlsChecked: sigs.size, untitled: [...bad.entries()].map(([b, v]) => `${b} (${v})`), helpButtons: helps.size, helpTopics: topics.length, missingPages, topicsWithout3Steps: badSteps, views });
    check(bad.size === 0, `${bad.size} controls without a tooltip`);
    check(!missingPages.length && !badSteps.length, 'help pages');
  }

  // ---------- 7: docs ----------
  if (want(7)) {
    const guide = join(ROOT, 'Docs', 'USER-GUIDE.md');
    const md = existsSync(guide) ? readFileSync(guide, 'utf8') : '';
    const titles = await ev(page, () => window.mgTest.helpTopics().map((t) => t.id));
    const vision = readFileSync(join(ROOT, 'Docs', 'VISION.md'), 'utf8');
    const claude = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8');
    record(7, { guideBytes: md.length, guideTopics: titles.filter((id) => md.includes(`<a id="${id}">`)).length, of: titles.length, visionBonus: /bonus/i.test(vision), claudeTooltipRule: /tooltip/i.test(claude) && /workspace/i.test(claude) });
    check(md.length > 1000 && titles.every((id) => md.includes(`<a id="${id}">`)), 'user guide out of date (node scripts/make-user-guide.mjs)');
  }
  console.log('ROUND 8 CHECKS DONE');
} catch (e) {
  console.error('FAILED:', e.message);
  report.error = e.message;
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(RESULTS, 'report-round8.json'), JSON.stringify(report, null, 1));
  console.log('report:', join(RESULTS, 'report-round8.json'));
  try { await app?.close(); } catch { /* closed */ }
}

async function rendered(p) {
  await p.evaluate(() => window.mgTest.waitRender().catch(() => {}));
}
