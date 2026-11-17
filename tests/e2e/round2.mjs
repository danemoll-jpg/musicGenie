// Round 2 checks in the built app. Hidden + muted throughout, except two short sound checks
// (item 1: the new default SoundFont; item 7: the Rock arrangement), each reported.
// Usage: node tests/e2e/round2.mjs [--dev] [--only=1,6] [--no-sound-check]
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, newProfileDir, RESULTS, ROOT, screenshot, sleep, td, windowInfo } from './harness.mjs';

const dev = process.argv.includes('--dev');
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const noSound = process.argv.includes('--no-sound-check');
const SOUND_MS = { 1: 2000, 7: 4000 }; // both well under the 10 s limit
setTimeout(() => { console.error('GLOBAL TIMEOUT (10 min)'); process.exit(2); }, 10 * 60000).unref();
const report = { startedAt: new Date().toISOString(), mode: dev ? 'dev' : 'packaged', items: {}, soundChecks: [] };
const want = (n) => !only || only.includes(String(n));
const USER_SF = join(ROOT, 'src', 'renderer', 'public', 'soundfont', 'sonivox.sf2');

function record(item, data) {
  report.items[item] = { ...(report.items[item] ?? {}), ...data };
  console.log(`item ${item}:`, JSON.stringify(data));
}
const ev = (page, fn, arg) => page.evaluate(fn, arg);

async function levels(page, ms) {
  return page.evaluate((m) => window.mgTest.levels(m), ms);
}
async function assertSilent(page, label, ms = 800) {
  const lv = await levels(page, ms);
  const ok = lv.postPeak === 0;
  console.log(`  level[${label}] pre=${lv.prePeak.toFixed(4)} post(speakers)=${lv.postPeak} gain=${lv.masterGain} ${ok ? 'SILENT' : '!!! NOT SILENT'}`);
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
/** Sound check: unmute for `ms`, report it, re-mute and prove silence. */
async function soundCheck(page, item, label) {
  const ms = SOUND_MS[item];
  await assertSilent(page, `item${item} before sound check`, 400);
  const t0 = Date.now();
  await page.evaluate(() => window.mgTest.setMasterGain(0.5));
  const loud = await levels(page, ms);
  await page.evaluate(() => window.mgTest.setMasterGain(0));
  const unmutedMs = Date.now() - t0;
  await sleep(250);
  const after = await assertSilent(page, `item${item} after sound check`, 600);
  const sc = { item, what: label, unmutedMs, peakWhileUnmuted: +loud.postPeak.toFixed(4), peakAfterRemute: after.postPeak };
  report.soundChecks.push(sc);
  console.log(`  SOUND CHECK item ${item}: ${label}, unmuted ${unmutedMs} ms, speaker peak ${loud.postPeak.toFixed(4)}`);
  return sc;
}
/** Set a <select> in the band panel by one of its option values, the React way. */
async function setPanelSelect(page, hasOption, value) {
  await page.evaluate(([opt, v]) => {
    const sel = [...document.querySelectorAll('[data-testid="band-panel"] select')].find((s) => [...s.options].some((o) => o.value === opt));
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(sel, v);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }, [hasOption, value]);
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
/** Name bars a..b (0-based, inclusive) with the panel: select the bars, pick the name, press the button. */
async function nameBars(page, a, b, name) {
  await rendered(page, async () => {
    await ev(page, ([x, y]) => window.mgTest.selectBars(x, y), [a, b]);
    await sleep(100);
    await setPanelSelect(page, 'Chorus', name);
    await clickButton(page, 'Name bars');
  });
}
async function odeWithSections(page) {
  await open(page, td('ode-to-joy-piano.musicxml'));
  await nameBars(page, 0, 3, 'Intro');
  await nameBars(page, 4, 11, 'Verse');
  await nameBars(page, 12, 15, 'Chorus');
}
const showOnly = (page, pred) => page.evaluate((src) => {
  const f = new Function('t', `return (${src})(t)`);
  window.mgTest.song().tracks.forEach((t, i) => window.mgTest.setDisplay(i, { visible: !!f(t) }));
}, pred.toString());

let app, page, profileDir;
try {
  profileDir = newProfileDir();
  ({ app, page } = await launch({ dev, profileDir }));
  await page.evaluate(() => window.mgTest.setLayout({ rightOpen: true })); // Round 8: band panel starts folded
  const win = await windowInfo(app);
  const masterGain = await ev(page, () => window.mgTest.state().masterGain);
  console.log('window:', JSON.stringify(win), 'masterGain at start:', masterGain);
  if (win.some((w) => w.visible || w.focused)) throw new Error('Window became visible/focused!');
  if (masterGain !== 0) throw new Error('master gain not 0 at start');
  report.window = win;

  // ---------- 1: default SoundFont + Load SoundFont ----------
  if (want(1)) {
    await open(page, td('ode-to-joy-piano.musicxml'));
    const st0 = await ev(page, () => window.mgTest.state().player);
    await ev(page, () => { window.mgTest.seekBar(0); window.mgTest.play(); });
    await sleep(600);
    const lv = await assertSilent(page, 'item1 GeneralUser playing', 1000);
    let sound = null;
    if (!noSound) sound = await soundCheck(page, 1, 'Ode to Joy piano, GeneralUser GS');
    await ev(page, () => window.mgTest.stop());
    // Load a user SoundFont (no dialog in tests: the path is passed in), check it is used and remembered.
    const loads0 = st0.soundFontLoads;
    await ev(page, (p) => window.mgTest.chooseSoundFont(p), USER_SF);
    const loadedUser = await ev(page, (n) => window.mgTest.waitSoundFontLoads(n), loads0 + 1);
    await ev(page, () => window.mgTest.waitReady(30000));
    await ev(page, () => { window.mgTest.seekBar(0); window.mgTest.play(); });
    await sleep(600);
    const lvUser = await assertSilent(page, 'item1 user SoundFont playing', 800);
    await ev(page, () => window.mgTest.stop());
    const st1 = await ev(page, () => window.mgTest.state());
    await screenshot(app, 'r2-1-user-soundfont');
    record(1, {
      defaultSoundFont: st0.soundFont, defaultPrePeak: +lv.prePeak.toFixed(4), defaultSpeakerPeak: lv.postPeak, sound,
      userSoundFont: st1.player.soundFont, userLoaded: loadedUser, userPrePeak: +lvUser.prePeak.toFixed(4), userSpeakerPeak: lvUser.postPeak,
      songSoundFont: (await ev(page, () => window.mgTest.song().playback?.soundFont)) ?? null,
    });
  }
} catch (e) {
  console.error('FAILED:', e);
  report.error = String(e?.stack ?? e);
  process.exitCode = 1;
} finally {
  await app?.close().catch(() => {});
}

// Relaunch with the same profile: the SoundFont choice is remembered; then everything else.
try {
  ({ app, page } = await launch({ dev, profileDir }));
  await page.evaluate(() => window.mgTest.setLayout({ rightOpen: true })); // Round 8: band panel starts folded
  if (want(1) && !report.error) {
    await sleep(1500);
    const st = await ev(page, () => window.mgTest.state());
    await ev(page, (n) => window.mgTest.waitSoundFontLoads(n, 20000), 1);
    await sleep(500);
    const st2 = await ev(page, () => window.mgTest.state());
    record(1, { rememberedPath: st.soundFontPath, afterRelaunchSoundFont: st2.player.soundFont });
    await ev(page, () => window.mgTest.useDefaultSoundFont());
    await sleep(300);
    const back = await ev(page, () => window.mgTest.state());
    record(1, { backToDefault: back.player.soundFont, rememberedAfterReset: back.soundFontPath });
  }

  // ---------- 2: chord recognition ----------
  if (want(2)) {
    await open(page, td('bach-prelude-c-bwv846.mid'));
    await rendered(page, () => ev(page, () => window.mgTest.detectChords(false)));
    const bachChords = await ev(page, () => window.mgTest.song().chordSymbols.slice(0, 8).map((c) => `${c.bar + 1}:${c.name}`));
    await sleep(300);
    await screenshot(app, 'r2-2-bach-chords');
    await open(page, td('ode-to-joy-piano.musicxml'));
    const fileChords = await ev(page, () => window.mgTest.song().chordSymbols.length);
    await rendered(page, () => ev(page, () => window.mgTest.detectChords(false)));
    const keptFile = await ev(page, () => window.mgTest.song().chordSymbols.every((c) => c.source !== 'detected'));
    await rendered(page, () => ev(page, () => window.mgTest.detectChords(true)));
    const odeChords = await ev(page, () => window.mgTest.song().chordSymbols.map((c) => `${c.bar + 1}${c.tick ? '.3' : ''}:${c.name}`));
    await sleep(200);
    // Click the first drawn "C" above the score -> picker -> choose A minor -> Set.
    const clicked = await ev(page, () => window.mgTest.clickChordSymbol('C'));
    await sleep(300);
    const picker = (await ev(page, () => window.mgTest.state())).chordPicker;
    await screenshot(app, 'r2-2-chord-picker');
    await ev(page, () => window.mgTest.pickInChordPicker(9, 'min'));
    await rendered(page, () => ev(page, () => window.mgTest.applyChordPicker()));
    const changed = await ev(page, (p) => window.mgTest.song().chordSymbols.find((c) => c.bar === p.bar && c.tick === p.tick), picker);
    await sleep(200);
    await screenshot(app, 'r2-2-ode-chords-edited');
    record(2, { bachFirst8: bachChords, odeFileChords: fileChords, fileChordsKeptByDefault: keptFile, odeDetected: odeChords, clickedChord: clicked, picker, afterPick: changed });
  }

  // ---------- 3: split ----------
  if (want(3)) {
    await open(page, td('ode-to-joy-piano.musicxml'));
    const before = await ev(page, () => window.mgTest.state().notes);
    await rendered(page, () => ev(page, () => window.mgTest.splitTrack(0)));
    const st = await ev(page, () => window.mgTest.state());
    await rendered(page, () => ev(page, () => window.mgTest.setDisplay(0, { visible: false })));
    await sleep(300);
    await screenshot(app, 'r2-3-split-parts');
    record(3, { sourceNotes: before, totalNotesAfter: st.notes, tracks: st.tracks.map((t) => `${t.name}${t.mixer.mute ? ' (muted)' : ''}`) });
  }

  // ---------- 4: sections ----------
  if (want(4)) {
    await odeWithSections(page);
    await sleep(300);
    await screenshot(app, 'r2-4-sections');
    record(4, { sections: (await ev(page, () => window.mgTest.state().sections)) });
  }

  // ---------- 6: band panel, Rock ----------
  if (want(6)) {
    await odeWithSections(page);
    await ev(page, () => window.mgTest.setStyle('rock'));
    await rendered(page, () => ev(page, () => window.mgTest.clickGenerate()));
    const st = await ev(page, () => window.mgTest.state());
    await rendered(page, () => showOnly(page, (t) => !!t.generated));
    await sleep(400);
    await screenshot(app, 'r2-6-rock-generated');
    await ev(page, () => window.mgTest.scrollScoreToBar(6));
    await sleep(300);
    await screenshot(app, 'r2-6-rock-generated-bar7');
    // Try another: new seed, different notes.
    const h0 = await ev(page, () => JSON.stringify(window.mgTest.song().tracks.filter((t) => t.generated).map((t) => t.staves)));
    await rendered(page, () => ev(page, () => window.mgTest.tryAnother()));
    const h1 = await ev(page, () => JSON.stringify(window.mgTest.song().tracks.filter((t) => t.generated).map((t) => t.staves)));
    const seeds = await ev(page, () => window.mgTest.state().generated.map((g) => g.seed));
    // Hand-edit the bass (transpose that track), then Regenerate the Chorus: must ask first.
    const bassIdx = (await ev(page, () => window.mgTest.song().tracks.findIndex((t) => t.generated?.role === 'bass')));
    await rendered(page, () => ev(page, (i) => window.mgTest.transpose(1, i), bassIdx));
    const bassEdited = await ev(page, (i) => JSON.stringify(window.mgTest.song().tracks[i].staves), bassIdx);
    await ev(page, () => window.mgTest.regenerate({ sectionStartBar: 12 }));
    await sleep(300);
    const asked = (await ev(page, () => window.mgTest.state())).confirm;
    await screenshot(app, 'r2-6-regenerate-asks');
    await ev(page, () => window.mgTest.answer(false));
    const keptAfterCancel = (await ev(page, (i) => JSON.stringify(window.mgTest.song().tracks[i].staves), bassIdx)) === bassEdited;
    await ev(page, () => window.mgTest.regenerate({ sectionStartBar: 12 }));
    await rendered(page, () => ev(page, () => window.mgTest.answer(true)));
    const afterYes = await ev(page, (i) => window.mgTest.song().tracks[i].staves[0].measures.map((m) => JSON.stringify(m)), bassIdx);
    const editedBars = JSON.parse(bassEdited)[0].measures.map((m) => JSON.stringify(m));
    const changedBars = afterYes.map((m, i) => (m !== editedBars[i] ? i + 1 : 0)).filter(Boolean);
    record(6, {
      tracks: st.tracks.map((t) => `${t.name} [${t.mode}]${t.mixer.mute ? ' muted' : ''}`),
      tryAnotherChanged: h0 !== h1, seeds,
      regenerateAsked: asked?.message, keptAfterCancel, barsChangedByRegenerateChorus: changedBars,
    });
  }

  // ---------- 7: band playback, every style ----------
  if (want(7)) {
    const styles = ['rock', 'blues', 'country', 'jazz', 'pop'];
    const results = {};
    await odeWithSections(page);
    for (const style of styles) {
      await ev(page, (s) => window.mgTest.setStyle(s), style);
      await rendered(page, () => ev(page, () => window.mgTest.clickGenerate()));
      await ev(page, () => window.mgTest.waitReady(30000));
      const tracks = await ev(page, () => window.mgTest.song().tracks.map((t, i) => ({ i, role: t.generated?.role, name: t.name })));
      const gen = tracks.filter((t) => t.role);
      await ev(page, () => { window.mgTest.seekBar(0); window.mgTest.play(); });
      await sleep(700);
      const perTrack = {};
      for (const t of gen) {
        await ev(page, (i) => window.mgTest.setMixer(i, { solo: true }), t.i);
        await sleep(350);
        const lv = await levels(page, 900);
        await ev(page, (i) => window.mgTest.setMixer(i, { solo: false }), t.i);
        if (lv.postPeak !== 0) throw new Error(`speaker not silent (${style} ${t.role})`);
        perTrack[t.role] = +lv.prePeak.toFixed(4);
      }
      // Mixer on generated tracks: mute them all -> nothing plays (the source piano is muted too).
      for (const t of gen) await ev(page, (i) => window.mgTest.setMixer(i, { mute: true }), t.i);
      await sleep(500);
      const allMuted = await levels(page, 700);
      for (const t of gen) await ev(page, (i) => window.mgTest.setMixer(i, { mute: false }), t.i);
      await sleep(400);
      const all = await assertSilent(page, `item7 ${style} band`, 600);
      const p = await ev(page, () => window.mgTest.state().player);
      if (style === 'rock') {
        await screenshot(app, 'r2-7-rock-playing');
        if (!noSound) {
          await ev(page, () => { window.mgTest.seekBar(0); window.mgTest.play(); });
          await sleep(300);
          results.sound = await soundCheck(page, 7, 'Ode to Joy, Rock band (drums, bass, distortion guitar, lead)');
        }
      }
      await ev(page, () => window.mgTest.stop());
      results[style] = {
        perTrackPrePeak: perTrack, allPlayingPre: +all.prePeak.toFixed(4), speaker: all.postPeak,
        allGeneratedMutedPre: +allMuted.prePeak.toFixed(4), cursorBar: p.currentBar + 1, swing: p.swing,
      };
      console.log(`  ${style}:`, JSON.stringify(results[style]));
      // Mixer change undo entries are fine; undo the Generate so the next style starts clean.
    }
    record(7, results);
  }

  // ---------- 8: save / reopen + undo ----------
  if (want(8)) {
    await odeWithSections(page);
    await rendered(page, () => ev(page, () => window.mgTest.detectChords(true)));
    await rendered(page, () => ev(page, () => window.mgTest.setChord(3, 0, 'G7')));
    const beforeGen = await ev(page, () => window.mgTest.serialized());
    await ev(page, () => window.mgTest.setStyle('jazz'));
    await rendered(page, () => ev(page, () => window.mgTest.clickGenerate()));
    await rendered(page, () => ev(page, () => window.mgTest.regenerate({ sectionStartBar: 4 })));
    await rendered(page, () => ev(page, () => window.mgTest.setSwing(0.55)));
    await ev(page, (p) => window.mgTest.chooseSoundFont(p), USER_SF);
    await sleep(800);
    const saved = await ev(page, () => window.mgTest.serialized());
    const file = join(RESULTS, 'r2-saved.mgproj');
    if (existsSync(file)) rmSync(file);
    await ev(page, (f) => window.mgTest.saveTo(f), file);
    await open(page, file);
    const reopened = await ev(page, () => window.mgTest.serialized());
    const s = JSON.parse(saved).song;
    const r = JSON.parse(reopened).song;
    const deepEqual = JSON.stringify(s) === JSON.stringify(r);
    await screenshot(app, 'r2-8-reopened');
    // Undo: back past SoundFont, swing, regenerate, generate -> exactly the song before Generate.
    for (let i = 0; i < 4; i++) await ev(page, () => window.mgTest.undo());
    const afterUndo = await ev(page, () => window.mgTest.serialized());
    // (the reopened file has its own history; undo there starts from the reopen, so do it on a fresh run)
    await odeWithSections(page);
    await rendered(page, () => ev(page, () => window.mgTest.detectChords(true)));
    await rendered(page, () => ev(page, () => window.mgTest.setChord(3, 0, 'G7')));
    const b2 = await ev(page, () => window.mgTest.serialized());
    await rendered(page, () => ev(page, () => window.mgTest.clickGenerate()));
    const genSteps = await ev(page, () => window.mgTest.state().canUndo);
    await rendered(page, () => ev(page, () => window.mgTest.regenerate({ role: 'drums' })));
    await ev(page, () => window.mgTest.undo());
    await ev(page, () => window.mgTest.undo());
    const u2 = await ev(page, () => window.mgTest.serialized());
    await ev(page, () => window.mgTest.useDefaultSoundFont());
    record(8, {
      saveReopenDeepEqual: deepEqual, generatedTracks: r.tracks.filter((t) => t.generated).length,
      sectionSeedsKept: r.tracks.some((t) => t.generated?.sectionSeeds), sections: r.sections.length, chords: r.chordSymbols.length,
      swing: r.playback?.swing, soundFont: r.playback?.soundFont ?? null,
      undoAfterReopenNoHistory: afterUndo === reopened,
      undoGenerateAndRegenerateRestoresExactly: u2 === b2, canUndoAfterGenerate: genSteps, sameAsFirstRun: beforeGen === b2,
    });
  }
} catch (e) {
  console.error('FAILED:', e);
  report.error = String(e?.stack ?? e);
  process.exitCode = 1;
} finally {
  await app?.close().catch(() => {});
}

report.finishedAt = new Date().toISOString();
writeFileSync(join(RESULTS, 'report-round2.json'), JSON.stringify(report, null, 2));
console.log(`report: ${join(RESULTS, 'report-round2.json')}`);
