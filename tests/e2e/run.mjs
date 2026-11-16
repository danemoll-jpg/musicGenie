// Round 1 checks in the built app. Hidden + muted throughout, except ONE short sound check
// (item 6) that unmutes for SOUND_CHECK_MS and reports it.
// Usage: node tests/e2e/run.mjs [--dev] [--only=1,4,5] [--no-sound-check]
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, RESULTS, screenshot, sleep, td, windowInfo } from './harness.mjs';

const dev = process.argv.includes('--dev');
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const noSound = process.argv.includes('--no-sound-check');
const SOUND_CHECK_MS = 2000;
setTimeout(() => { console.error('GLOBAL TIMEOUT (8 min)'); process.exit(2); }, 8 * 60000).unref();
const report = { startedAt: new Date().toISOString(), mode: dev ? 'dev' : 'packaged', items: {} };
const want = (n) => !only || only.includes(String(n));

function record(item, data) {
  report.items[item] = { ...(report.items[item] ?? {}), ...data };
  console.log(`item ${item}:`, JSON.stringify(data));
}

async function assertSilent(page, label, ms = 1500) {
  const lv = await page.evaluate((ms) => window.mgTest.levels(ms), ms);
  const ok = lv.postPeak === 0;
  console.log(`  level[${label}] pre=${lv.prePeak.toFixed(4)} post(speakers)=${lv.postPeak} gain=${lv.masterGain} ${ok ? 'SILENT' : '!!! NOT SILENT'}`);
  if (!ok) throw new Error(`Output not silent during ${label}`);
  return lv;
}

async function waitBar(page, bar, timeoutMs = 20000) {
  return page.waitForFunction((b) => window.mgTest.state().player.currentBar >= b, bar, { timeout: timeoutMs, polling: 50 });
}

let app, page;
try {
  ({ app, page } = await launch({ dev }));
  const win = await windowInfo(app);
  const masterGain = await page.evaluate(() => window.mgTest.state().masterGain);
  console.log('window:', JSON.stringify(win), 'masterGain at start:', masterGain);
  if (win.some((w) => w.visible || w.focused)) throw new Error('Window became visible/focused!');
  if (masterGain !== 0) throw new Error('master gain not 0 at start');

  // ---------- 1: shell, hidden, muted ----------
  if (want(1)) {
    await screenshot(app, '1-app-start');
    await page.evaluate((p) => window.mgTest.open(p), td('ode-to-joy-piano.musicxml'));
    const ready = await page.evaluate(() => window.mgTest.waitReady(30000));
    await page.evaluate(() => window.mgTest.play());
    await sleep(500);
    const lv = await assertSilent(page, 'item1 playing', 2000);
    await page.evaluate(() => window.mgTest.stop());
    await screenshot(app, '1-app-hidden-muted');
    record(1, { window: win, playerReady: ready, levels: lv });
  }

  // ---------- 4: score view ----------
  if (want(4)) {
    const st = await page.evaluate((p) => window.mgTest.open(p), td('ode-to-joy-piano.musicxml'));
    await sleep(300);
    await screenshot(app, '4-piano-notation');
    await page.evaluate((p) => window.mgTest.open(p), td('full-song.gp'));
    // Show only the acoustic guitar track as notation + tab.
    const gi = (await page.evaluate(() => window.mgTest.state().tracks)).findIndex((t) => t.name.startsWith('Emmpu'));
    let r = page.evaluate(() => window.mgTest.waitRender());
    await page.evaluate((i) => window.mgTest.soloTrackOnly(i), gi);
    await r;
    r = page.evaluate(() => window.mgTest.waitRender());
    await page.evaluate((i) => window.mgTest.setDisplay(i, { mode: 'both' }), gi);
    await r;
    await page.evaluate(() => window.mgTest.scrollScoreToBar(20));
    await sleep(300);
    await screenshot(app, '4-guitar-notation-tab');
    r = page.evaluate(() => window.mgTest.waitRender());
    await page.evaluate((i) => window.mgTest.setDisplay(i, { mode: 'tab' }), gi);
    await r;
    await sleep(300);
    await screenshot(app, '4-guitar-tab-only');
    const vis = (await page.evaluate(() => window.mgTest.state().tracks)).map((t) => t.visible);
    record(4, { pianoTracks: st.tracks.length, guitarTrack: gi, visibleTracks: vis.filter(Boolean).length });
  }

  // ---------- 5: playback ----------
  if (want(5)) {
    await page.evaluate((p) => window.mgTest.open(p), td('ode-to-joy-piano.musicxml'));
    await page.evaluate(() => window.mgTest.waitReady(30000));
    // Play from the top; screenshot once the cursor reaches bar 3 (index 2).
    await page.evaluate(() => window.mgTest.play());
    await waitBar(page, 2);
    await sleep(400);
    const lv = await assertSilent(page, 'item5 playing', 800);
    const s1 = await page.evaluate(() => window.mgTest.state().player);
    await screenshot(app, '5-cursor-bar3');
    await page.evaluate(() => window.mgTest.pause());
    const pausedTick = (await page.evaluate(() => window.mgTest.state().player)).tick;
    await sleep(600);
    const stillTick = (await page.evaluate(() => window.mgTest.state().player)).tick;
    // Click-a-measure equivalent: seek to bar 9 and play.
    await page.evaluate(() => { window.mgTest.seekBar(8); window.mgTest.play(); });
    await sleep(700);
    const s2 = await page.evaluate(() => window.mgTest.state().player);
    await screenshot(app, '5-cursor-bar9-after-seek');
    await page.evaluate(() => window.mgTest.stop());
    await sleep(300);
    const s3 = await page.evaluate(() => window.mgTest.state().player);
    // Loop bars 5-6.
    await page.evaluate(() => { window.mgTest.selectBars(4, 5); window.mgTest.setPractice({ loop: true }); });
    await sleep(200);
    await page.evaluate(() => { window.mgTest.seekBar(4); window.mgTest.play(); });
    const seen = [];
    for (let i = 0; i < 40; i++) {
      await sleep(200);
      seen.push((await page.evaluate(() => window.mgTest.state().player)).currentBar);
    }
    await screenshot(app, '5-loop-bars5-6');
    await page.evaluate(() => { window.mgTest.stop(); window.mgTest.setPractice({ loop: false }); });
    // Metronome + count-in toggles reach alphaTab.
    await page.evaluate(() => window.mgTest.setPractice({ metronome: true, countIn: true }));
    await sleep(100);
    const vols = await page.evaluate(() => {
      const a = document.querySelector('.at-host') && window.mgTest;
      return a ? window.mgTest.state().practice : null;
    });
    await page.evaluate(() => window.mgTest.play());
    await sleep(1500);
    await assertSilent(page, 'item5 metronome+count-in', 800);
    await page.evaluate(() => { window.mgTest.stop(); window.mgTest.setPractice({ metronome: false, countIn: false }); });
    record(5, {
      atScreenshot: { currentBar: s1.currentBar, tick: s1.tick },
      pause: { pausedTick, stillTick, held: Math.abs(stillTick - pausedTick) < 50 },
      seekBar9: { currentBar: s2.currentBar },
      afterStop: { tick: s3.tick, currentBar: s3.currentBar },
      loopBarsSeen: [...new Set(seen)],
      practice: vols,
      levels: lv,
    });
  }

  // ---------- 6: tracks panel / instrument ----------
  if (want(6)) {
    await page.evaluate((p) => window.mgTest.open(p), td('ode-to-joy-piano.musicxml'));
    await page.evaluate(() => window.mgTest.waitReady(30000));
    const before = await page.evaluate(() => JSON.stringify(window.mgTest.song().tracks[0].staves));
    const r = page.evaluate(() => window.mgTest.waitRender());
    await page.evaluate(() => window.mgTest.setInstrument(0, 'electric-guitar-clean'));
    await r;
    const after = await page.evaluate(() => JSON.stringify(window.mgTest.song().tracks[0].staves));
    const st = await page.evaluate(() => window.mgTest.state().tracks[0]);
    await page.evaluate(() => window.mgTest.setMixer(0, { volume: 0.6, pan: -0.3 }));
    await sleep(300);
    await screenshot(app, '6-piano-as-electric-guitar');
    let sound = null;
    if (!noSound) {
      // SOUND CHECK: the only unmuted step of the round.
      await page.evaluate(() => { window.mgTest.seekBar(0); window.mgTest.play(); });
      await sleep(500);
      await assertSilent(page, 'item6 before sound check', 500);
      const t0 = Date.now();
      await page.evaluate(() => window.mgTest.setMasterGain(0.5));
      const loud = await page.evaluate((ms) => window.mgTest.levels(ms), SOUND_CHECK_MS);
      await page.evaluate(() => window.mgTest.setMasterGain(0));
      const unmutedMs = Date.now() - t0;
      await sleep(250); // let the analyser's ~46 ms buffer flush pre-mute samples
      const after2 = await assertSilent(page, 'item6 after sound check', 800);
      await page.evaluate(() => window.mgTest.stop());
      sound = { unmutedMs, peakWhileUnmuted: loud.postPeak, peakAfterRemute: after2.postPeak };
      console.log(`  SOUND CHECK: unmuted for ${unmutedMs} ms, speaker peak ${loud.postPeak.toFixed(4)}`);
    }
    record(6, { instrument: st.instrument, program: st.program, tuning: st.tuning, notesUnchanged: before === after, sound });
  }

  // ---------- 7: speed + transpose ----------
  if (want(7)) {
    await page.evaluate((p) => window.mgTest.open(p), td('ode-to-joy-piano.musicxml'));
    await page.evaluate(() => window.mgTest.waitReady(30000));
    const rate = async (speed) => {
      await page.evaluate((s) => { window.mgTest.setPractice({ speed: s }); window.mgTest.seekBar(0); window.mgTest.play(); }, speed);
      await sleep(600);
      const a = (await page.evaluate(() => window.mgTest.state().player)).tick;
      const ta = Date.now();
      await sleep(1500);
      const b = (await page.evaluate(() => window.mgTest.state().player)).tick;
      const tb = Date.now();
      await assertSilent(page, `item7 speed ${speed}%`, 500);
      await page.evaluate(() => window.mgTest.stop());
      return ((b - a) / (tb - ta)) * 1000; // ticks per second
    };
    const r100 = await rate(100);
    const r50 = await rate(50);
    await page.evaluate(() => window.mgTest.setPractice({ speed: 100 }));
    const songBefore = await page.evaluate(() => window.mgTest.song());
    const rr = page.evaluate(() => window.mgTest.waitRender());
    await page.evaluate(() => window.mgTest.transpose(2));
    await rr;
    const songAfter = await page.evaluate(() => window.mgTest.song());
    const p0 = songBefore.tracks.flatMap((t) => t.staves.flatMap((s) => s.measures.flatMap((m) => m.voices.flatMap((v) => v.beats.flatMap((b) => b.notes.map((n) => n.pitch))))));
    const p1 = songAfter.tracks.flatMap((t) => t.staves.flatMap((s) => s.measures.flatMap((m) => m.voices.flatMap((v) => v.beats.flatMap((b) => b.notes.map((n) => n.pitch))))));
    const allPlus2 = p0.length === p1.length && p0.every((p, i) => p1[i] === p + 2);
    await sleep(300);
    await screenshot(app, '7-transposed-plus2');
    record(7, {
      ticksPerSec100: Math.round(r100), ticksPerSec50: Math.round(r50), ratio: +(r50 / r100).toFixed(2),
      speedChangesSong: JSON.stringify(songBefore.tempos) !== JSON.stringify(songAfter.tempos),
      transposeAllPlus2: allPlus2, notes: p0.length, keyBefore: songBefore.bars[0].key.fifths, keyAfter: songAfter.bars[0].key.fifths,
      firstChord: [songBefore.chordSymbols[0]?.name, songAfter.chordSymbols[0]?.name],
    });
  }

  // ---------- 8: undo/redo in the app ----------
  if (want(8)) {
    await page.evaluate((p) => window.mgTest.open(p), td('ode-to-joy-piano.musicxml'));
    const s0 = await page.evaluate(() => JSON.stringify(window.mgTest.song()));
    await page.evaluate(() => {
      window.mgTest.setInstrument(0, 'distortion-guitar');
      window.mgTest.transpose(3);
      window.mgTest.setMixer(0, { mute: true, volume: 0.2 });
    });
    const s3 = await page.evaluate(() => JSON.stringify(window.mgTest.song()));
    await page.evaluate(() => { window.mgTest.undo(); window.mgTest.undo(); window.mgTest.undo(); });
    const back = await page.evaluate(() => JSON.stringify(window.mgTest.song()));
    await page.evaluate(() => { window.mgTest.redo(); window.mgTest.redo(); window.mgTest.redo(); });
    const fwd = await page.evaluate(() => JSON.stringify(window.mgTest.song()));
    record(8, { undoRestoresOriginal: back === s0, redoRestoresEdited: fwd === s3 });
  }
} catch (e) {
  console.error('FAILED:', e);
  report.error = String(e?.stack ?? e);
  process.exitCode = 1;
} finally {
  await app?.close().catch(() => {});
}

// ---------- 8b: crash + restore offer (separate launches sharing one profile) ----------
if (want(8) && !report.error) {
  let a1, a2;
  try {
    const l1 = await launch({ dev, extraArgs: ['--autosave-ms=2000'] });
    a1 = l1.app;
    await l1.page.evaluate((p) => window.mgTest.open(p), td('ode-to-joy-piano.musicxml'));
    await l1.page.evaluate(() => window.mgTest.transpose(5));
    await sleep(3500); // > one autosave interval
    const saved = await l1.page.evaluate(() => window.mgTest.state().lastAutosave);
    const pid = a1.process().pid;
    a1.process().kill('SIGKILL'); // simulate a crash
    await sleep(1500);
    const l2 = await launch({ dev, profileDir: l1.profileDir });
    a2 = l2.app;
    await l2.page.waitForFunction(() => window.mgTest.state().bannerVisible, null, { timeout: 10000 });
    await screenshot(a2, '8-restore-offer-after-crash');
    const r = l2.page.evaluate(() => window.mgTest.waitRender());
    await l2.page.evaluate(() => document.querySelector('[data-testid="recovery-banner"] button.primary').click());
    await r;
    const st = await l2.page.evaluate(() => window.mgTest.state());
    const key = await l2.page.evaluate(() => window.mgTest.song().bars[0].key.fifths);
    await screenshot(a2, '8-restored');
    record(8, { autosavedAt: saved, killedPid: pid, restoreOffered: true, restoredTitle: st.title, restoredKeyFifths: key });
  } catch (e) {
    console.error('FAILED 8b:', e);
    report.error = String(e?.stack ?? e);
    process.exitCode = 1;
  } finally {
    await a1?.close().catch(() => {});
    await a2?.close().catch(() => {});
  }
}

report.finishedAt = new Date().toISOString();
writeFileSync(join(RESULTS, 'report.json'), JSON.stringify(report, null, 2));
console.log(`report: ${join(RESULTS, 'report.json')}`);
