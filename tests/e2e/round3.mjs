// Round 3 checks in the built app. Hidden + muted throughout (speaker level measured 0 on every
// playing step). No sound checks this round: the backing-track check only needs the pre-gain level.
// Usage: node tests/e2e/round3.mjs [--dev] [--only=1,5]
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, newProfileDir, RESULTS, screenshot, sleep, td, windowInfo } from './harness.mjs';

const dev = process.argv.includes('--dev');
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
setTimeout(() => { console.error('GLOBAL TIMEOUT (12 min)'); process.exit(2); }, 12 * 60000).unref();
const report = { startedAt: new Date().toISOString(), mode: dev ? 'dev' : 'packaged', items: {}, soundChecks: [], speakerLevels: [] };
const want = (n) => !only || only.includes(String(n));
const REF = td('private/Husker-Du_Could-You-Be-The-One_v1_p.psarc');

function record(item, data) {
  report.items[item] = { ...(report.items[item] ?? {}), ...data };
  console.log(`item ${item}:`, JSON.stringify(data));
}
const ev = (page, fn, arg) => page.evaluate(fn, arg);
async function assertSilent(page, label, ms = 800) {
  const lv = await page.evaluate((m) => window.mgTest.levels(m), ms);
  const ok = lv.postPeak === 0;
  console.log(`  level[${label}] pre=${lv.prePeak.toFixed(4)} post(speakers)=${lv.postPeak} gain=${lv.masterGain} ${ok ? 'SILENT' : '!!! NOT SILENT'}`);
  report.speakerLevels.push({ label, pre: +lv.prePeak.toFixed(4), speakers: lv.postPeak });
  if (!ok) throw new Error(`Output not silent during ${label}`);
  return lv;
}
async function rendered(page, fn) {
  const r = page.evaluate(() => window.mgTest.waitRender());
  await fn();
  await r;
}
async function open(page, file) {
  await page.evaluate((p) => window.mgTest.open(p), file);
  await page.evaluate(() => window.mgTest.waitReady(60000));
}
// Round 8: the old toolbar buttons now live in the File menu (File > New, File > Export > Rocksmith 2014…).
const MENU_FOR = { New: 'file:new', '⇪ Rocksmith': 'file:export' };
const MENU_TEXT = { New: null, '⇪ Rocksmith': 'Rocksmith 2014' };
async function clickButton(page, startsWith) {
  if (startsWith in MENU_FOR) {
    await page.evaluate((m) => window.mgTest.menu(m), MENU_FOR[startsWith]);
    if (!MENU_TEXT[startsWith]) return;
    startsWith = MENU_TEXT[startsWith];
  }
  const ok = await page.evaluate((t) => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith(t) && !x.disabled);
    b?.click();
    return !!b;
  }, startsWith);
  if (!ok) throw new Error(`No enabled button "${startsWith}"`);
}
const key = (page, k, mods = {}) => page.evaluate(([kk, m]) => window.mgTest.key(kk, m), [k, mods]);
async function keys(page, list) {
  for (const k of list) {
    if (Array.isArray(k)) await key(page, k[0], k[1]);
    else await key(page, k);
  }
}
async function setSelect(page, selector, value) {
  await page.evaluate(([sel, v]) => {
    const el = document.querySelector(sel);
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(el, v);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, [selector, value]);
}
async function rockOde(page) {
  await open(page, td('ode-to-joy-piano.musicxml'));
  await ev(page, () => { window.mgTest.setSection(0, 7, 'Verse'); window.mgTest.setSection(8, 15, 'Chorus'); });
  await rendered(page, () => ev(page, () => window.mgTest.clickGenerate()));
  await page.evaluate(() => window.mgTest.waitReady(60000));
}
const countFiles = (dir) => (existsSync(dir) ? readdirSync(dir) : []);

let app, page, profileDir;
try {
  profileDir = newProfileDir();
  const exportRoot = join(profileDir, 'exports');
  mkdirSync(exportRoot, { recursive: true });
  ({ app, page } = await launch({ dev, profileDir }));
  await page.evaluate(() => window.mgTest.setLayout({ rightOpen: true })); // Round 8: band panel starts folded
  const win = await windowInfo(app);
  const masterGain = await ev(page, () => window.mgTest.state().masterGain);
  console.log('window:', JSON.stringify(win), 'masterGain at start:', masterGain);
  if (win.some((w) => w.visible || w.focused)) throw new Error('Window became visible/focused!');
  if (masterGain !== 0) throw new Error('master gain not 0 at start');
  report.window = win;
  await ev(page, (d) => window.mgTest.setExportDir(d), join(exportRoot, 'ui'));

  // ---------- 1: note editing (riff on a bass tab) ----------
  if (want(1)) {
    await page.evaluate(() => window.mgTest.hasPlayer());
    await clickButton(page, 'New');
    await rendered(page, () => clickButton(page, 'Bass song'));
    await sleep(200);
    // Eighth notes, then type a riff: bar 1 on the E string (two-digit 12 and 10), bar 2 on A and E.
    await clickButton(page, '♪');
    await keys(page, ['0', 'ArrowRight', '0', 'ArrowRight', '1', '2', 'ArrowRight', '0', 'ArrowRight', '1', '0', 'ArrowRight', '0', 'ArrowRight', '7', 'ArrowRight', '5']);
    await keys(page, ['ArrowRight', 'ArrowUp']); // bar 2, A string
    await clickButton(page, '♪');
    await keys(page, ['0', 'ArrowRight', '3', 'ArrowRight', '5', 'ArrowRight', '3', 'ArrowRight', 'ArrowDown', '5', 'ArrowRight', '3', 'ArrowRight', '0']);
    await keys(page, ['ArrowRight', '0', ['.'], ['h']]); // a dotted note... then a hammer-on? (no previous higher note: hammer-on)
    await page.evaluate(() => window.mgTest.waitRender().catch(() => {}));
    const notes = await ev(page, () => window.mgTest.notesOf(0));
    const st = await ev(page, () => window.mgTest.state());
    const frets = notes.map((n) => `${n[2]}:${n[3]}`).join(' ');
    // Undo the last edit (hammer-on), then redo it.
    await ev(page, () => window.mgTest.undo());
    const afterUndo = await ev(page, () => window.mgTest.notesOf(0));
    await ev(page, () => window.mgTest.redo());
    await ev(page, () => window.mgTest.scrollScoreToBar(0));
    await sleep(300);
    await screenshot(app, 'r3-1-bass-riff');
    // A generated band track becomes "edited" after a note edit.
    await rockOde(page);
    const bassIdx = await ev(page, () => window.mgTest.song().tracks.findIndex((t) => t.generated?.role === 'bass'));
    await ev(page, (i) => { window.mgTest.setEditMode(true); window.mgTest.setCursor({ track: i, staff: 0, bar: 0, voice: 0, beat: 0, string: 2 }); }, bassIdx);
    await key(page, '7');
    await sleep(300);
    const editedTag = await ev(page, () => [...document.querySelectorAll('.tag.edited')].map((x) => x.closest('.track')?.querySelector('.name')?.textContent));
    await ev(page, () => window.mgTest.setEditMode(false));
    record(1, {
      tuning: st.tracks[0].tuning, notes: notes.length, frets,
      expected: '1:0 1:0 1:12 1:0 1:10 1:0 1:7 1:5 2:0 2:3 2:5 2:3 1:5 1:3 1:0 1:0',
      lastNoteTechniques: notes[notes.length - 1][4], undoRemovedTechnique: afterUndo[afterUndo.length - 1][4] === '',
      generatedTrackMarkedEdited: editedTag,
    });
  }

  // ---------- 2: techniques ----------
  if (want(2)) {
    await clickButton(page, 'New');
    await rendered(page, () => clickButton(page, 'Guitar song'));
    await clickButton(page, '♪');
    // [technique key(s), fret] on string 3, one per 8th note across bars 1-3.
    const plan = [
      ['m', '5'], ['x', '5'], ['n', '7'], [['N', { shift: true }], '5'], ['v', '7'], ['b', '7'], ['b b', '7'], ['b b b b', '7'],
      ['s', '5'], [['S', { shift: true }], '5'], ['u', '9'], [['U', { shift: true }], '5'], ['t', '9'], ['k', '5'], ['o', '7'], ['>', '5'],
      ['w', '7'], ['h', '9'], ['h', '7'], ['p', '5'],
    ];
    await ev(page, () => window.mgTest.setCursor({ track: 0, staff: 0, bar: 0, voice: 0, beat: 0, string: 3 }));
    for (let i = 0; i < plan.length; i++) {
      const [tk, fret] = plan[i];
      const bar = Math.floor(i / 8);
      if (i % 8 === 0 && bar > 0) {
        await ev(page, (b) => window.mgTest.setCursor({ track: 0, staff: 0, bar: b, voice: 0, beat: 0, string: 3 }), bar);
        await clickButton(page, '♪');
      }
      await ev(page, ([b, k]) => window.mgTest.setCursor({ track: 0, staff: 0, bar: b, voice: 0, beat: k, string: 3 }), [bar, i % 8]);
      await key(page, fret);
      if (Array.isArray(tk)) await key(page, tk[0], tk[1]);
      else for (const k of tk.split(' ')) await key(page, k);
    }
    await page.evaluate(() => window.mgTest.waitRender().catch(() => {}));
    const before = await ev(page, () => window.mgTest.notesOf(0));
    await ev(page, () => window.mgTest.setEditMode(false));
    await ev(page, () => window.mgTest.scrollScoreToBar(0));
    await sleep(300);
    await screenshot(app, 'r3-2-techniques');
    // Played back (muted): the synth produces sound, speakers stay at 0.
    await ev(page, () => { window.mgTest.seekBar(0); window.mgTest.play(); });
    await sleep(600);
    const lv = await assertSilent(page, 'item2 techniques playing', 1000);
    await ev(page, () => window.mgTest.stop());
    // Save -> reopen keeps them.
    const file = join(profileDir, 'techniques.mgproj');
    await ev(page, (p) => window.mgTest.saveTo(p), file);
    await open(page, file);
    const after = await ev(page, () => window.mgTest.notesOf(0));
    record(2, {
      techniques: before.map((n) => n[4]),
      savedAndReopenedEqual: JSON.stringify(before) === JSON.stringify(after),
      playbackPrePeak: +lv.prePeak.toFixed(4), speakerPeak: lv.postPeak,
    });
  }

  // ---------- 3: tunings and capo ----------
  if (want(3)) {
    await clickButton(page, 'New');
    await rendered(page, () => clickButton(page, 'Guitar song'));
    await clickButton(page, '♩');
    await keys(page, ['0', 'ArrowRight', '3', 'ArrowRight', '5', 'ArrowRight', 'ArrowUp', '2']);
    const std = await ev(page, () => window.mgTest.notesOf(0));
    await rendered(page, () => setSelect(page, '[data-testid="tuning-select"]', 'drop-d'));
    const dropD = await ev(page, () => ({ tuning: window.mgTest.song().tracks[0].tuning, notes: window.mgTest.notesOf(0) }));
    await ev(page, () => window.mgTest.setEditMode(false));
    await sleep(300);
    await screenshot(app, 'r3-3-drop-d');
    // keep frets instead
    await ev(page, () => window.mgTest.undo());
    await ev(page, () => window.mgTest.setTuning(0, [38, 45, 50, 55, 59, 64], 'keepFrets'));
    const keepFrets = await ev(page, () => window.mgTest.notesOf(0));
    await ev(page, () => window.mgTest.setCapo(0, 2));
    const capo = await ev(page, () => ({ capo: window.mgTest.song().tracks[0].capo, notes: window.mgTest.notesOf(0) }));
    record(3, {
      standard: std.map((n) => `${n[1]}@${n[2]}:${n[3]}`).join(' '),
      dropDKeepPitch: dropD.notes.map((n) => `${n[1]}@${n[2]}:${n[3]}`).join(' '), tuning: dropD.tuning,
      dropDKeepFrets: keepFrets.map((n) => `${n[1]}@${n[2]}:${n[3]}`).join(' '),
      capo2: capo.notes.map((n) => `${n[1]}@${n[2]}:${n[3]}`).join(' '),
    });
  }

  // ---------- 4: the .NET helper ----------
  if (want(4)) {
    const ping = await ev(page, () => window.mgTest.rs('ping', {}));
    const wwise = await ev(page, () => window.mgTest.rs('findWwise', {}));
    const rocksmith = await ev(page, () => window.mgTest.rs('findRocksmith', {}));
    let list = null;
    if (existsSync(REF)) list = await ev(page, (p) => window.mgTest.rs('list', { psarc: p }), REF);
    record(4, { ping, wwise, rocksmith, referenceEntries: list?.entries.length ?? 'reference file missing', entries: list?.entries });
  }

  // ---------- 5: .psarc import + backing track in sync ----------
  if (want(5) && existsSync(REF)) {
    await open(page, REF);
    const imp = await ev(page, () => window.mgTest.rsImport());
    const st = await ev(page, () => window.mgTest.state());
    const onsets = await ev(page, () => window.mgTest.onsets(0));
    await ev(page, () => window.mgTest.scrollScoreToBar(0));
    await sleep(300);
    await screenshot(app, 'r3-5-psarc-bass');
    // Wait for the recording, mute the synth bass so only the recording sounds, play from 30 s.
    for (let i = 0; i < 100; i++) {
      const b = await ev(page, () => window.mgTest.backing());
      if (b.status?.loaded || b.status?.error) break;
      await sleep(200);
    }
    const back0 = await ev(page, () => window.mgTest.backing());
    await ev(page, () => window.mgTest.setMixer(0, { mute: true }));
    await ev(page, () => window.mgTest.waitReady(30000));
    await ev(page, (ms) => window.mgTest.seekSongMs(ms), 30000 - back0.track.offsetMs);
    await ev(page, () => window.mgTest.play());
    await sleep(1200);
    const lv = await assertSilent(page, 'item5 backing track playing (synth bass muted)', 800);
    const probe = await ev(page, () => window.mgTest.backing());
    const bar = await ev(page, () => window.mgTest.state().player.currentBar);
    await ev(page, (b) => window.mgTest.scrollScoreToBar(Math.max(0, b - 1)), bar);
    await screenshot(app, 'r3-5-sync-30s');
    await ev(page, () => window.mgTest.stop());
    await sleep(300);
    const lvStop = await assertSilent(page, 'item5 after stop', 500);
    record(5, {
      title: st.title, tracks: st.tracks.map((t) => `${t.name} ${t.instrument} tuning ${t.tuning}`), bars: st.bars,
      arrangements: imp.arrangements, report: imp.report.arrangements,
      modelNoteOnsets: onsets, hardestLevelNotes: imp.arrangements[0].hardest?.total, sourceXmlHardest: imp.arrangements[0].sourceXmlHardest?.total,
      backing: { loaded: back0.status?.loaded, error: back0.status?.error, offsetMs: back0.track?.offsetMs, durationS: back0.probe?.duration },
      at30s: { audioSeconds: +probe.probe.audioSeconds.toFixed(3), expectedSeconds: +probe.probe.expectedSeconds.toFixed(3), driftMs: Math.round((probe.probe.audioSeconds - probe.probe.expectedSeconds) * 1000), paused: probe.probe.paused, currentBar: bar + 1 },
      prePeakBacking: +lv.prePeak.toFixed(4), speakerPeak: lv.postPeak, prePeakAfterStop: +lvStop.prePeak.toFixed(4),
    });
  }

  // ---------- 6: audio for export ----------
  if (want(6)) {
    await rockOde(page);
    const wav = join(exportRoot, 'ode-rock-mix.wav');
    const levelsDuring = page.evaluate(() => window.mgTest.levels(1500));
    const r = await ev(page, (p) => window.mgTest.renderAudio([], p), wav);
    const lv = await levelsDuring;
    report.speakerLevels.push({ label: 'item6 during offline render', pre: +lv.prePeak.toFixed(4), speakers: lv.postPeak });
    const without = await ev(page, () => {
      const s = window.mgTest.song();
      const ex = s.tracks.map((t, i) => (t.generated?.role === 'bass' || t.generated?.role === 'rhythm' ? i : -1)).filter((i) => i >= 0);
      return window.mgTest.renderAudio(ex);
    });
    record(6, {
      songMs: Math.round(r.songMs), wavMs: Math.round(r.wavMs), synthEndMs: Math.round(r.synthEndMs), diffMs: Math.round(Math.abs(r.wavMs - r.songMs)),
      renderMs: r.renderMs, fasterThanRealTime: +(r.songMs / r.renderMs).toFixed(1), peak: +r.peak.toFixed(3),
      wavBytes: statSync(wav).size, speakerPeakDuringRender: lv.postPeak,
      mixWithoutBassAndRhythm: { wavMs: Math.round(without.wavMs), peak: +without.peak.toFixed(3) },
    });
  }

  // ---------- 7: Rocksmith export through the dialog ----------
  if (want(7)) {
    if (!report.items[6]) await rockOde(page);
    await clickButton(page, '⇪ Rocksmith');
    await page.waitForSelector('[data-testid="rs-dialog"]');
    await sleep(800); // Wwise / Rocksmith lookups
    await screenshot(app, 'r3-7-export-dialog');
    const settings = await ev(page, () => window.mgTest.song().tracks.map((t) => t.name));
    await page.click('[data-testid="rs-export"]');
    let st = null;
    for (let i = 0; i < 300; i++) {
      st = await ev(page, () => window.mgTest.rsExportState());
      if (!st.running && (st.result || st.error)) break;
      await sleep(300);
    }
    await screenshot(app, 'r3-7-export-result');
    const r = st.result;
    record(7, {
      tracks: settings, error: st.error, stage: r?.stage, stageError: r?.error, issues: r?.issues, ddLevels: r?.arrangements,
      reports: r?.reports, audio: r?.audio, rs2dlc: r?.rs2dlc, files: r ? countFiles(r.outDir) : [],
    });
    await ev(page, () => window.mgTest.openRsExport(false));
    report.exported = r?.rs2dlc ?? null;
    report.exportedFrom = await ev(page, () => window.mgTest.song().tracks.map((t, i) => ({ i, name: t.name, role: t.generated?.role ?? null })));
    report.exportedNotes = await ev(page, () => window.mgTest.song().tracks.map((_, i) => window.mgTest.notesOf(i)));
    report.exportedBars = await ev(page, () => window.mgTest.state().bars);
    report.exportedArrangements = r?.arrangements?.map((a) => a.arrangement);
  }

  // ---------- 8: round trip ----------
  if (want(8) && report.exported) {
    const r7 = report.items[7];
    await open(page, report.exported);
    const back = await ev(page, () => ({ st: window.mgTest.state(), song: window.mgTest.song() }));
    const diffs = [];
    const strip = (list) => list.map((n) => n.slice(1)); // drop start ticks (shifted by the lead-in)
    // Match each exported part to the re-imported track of the same arrangement type.
    const compare = [];
    for (const rep of r7.reports) {
      const src = report.exportedFrom.find((t) => t.name === rep.track);
      const bi = back.song.tracks.findIndex((t) => t.rocksmith?.arrangement === rep.type);
      if (!src || bi < 0) { compare.push({ track: rep.track, missing: true }); continue; }
      const a = strip(report.exportedNotes[src.i]);
      const b = strip(await ev(page, (i) => window.mgTest.notesOf(i), bi));
      let mismatches = 0;
      for (let k = 0; k < Math.max(a.length, b.length); k++) {
        if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) {
          mismatches++;
          if (diffs.length < 8) diffs.push({ track: rep.track, k, exported: a[k], imported: b[k] });
        }
      }
      compare.push({ track: rep.track, as: back.song.tracks[bi].name, type: rep.type, exportedNotes: a.length, importedNotes: b.length, mismatches });
    }
    const tunings = back.song.tracks.map((t) => `${t.name}: ${t.tuning}`);
    record(8, {
      reopened: back.st.title, bars: back.st.bars, exportedBars: report.exportedBars, sections: back.song.sections.map((s) => `${s.bar + 1}:${s.name}`),
      compare, firstDiffs: diffs, tunings,
    });
    // The reference file's bass: import, export, compare note counts.
    if (existsSync(REF)) {
      await open(page, REF);
      const ref = await ev(page, () => ({ imp: window.mgTest.rsImport(), song: window.mgTest.song() }));
      const out = join(exportRoot, 'reference-bass');
      const res = await ev(page, ([dir, b]) => window.mgTest.exportRocksmith({
        title: 'reference', artist: 'test', arrangements: [{ trackId: 't1', type: 'Bass' }], audio: 'file',
        audioFile: b.path, audioOffsetMs: b.offsetMs,
      }, dir), [out, ref.song.backing]);
      const xml = res.xmlFiles[0];
      const readBack = await ev(page, (p) => window.mgTest.rs('readXml', { xml: p }), xml);
      record(8, {
        reference: {
          hardestInSource: ref.imp.arrangements[0].hardest?.total, importedOnsets: await ev(page, () => window.mgTest.onsets(0)),
          exportedNotes: res.reports[0].singleNotes + res.reports[0].chordNotes, exportedXmlNotes: readBack.arrangements[0].hardest?.total,
          stage: res.stage, issues: res.issues.map((i) => `${i.type}@${i.timeMs}`), ddLevels: res.arrangements[0]?.ddLevels,
          audio: res.audio,
        },
      });
      // The reference is copyrighted: delete the exported copy (chart + audio) right away.
      rmSync(out, { recursive: true, force: true });
    }
  }
  report.finalWindow = await windowInfo(app);
} catch (e) {
  console.error('FAILED:', e);
  report.error = String(e?.stack ?? e);
  process.exitCode = 1;
} finally {
  await app?.close().catch(() => {});
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(RESULTS, 'report-round3.json'), JSON.stringify(report, null, 1));
  // Imports of the reference song are unpacked into the throwaway profile: remove them.
  if (profileDir) rmSync(join(profileDir, 'rocksmith-import'), { recursive: true, force: true });
}
