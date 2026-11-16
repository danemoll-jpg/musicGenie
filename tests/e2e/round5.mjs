// Round 5 checks in the built app. Hidden + muted throughout: the speaker level (post-gain
// analyser) is measured on every step that makes sound and must be 0. No sound checks.
// Usage: node tests/e2e/round5.mjs [--dev] [--only=1,5]
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { launch, newProfileDir, RESULTS, screenshot, sleep, td, windowInfo } from './harness.mjs';

const dev = process.argv.includes('--dev');
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
setTimeout(() => { console.error('GLOBAL TIMEOUT (15 min)'); process.exit(2); }, 15 * 60000).unref();
const report = { startedAt: new Date().toISOString(), mode: dev ? 'dev' : 'packaged', items: {}, soundChecks: [], speakerLevels: [] };
const want = (n) => !only || only.includes(String(n));
const work = mkdtempSync(join(tmpdir(), 'mg-r5-'));

function record(item, data) {
  report.items[item] = { ...(report.items[item] ?? {}), ...data };
  console.log(`item ${item}:`, JSON.stringify(data).slice(0, 1500));
}
function check(cond, msg) {
  if (!cond) throw new Error('CHECK FAILED: ' + msg);
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
async function rockBand(page) {
  await open(page, td('ode-to-joy-piano.musicxml'));
  await ev(page, () => window.mgTest.setStyle('rock'));
  await rendered(page, () => ev(page, () => window.mgTest.clickGenerate()));
  await ev(page, () => window.mgTest.waitReady(30000));
}

/** A test WAV: `secs` of a quiet 220 Hz tone with loud clicks every `clickEvery` s. */
function makeWav(path, secs, sr = 44100, clickEvery = 0.5) {
  const n = Math.round(secs * sr);
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    let v = 0.2 * Math.sin((2 * Math.PI * 220 * i) / sr);
    if ((i % Math.round(clickEvery * sr)) < 40) v = 0.9;
    const s = Math.round(v * 32767);
    buf.writeInt16LE(s, 44 + i * 4);
    buf.writeInt16LE(s, 46 + i * 4);
  }
  writeFileSync(path, buf);
}

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

  // ---------- 1: per-track outputs ----------
  if (want(1)) {
    await rockBand(page);
    const tracks = await ev(page, () => window.mgTest.song().tracks.map((t, i) => ({ i, id: t.id, name: t.name, muted: t.mixer.mute })));
    const info = await ev(page, () => window.mgTest.engineInfo());
    await ev(page, () => { window.mgTest.seekBar(0); window.mgTest.play(); });
    await sleep(600);
    const all = await ev(page, () => window.mgTest.trackMeters(900));
    const solo = {};
    for (const t of tracks.filter((x) => !x.muted)) {
      await ev(page, (i) => window.mgTest.setMixer(i, { solo: true }), t.i);
      await sleep(250);
      const m = await ev(page, () => window.mgTest.trackMeters(900));
      await ev(page, (i) => window.mgTest.setMixer(i, { solo: false }), t.i);
      const others = tracks.filter((x) => x.id !== t.id).map((x) => m[x.id] ?? 0);
      solo[t.name] = { own: +(m[t.id] ?? 0).toFixed(4), othersMax: Math.max(...others), master: +m.__master.toFixed(4) };
      check(m[t.id] > 0, t.name + ' soloed but silent');
      check(Math.max(...others) === 0, t.name + ' soloed but others not silent');
    }
    const lv = await assertSilent(page, 'item1 band playing', 600);
    await ev(page, () => window.mgTest.stop());
    record(1, { engine: 'alphaTab synth on the page thread, split per MIDI channel -> AudioWorklet (17 outputs) -> mixer graph', channelMap: info.channelMap, sampleRate: info.sampleRate, allPlaying: all, soloed: solo, prePeak: lv.prePeak, speaker: lv.postPeak });
  }

  // ---------- 2: mixer view ----------
  if (want(2)) {
    await rockBand(page);
    const tr = await ev(page, () => window.mgTest.song().tracks.map((t) => t.name));
    const rhythm = tr.findIndex((n) => n.startsWith('Rhythm'));
    const lead = tr.findIndex((n) => n.startsWith('Lead'));
    const bass = tr.findIndex((n) => n.startsWith('Bass'));
    const drums = tr.findIndex((n) => n.startsWith('Drums'));
    await ev(page, (i) => window.mgTest.applyPreset(i, 'Crunch'), rhythm);
    await ev(page, (i) => window.mgTest.applyPreset(i, 'Lead'), lead);
    await ev(page, (i) => window.mgTest.applyPreset(i, 'Bass drive'), bass);
    await ev(page, (i) => window.mgTest.applyPreset(i, 'Drum room'), drums);
    await ev(page, (i) => window.mgTest.setSends(i, { reverb: 0.6, delay: 0.4 }), lead);
    await ev(page, () => window.mgTest.openDock('mixer'));
    await ev(page, () => { window.mgTest.seekBar(0); window.mgTest.play(); });
    await sleep(800);
    const m = await ev(page, () => window.mgTest.trackMeters(1200));
    await screenshot(app, 'r5-2-mixer');
    const lv = await assertSilent(page, 'item2 mixer playing', 500);
    // Reorder / bypass / remove on the rhythm chain, each one undo step.
    const fx0 = await ev(page, (i) => window.mgTest.fxOf(i).map((f) => f.type), rhythm);
    const id1 = await ev(page, (i) => window.mgTest.fxOf(i)[1].id, rhythm);
    await ev(page, (a) => window.mgTest.moveFx(a[0], a[1], -1), [rhythm, id1]);
    const fx1 = await ev(page, (i) => window.mgTest.fxOf(i).map((f) => f.type), rhythm);
    await ev(page, (a) => window.mgTest.bypassFx(a[0], a[1], true), [rhythm, id1]);
    const byp = await ev(page, (i) => window.mgTest.fxOf(i).map((f) => !!f.bypass), rhythm);
    await ev(page, () => { window.mgTest.undo(); window.mgTest.undo(); });
    const fxBack = await ev(page, (i) => window.mgTest.fxOf(i).map((f) => f.type + (f.bypass ? '(off)' : '')), rhythm);
    await ev(page, () => window.mgTest.stop());
    check(m.__reverb > 0 && m.__delay > 0, 'send buses silent');
    check(fx1[0] === fx0[1] && fx1[1] === fx0[0], 'reorder failed');
    check(JSON.stringify(fxBack) === JSON.stringify(fx0), 'undo of reorder+bypass failed');
    record(2, { meters: m, rhythmChain: fx0, afterMoveUp: fx1, bypassed: byp, afterTwoUndos: fxBack, speaker: lv.postPeak });
  }

  // ---------- 3: effects ----------
  if (want(3)) {
    const checks = await ev(page, () => window.mgTest.fxChecks());
    for (const c of checks) console.log(`  ${c.pass ? 'ok ' : 'BAD'} ${c.effect} (${c.test}): ${JSON.stringify(c.measured)}`);
    // Amp chain screenshot: rhythm guitar with Crunch, amp settings open.
    await rockBand(page);
    const tr = await ev(page, () => window.mgTest.song().tracks.map((t) => t.name));
    const rhythm = tr.findIndex((n) => n.startsWith('Rhythm'));
    await ev(page, (i) => window.mgTest.applyPreset(i, 'Crunch'), rhythm);
    await ev(page, (i) => window.mgTest.addFx(i, 'delay'), rhythm);
    await ev(page, () => window.mgTest.openDock('mixer'));
    await sleep(200);
    await ev(page, (i) => {
      const strip = document.querySelectorAll('.strip')[i];
      [...strip.querySelectorAll('.fx .nm')].forEach((n) => n.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    }, rhythm);
    await sleep(200);
    await screenshot(app, 'r5-3-amp-chain');
    await ev(page, (i) => window.mgTest.saveFxPreset(i, 'My crunch + delay'), rhythm);
    const presets = await ev(page, () => window.mgTest.fxPresets().map((p) => p.name + ':' + p.fx.map((f) => f.type).join('+')));
    record(3, { checks, allPass: checks.every((c) => c.pass), userPresets: presets });
    check(checks.every((c) => c.pass), 'an effect check failed');
  }

  // ---------- 4: automation ----------
  if (want(4)) {
    await open(page, td('ode-to-joy-piano.musicxml'));
    const before = await ev(page, () => window.mgTest.renderBars());
    // Fade out from the fader's own level at bar 5 to silence at bar 13.
    const v0 = await ev(page, () => window.mgTest.song().tracks[0].mixer.volume);
    await ev(page, (v) => window.mgTest.setAutomation(0, [{ param: 'volume', points: [{ bar: 4, tick: 0, value: v }, { bar: 12, tick: 0, value: 0 }] }]), v0);
    const after = await ev(page, () => window.mgTest.renderBars());
    await ev(page, () => { window.mgTest.openDock('auto'); window.mgTest.setSelTrack(0); window.mgTest.seekBar(6); window.mgTest.play(); });
    await sleep(900);
    const live = await ev(page, () => window.mgTest.trackMeters(500));
    await screenshot(app, 'r5-4-automation');
    const lv = await assertSilent(page, 'item4 automation playing', 400);
    await ev(page, () => window.mgTest.stop());
    const firstBars = after.barRms.slice(0, 4).map((v, i) => +(v - before.barRms[i]).toFixed(2));
    const fade = after.barRms.slice(4, 12).map((v, i) => +(v - before.barRms[i + 4]).toFixed(1));
    const tail = after.barRms.slice(12);
    record(4, { barRmsBefore: before.barRms, barRmsAfter: after.barRms, unchangedBars1to4Db: firstBars, fadeBars5to12Db: fade, bars13onDb: tail, livePiano: live, speaker: lv.postPeak });
    check(firstBars.every((d) => Math.abs(d) < 0.5), 'bars before the fade changed');
    check(fade.every((d, i) => i === 0 || d < fade[i - 1] + 0.5) && fade[fade.length - 1] < -12, 'no fade-out');
    check(tail.every((v) => v < -80), 'not silent after the fade');
  }

  // ---------- 5: audio tracks ----------
  if (want(5)) {
    const wav = join(work, 'clicks.wav');
    makeWav(wav, 4);
    await open(page, td('ode-to-joy-piano.musicxml'));
    await ev(page, () => window.mgTest.audioAddTrack());
    const ti = await ev(page, () => window.mgTest.song().tracks.length - 1);
    await ev(page, (p) => window.mgTest.audioImport(p, 2), wav);
    let clips = await ev(page, (i) => window.mgTest.audioClips(i), ti);
    const startAt100 = await ev(page, (i) => window.mgTest.clipStartMs(i, 0), ti);
    // Tempo change: the clip stays on bar 3.
    await rendered(page, () => ev(page, () => window.mgTest.tempoChange(0, 150)));
    const startAt150 = await ev(page, (i) => window.mgTest.clipStartMs(i, 0), ti);
    const barAfterTempo = (await ev(page, (i) => window.mgTest.audioClips(i), ti))[0].bar;
    await rendered(page, () => ev(page, () => window.mgTest.undo()));
    // Edits: trim start, trim end, split, fades; each one undo step.
    const s0 = await ev(page, (i) => window.mgTest.clipStartMs(i, 0), ti);
    await ev(page, (a) => window.mgTest.clipEdit(a[0], 0, 'trimStart', a[1] + 250), [ti, s0]);
    await ev(page, (a) => window.mgTest.clipEdit(a[0], 0, 'trimEnd', a[1] + 3500), [ti, s0]);
    await ev(page, (a) => window.mgTest.clipEdit(a[0], 0, 'split', a[1] + 1750), [ti, s0]);
    await ev(page, (i) => window.mgTest.clipEdit(i, 1, 'fades', { fadeInMs: 50, fadeOutMs: 400, gainDb: -3 }), ti);
    clips = await ev(page, (i) => window.mgTest.audioClips(i), ti);
    const edited = clips.map((c) => ({ bar: c.bar, tick: c.tick, startMs: Math.round(c.startMs), lengthMs: Math.round(c.lengthMs), fadeIn: c.fadeInMs, fadeOut: c.fadeOutMs, gainDb: c.gainDb }));
    const labels = [];
    for (let k = 0; k < 4; k++) { labels.push(await ev(page, () => window.mgTest.undoLabel())); await ev(page, () => window.mgTest.undo()); }
    const afterUndo = await ev(page, (i) => window.mgTest.audioClips(i).map((c) => [Math.round(c.startMs), Math.round(c.lengthMs)]), ti);
    // Clip playback: solo the audio track, play from bar 3.
    await ev(page, (i) => window.mgTest.setMixer(i, { solo: true }), ti);
    await ev(page, () => { window.mgTest.seekBar(2); window.mgTest.play(); });
    await sleep(700);
    const clipLive = await ev(page, (i) => window.mgTest.trackMeters(800).then((m) => m[window.mgTest.song().tracks[i].id]), ti);
    const lvClip = await assertSilent(page, 'item5 clip playing', 400);
    await ev(page, () => window.mgTest.stop());
    await ev(page, (i) => window.mgTest.setMixer(i, { solo: false }), ti);
    // Recording through a simulated cable: output -> 80 ms delay -> input.
    await ev(page, () => window.mgTest.recorderSimulated(80));
    const latency = await ev(page, () => window.mgTest.measureLatency());
    await ev(page, () => window.mgTest.openDock('audio'));
    await ev(page, (i) => window.mgTest.setSelTrack(i), ti);
    await ev(page, () => window.mgTest.recordStart({ startBar: 4, countIn: true, metronome: true }));
    await sleep(500);
    const recLevel = await assertSilent(page, 'item5 recording (count-in + metronome)', 600);
    const bpm = (await ev(page, () => window.mgTest.song().tempos[0].bpm));
    await sleep(Math.round((60000 / bpm) * 4 * 3)); // count-in bar + 2 bars
    const take = await ev(page, () => window.mgTest.recordStop());
    clips = await ev(page, (i) => window.mgTest.audioClips(i), ti);
    const ci = clips.length - 1;
    const onsets = await ev(page, (a) => window.mgTest.clipOnsets(a[0], a[1], 0.05), [ti, ci]);
    const beats = [];
    for (let b = 4; b < 8; b++) for (let q = 0; q < 4; q++) beats.push(await ev(page, (a) => window.mgTest.beatMs(a[0], a[1]), [b, q]));
    const errs = onsets.slice(0, 8).map((t) => Math.round(Math.min(...beats.map((b) => Math.abs(b - t))) * 10) / 10);
    await sleep(300);
    await screenshot(app, 'r5-5-audio');
    record(5, {
      importedClip: { bar: clips[0]?.bar, lengthMs: Math.round(clips[0]?.lengthMs ?? 0) }, clipStartMsAt100bpm: Math.round(startAt100), clipStartMsAt150bpm: Math.round(startAt150), barAfterTempoChange: barAfterTempo,
      edited, undoLabels: labels, afterFourUndos: afterUndo, clipPlaybackPeak: clipLive, speakerClip: lvClip.postPeak,
      simulatedCableMs: 80, measuredLatencyMs: latency, take: take && { bar: take.clip.bar, tick: take.clip.tick, startMs: Math.round(take.clip.startMs), lengthMs: Math.round(take.clip.lengthMs), latencyMs: take.latencyMs },
      clickOnsetsMs: onsets.slice(0, 8).map((x) => Math.round(x)), beatErrorsMs: errs, speakerRecording: recLevel.postPeak,
    });
    check(barAfterTempo === 2 && Math.abs(startAt150 - (startAt100 * 100) / 150) < 2, 'clip did not stay on its bar');
    check(afterUndo.length === 1 && afterUndo[0][0] === 0, 'undo of clip edits failed');
    check(clipLive > 0, 'clip did not play');
    check(latency !== null && Math.abs(latency - 80) < 5, 'latency not measured within 5 ms of the cable');
    check(take && take.clip.bar === 4 && take.clip.tick === 0, 'take not at bar 5');
    check(errs.length >= 6 && errs.every((e) => e < 10), 'recorded clicks off the beat');
  }

  // ---------- 6: keyboard piano ----------
  if (want(6)) {
    await open(page, td('ode-to-joy-piano.musicxml'));
    await ev(page, () => { window.mgTest.setSelTrack(0); window.mgTest.openDock('midi'); window.mgTest.midiOptions({ monitor: true, countIn: false, metronome: false, quantize: '8', mode: 'replace' }); });
    const r0 = await ev(page, () => window.mgTest.midiReceived());
    await ev(page, () => { window.mgTest.keyDown('a'); window.mgTest.keyUp('a'); });
    const offIgnored = (await ev(page, () => window.mgTest.midiReceived())) === r0;
    await ev(page, () => window.mgTest.kbdPiano(true));
    await sleep(100);
    await screenshot(app, 'r5-6-keyboard-piano');
    await ev(page, () => window.mgTest.seekBar(0));
    await ev(page, () => window.mgTest.midiRecord());
    // Play a C major run on the beats of bar 2 (the player position tells when bar 2 starts).
    const bpm = await ev(page, () => window.mgTest.song().tempos[0].bpm);
    const beat = 60000 / bpm;
    await page.waitForFunction(() => window.mgTest.state().player.songTick >= 3840, null, { polling: 5, timeout: 15000 });
    const keys = ['a', 's', 'd', 'f', 'x', 'a'];
    for (const k of keys) {
      if (k === 'x') { await ev(page, () => window.mgTest.keyDown('x')); continue; }
      await ev(page, (kk) => window.mgTest.keyDown(kk), k);
      await sleep(Math.round(beat * 0.6));
      await ev(page, (kk) => window.mgTest.keyUp(kk), k);
      await sleep(Math.round(beat * 0.4));
    }
    const kst = await ev(page, () => window.mgTest.kbdState());
    const lv = await assertSilent(page, 'item6 keyboard piano', 300);
    await ev(page, () => window.mgTest.midiStop());
    await settle(page);
    // The take went into the piano's first staff (treble), bar 2 beat 1 .. bar 3 beat 1.
    const notes = await ev(page, () => window.mgTest.rollNotes(0));
    const rec = notes.filter((n) => n[0] >= 3840 && n[0] < 3840 * 2 + 960).map((n) => n[0] + '@' + n[2]);
    await ev(page, () => window.mgTest.kbdPiano(false));
    const pitches = rec.map((r) => +r.split('@')[1]);
    const ticks = rec.map((r) => +r.split('@')[0]);
    record(6, { keyIgnoredWhenOff: offIgnored, recorded: rec, octaveAfterX: kst.octave, speaker: lv.postPeak });
    check(offIgnored, 'keys played notes while the piano was off');
    check(JSON.stringify(pitches) === JSON.stringify([60, 62, 64, 65, 72]), 'wrong pitches ' + pitches);
    check(ticks.every((t, i) => i === 0 || t - ticks[i - 1] === 960), 'not one beat apart');
  }

  // ---------- 7: export ----------
  if (want(7)) {
    await rockBand(page);
    const tr = await ev(page, () => window.mgTest.song().tracks.map((t) => t.name));
    await ev(page, (i) => window.mgTest.applyPreset(i, 'Crunch'), tr.findIndex((n) => n.startsWith('Rhythm')));
    const dir = join(work, 'export');
    await ev(page, () => window.mgTest.openExportDialog(true));
    await sleep(300);
    await screenshot(app, 'r5-7-export-dialog');
    await ev(page, () => window.mgTest.openExportDialog(false));
    const rep = await ev(page, (d) => window.mgTest.exportAll(d, { stems: 'both', tailMs: 0 }), dir);
    const counts = await ev(page, () => window.mgTest.onsets());
    const byKind = Object.fromEntries(rep.files.filter((f) => f.kind !== 'stem').map((f) => [f.kind, f.path]));
    const mid = await ev(page, (p) => window.mgTest.reimportCount(p), byKind.midi);
    const xml = await ev(page, (p) => window.mgTest.reimportCount(p), byKind.musicxml);
    const gp = await ev(page, (p) => window.mgTest.reimportCount(p), byKind.gp);
    const wl = await ev(page, (p) => window.mgTest.wavLoudness(p), byKind.wav);
    const ml = await ev(page, (p) => window.mgTest.wavLoudness(p), byKind.mp3);
    if (rep.pdf?.png) copyFileSync(rep.pdf.png, join(RESULTS, 'r5-7-pdf-page1.png'));
    copyFileSync(byKind.pdf, join(RESULTS, 'r5-7-score.pdf'));
    const stems = rep.files.filter((f) => f.kind === 'stem').map((f) => f.path.split('\\').pop());
    record(7, {
      files: rep.files.filter((f) => f.kind !== 'stem').map((f) => f.kind + ' ' + Math.round(f.bytes / 1024) + 'KB'), stems,
      notes: counts, midiReimport: mid, musicxmlReimport: xml, gpReimport: gp,
      songMs: Math.round(rep.songMs), wavMs: Math.round(wl.ms), wavDiffMs: Math.round(Math.abs(wl.ms - rep.songMs)),
      lufsReported: rep.lufsAfter, lufsMeasuredWav: +wl.lufs.toFixed(2), lufsMp3: +ml.lufs.toFixed(2), wavPeakDb: +wl.peakDb.toFixed(2),
      renderSpeedX: rep.speed, renderMs: rep.renderMs, pdf: rep.pdf,
    });
    check(mid.notes === counts && xml.notes === counts && gp.notes === counts, 'note counts differ after re-import');
    check(Math.abs(wl.ms - rep.songMs) <= 50, 'WAV length off');
    check(Math.abs(wl.lufs + 14) <= 1, 'loudness off target');
    check(wl.peakDb <= -0.9, 'peak over the ceiling');
    check(rep.speed > 1, 'not faster than real time');
    check(rep.pdf.pages >= 1, 'no PDF pages');
  }

  // ---------- 8: save / reopen / package / undo ----------
  if (want(8)) {
    const wav = join(work, 'take.wav');
    makeWav(wav, 3);
    await rockBand(page);
    const tr = await ev(page, () => window.mgTest.song().tracks.map((t) => t.name));
    const lead = tr.findIndex((n) => n.startsWith('Lead'));
    const steps = [];
    const step = async (name, fn, arg) => {
      console.log('  step', name);
      const a = await ev(page, () => window.mgTest.serialized());
      await ev(page, fn, arg);
      await settle(page);
      const label = await ev(page, () => window.mgTest.undoLabel());
      await ev(page, () => window.mgTest.undo());
      await settle(page);
      const back = (await ev(page, () => window.mgTest.serialized())) === a;
      await ev(page, () => window.mgTest.redo());
      await settle(page);
      steps.push({ name, label, oneUndoStep: back });
    };
    await step('preset', (i) => window.mgTest.applyPreset(i, 'Lead'), lead);
    await step('fx param', (i) => { const f = window.mgTest.fxOf(i)[0]; window.mgTest.setFxParam(i, f.id, 'drive', 0.9); }, lead);
    await step('fader drag (5 moves)', async (i) => { for (const v of [0.7, 0.6, 0.5, 0.45, 0.4]) window.mgTest.setMixer(i, { volume: v }); }, lead);
    await step('send', (i) => window.mgTest.setSends(i, { reverb: 0.5 }), lead);
    await step('master fader', () => window.mgTest.setMasterVolume(0.7));
    await step('automation', (i) => window.mgTest.setAutomation(i, [{ param: 'pan', points: [{ bar: 0, tick: 0, value: -1 }, { bar: 8, tick: 0, value: 1 }] }]), lead);
    await step('audio track', () => window.mgTest.audioAddTrack());
    const ti = await ev(page, () => window.mgTest.song().tracks.length - 1);
    await step('import clip', (p) => window.mgTest.audioImport(p, 1), wav);
    console.log('  saving');
    const proj = join(work, 'saved', 'Round5 test.mgproj');
    await ev(page, (p) => window.mgTest.saveProjectTo(p), proj);
    const savedSong = await ev(page, () => JSON.stringify(window.mgTest.song()));
    const mediaDir = join(work, 'saved', 'Round5 test_media');
    const media = existsSync(mediaDir) ? readdirSync(mediaDir) : [];
    await open(page, proj);
    const reopened = await ev(page, () => JSON.stringify(window.mgTest.song()));
    console.log('  render reopened');
    const renderReopened = await ev(page, () => window.mgTest.renderBars({ stems: true }));
    const pack = join(work, 'Round5 test.mgpack');
    console.log('  package');
    await ev(page, (p) => window.mgTest.savePackage(p), pack);
    // The package must open on its own: move the project folder away first.
    rmSync(join(work, 'saved'), { recursive: true, force: true });
    await open(page, pack);
    const fromPack = await ev(page, () => window.mgTest.song());
    const packClip = fromPack.tracks[ti].audio.clips[0];
    const packFileOk = await ev(page, (f) => window.mgTest.fileExists(f), packClip.file);
    const strip = (s) => JSON.stringify({ ...JSON.parse(s), tracks: JSON.parse(s).tracks.map((t) => (t.audio ? { ...t, audio: { clips: t.audio.clips.map((c) => ({ ...c, file: c.file.split('\\').pop() })) } } : t)) });
    const renderPack = await ev(page, () => window.mgTest.renderBars({ stems: true }));
    const audioStem = (r) => r.stems.find((s) => s.name.startsWith('Audio'))?.peak ?? 0;
    record(8, {
      steps, savedMedia: media, reopenedDeepEqual: reopened === savedSong,
      packageBytes: statSync(pack).size, packageDeepEqual: strip(JSON.stringify(fromPack)) === strip(savedSong), packageClipFile: packClip.file, packageClipExists: packFileOk,
      audioStemPeakReopened: +audioStem(renderReopened).toFixed(3), audioStemPeakFromPackage: +audioStem(renderPack).toFixed(3),
    });
    check(steps.every((s) => s.oneUndoStep), 'an edit was not one undo step');
    check(reopened === savedSong, 'reopen differs');
    check(strip(JSON.stringify(fromPack)) === strip(savedSong) && packFileOk, 'package differs');
    check(audioStem(renderPack) > 0.05, 'package audio silent');
  }
  console.log('ROUND 5 CHECKS DONE');
} catch (e) {
  console.error('FAILED:', e.message);
  report.error = e.message;
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(RESULTS, 'report-round5.json'), JSON.stringify(report, null, 1));
  console.log('report:', join(RESULTS, 'report-round5.json'));
  try { await app?.close(); } catch { /* closed */ }
  rmSync(work, { recursive: true, force: true });
}

async function settle(p) {
  await p.evaluate(() => window.mgTest.settle().catch(() => {}));
}
