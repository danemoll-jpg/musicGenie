// Round 6 checks in the built app. Hidden + muted throughout: the speaker level (post-gain
// analyser) is measured on every step that makes sound and must be 0.
// Sound checks: none (pitch at 50% speed is measured on the PRE-master signal while muted).
// Usage: node tests/e2e/round6.mjs [--dev] [--only=1,5]
// Item 2/4/7 benchmarks use TestData/private/Husker-Du_...psarc when present; everything made
// from it goes to a temp folder that is deleted at the end.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { launch, newProfileDir, RESULTS, ROOT, screenshot, sleep, td, windowInfo } from './harness.mjs';

const dev = process.argv.includes('--dev');
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const keepModels = process.argv.includes('--keep-models');
setTimeout(() => { console.error('GLOBAL TIMEOUT (60 min)'); process.exit(2); }, 60 * 60000).unref();
const report = { startedAt: new Date().toISOString(), mode: dev ? 'dev' : 'packaged', items: {}, soundChecks: [], speakerLevels: [] };
const want = (n) => !only || only.includes(String(n));
const work = mkdtempSync(join(tmpdir(), 'mg-r6-'));
const PRIVATE = join(ROOT, 'TestData', 'private', 'Husker-Du_Could-You-Be-The-One_v1_p.psarc');
// Models are kept between runs in a shared profile folder outside the repo (downloaded once).
const MODEL_PROFILE = join(tmpdir(), 'musicgenie-r6-models');

function record(item, data) {
  report.items[item] = { ...(report.items[item] ?? {}), ...data };
  console.log(`item ${item}:`, JSON.stringify(data).slice(0, 2500));
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
async function band(page, style) {
  await open(page, td('ode-to-joy-piano.musicxml'));
  await ev(page, (st) => window.mgTest.setStyle(st), style);
  await rendered(page, () => ev(page, () => window.mgTest.clickGenerate()));
  await ev(page, () => window.mgTest.waitReady(30000));
}

/** 16-bit PCM WAV -> { sr, ch: Float32Array[] }. */
function readWav16(path) {
  const b = readFileSync(path);
  let o = 12, sr = 44100, nch = 2, data = 0, len = 0;
  while (o < b.length) {
    const id = b.toString('latin1', o, o + 4), sz = b.readUInt32LE(o + 4);
    if (id === 'fmt ') { nch = b.readUInt16LE(o + 10); sr = b.readUInt32LE(o + 12); }
    if (id === 'data') { data = o + 8; len = sz; break; }
    o += 8 + sz + (sz & 1);
  }
  const n = Math.floor(len / (2 * nch));
  const ch = Array.from({ length: nch }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) for (let c = 0; c < nch; c++) ch[c][i] = b.readInt16LE(data + (i * nch + c) * 2) / 32768;
  return { sr, ch };
}
const monoOf = (w) => { const n = w.ch[0].length; const m = new Float32Array(n); for (const c of w.ch) for (let i = 0; i < n; i++) m[i] += c[i] / w.ch.length; return m; };
const energy = (x) => { let s = 0; for (const v of x) s += v * v; return s; };
const dot = (a, b) => { let s = 0; const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) s += a[i] * b[i]; return s; };
const FIX = join(RESULTS, 'r6-fixtures');
/** Our own songs rendered to audio (notes known). Made once, reused. */
async function fixture(page, name) {
  const tf = join(FIX, `${name}-truth.json`);
  if (existsSync(tf)) return JSON.parse(readFileSync(tf, 'utf8'));
  mkdirSync(FIX, { recursive: true });
  if (name === 'jazz') await band(page, 'jazz');
  else await band(page, 'rock');
  if (name === 'tempo') await rendered(page, () => ev(page, () => window.mgTest.setTempoChange(8, 132)));
  if (name === 'waltz') await rendered(page, () => ev(page, () => window.mgTest.setTimeSig(6, 3, 4, 4)));
  await ev(page, () => window.mgTest.waitReady(30000));
  return ev(page, ({ dir, name }) => window.mgTest.renderFixture(dir, name), { dir: FIX, name });
}
/** One-to-one matching within tol (s); returns F-score and timing errors of matches. */
function fscore(ref, est, tol, same = () => true) {
  const used = new Uint8Array(est.length);
  let tp = 0;
  const errs = [];
  for (const r of ref) {
    let best = -1, bd = tol + 1e-9;
    for (let i = 0; i < est.length; i++) {
      if (used[i] || !same(r, est[i])) continue;
      const d = Math.abs(est[i].t - r.t);
      if (d <= bd) { bd = d; best = i; }
    }
    if (best >= 0) { used[best] = 1; tp++; errs.push(est[best].t - r.t); }
  }
  const p = est.length ? tp / est.length : 0, rr = ref.length ? tp / ref.length : 0;
  return { f: +(p + rr ? (2 * p * rr) / (p + rr) : 0).toFixed(3), p: +p.toFixed(3), r: +rr.toFixed(3), tp, ref: ref.length, est: est.length, meanErrMs: errs.length ? +(1000 * errs.reduce((a, b) => a + b, 0) / errs.length).toFixed(1) : null };
}
function beatErrors(truth, est) {
  const signed = truth.map((t) => { let b = Infinity; for (const x of est) if (Math.abs(x - t) < Math.abs(b)) b = x - t; return b; });
  const e = signed.map(Math.abs);
  const within = e.filter((x) => x <= 0.02).length;
  const mean = signed.reduce((a, b) => a + b, 0) / signed.length;
  const sd = Math.sqrt(signed.reduce((a, b) => a + (b - mean) ** 2, 0) / signed.length);
  const afterOffset = signed.filter((x) => Math.abs(x - mean) <= 0.02).length;
  return {
    meanAbsMs: +(1000 * e.reduce((a, b) => a + b, 0) / e.length).toFixed(1), signedMeanMs: +(1000 * mean).toFixed(1), sdMs: +(1000 * sd).toFixed(1),
    maxMs: +(1000 * Math.max(...e)).toFixed(1), within20ms: `${within}/${e.length}`, within20msAfterConstantOffset: `${afterOffset}/${e.length}`,
  };
}

/** The shared test profile keeps only downloaded models: everything else (imports of the private
 *  file, stems, temporary audio, autosaves) is removed before and after the run. */
function cleanProfile() {
  if (!existsSync(MODEL_PROFILE)) return;
  for (const f of readdirSync(MODEL_PROFILE)) if (f !== 'models') rmSync(join(MODEL_PROFILE, f), { recursive: true, force: true });
}

let app, page;
try {
  mkdirSync(MODEL_PROFILE, { recursive: true });
  cleanProfile();
  ({ app, page } = await launch({ dev, profileDir: MODEL_PROFILE }));
  const win = await windowInfo(app);
  const masterGain = await ev(page, () => window.mgTest.state().masterGain);
  console.log('window:', JSON.stringify(win), 'masterGain at start:', masterGain);
  if (win.some((w) => w.visible || w.focused)) throw new Error('Window became visible/focused!');
  if (masterGain !== 0) throw new Error('master gain not 0 at start');
  report.window = win;
  await ev(page, () => window.mgTest.mlAutoAccept(true));

  // ---------- 1: ML runtime ----------
  if (want(1)) {
    const t0 = Date.now();
    const r = await ev(page, () => window.mgTest.mlProbe());
    await ev(page, () => window.mgTest.openDock('rec'));
    await sleep(300);
    await screenshot(app, 'r6-1-engine');
    check(r && (r.raw.dml?.ok || r.raw.cpu?.ok), 'no provider ran the test model');
    const lv = await assertSilent(page, 'item1', 300);
    record(1, { runtime: 'onnxruntime-node ' + r.ortVersion, provider: r.provider, gpu: r.gpu, gpuRunMs: r.raw.dml, cpuRunMs: r.raw.cpu, workerPid: r.pid, totalMs: Date.now() - t0, speaker: lv.postPeak });
  }

  // ---------- 2: beats and tempo ----------
  if (want(2)) {
    const res = {};
    for (const name of ['steady', 'tempo', 'waltz']) {
      const truth = await fixture(page, name);
      await ev(page, (p) => window.mgTest.newFromRecording(p), truth.files.mix);
      const r = await ev(page, () => window.mgTest.detectBeats());
      await ev(page, () => window.mgTest.waitReady(30000));
      const grid = await ev(page, () => window.mgTest.songBeatsInRecording());
      const s = await ev(page, () => { const x = window.mgTest.song(); return { ts: x.bars.map((b) => b.timeSignature.numerator), tempos: x.tempos.map((t) => [t.bar, +t.bpm.toFixed(1)]) }; });
      const gridT = grid.map((g) => g.t);
      // Downbeats: grid beats with beat index 0 vs true bar starts.
      const downs = grid.filter((g) => g.beat === 0).map((g) => ({ t: g.t }));
      res[name] = {
        detectedBeats: r.beats.length, trueBeats: truth.beats.length, provider: r.provider, inferMs: r.inferMs,
        rawBeatError: beatErrors(truth.beats, r.beats), gridBeatError: beatErrors(truth.beats, gridT),
        downbeatF: fscore(truth.downbeats.map((t) => ({ t })), downs, 0.07).f,
        timeSigTrue: truth.ts.join(''), timeSigFound: s.ts.join(''), tempos: s.tempos.slice(0, 8), tempoPoints: s.tempos.length,
      };
      if (name === 'waltz') await screenshot(app, 'r6-2-beats-waltz');
    }
    // Real-world benchmark: the private Rocksmith file (its chart's beat markers vs detected beats).
    if (existsSync(PRIVATE)) {
      await open(page, PRIVATE);
      const rs = await ev(page, () => { const s = window.mgTest.song(); return { backing: s.backing, beats: window.mgTest.chartBeats() }; });
      await ev(page, (p) => window.mgTest.newFromRecording(p), rs.backing.path);
      const r = await ev(page, () => window.mgTest.detectBeats());
      const grid = await ev(page, () => window.mgTest.songBeatsInRecording());
      // Chart ebeats in recording seconds, inside the detected range.
      const lo = Math.min(...r.beats), hi = Math.max(...r.beats);
      const chart = rs.beats.filter((t) => t >= lo - 0.5 && t <= hi + 0.5);
      res.huskerDu = { chartBeats: chart.length, detected: r.beats.length, rawBeatError: beatErrors(chart, r.beats), gridBeatError: beatErrors(chart, grid.map((g) => g.t)), inferMs: r.inferMs };
    } else res.huskerDu = 'skipped: private file not present';
    const lv = await assertSilent(page, 'item2', 300);
    record(2, { ...res, speaker: lv.postPeak });
  }

  // ---------- 3: stem separation ----------
  if (want(3)) {
    const truth = await fixture(page, 'steady');
    await ev(page, (p) => window.mgTest.newFromRecording(p), truth.files.mix);
    const t0 = Date.now();
    const r = await ev(page, () => window.mgTest.separateStems());
    const wall = (Date.now() - t0) / 1000;
    await ev(page, () => window.mgTest.waitReady(30000));
    await ev(page, () => window.mgTest.openDock('rec'));
    await screenshot(app, 'r6-3-stems');
    // How much of each stem is the right instrument: project the stem on each true part
    // (each part rendered alone); share = energy on the right part / energy on all parts.
    const parts = {};
    for (const k of ['drums', 'bass', 'rhythm', 'lead']) parts[k] = monoOf(readWav16(truth.files[k]));
    const guitar = parts.rhythm.map((v, i) => v + parts.lead[i]);
    const ref = { drums: parts.drums, bass: parts.bass, guitar };
    const mixE = energy(monoOf(readWav16(truth.files.mix)));
    const purity = {};
    for (const st of r.stems) {
      const x = monoOf(readWav16(st.file));
      const proj = {};
      let tot = 0;
      for (const [k, y] of Object.entries(ref)) { proj[k] = dot(x, y) ** 2 / energy(y); tot += proj[k]; }
      const e = energy(x);
      purity[st.name] = {
        energyOfMixPct: +(100 * e / mixE).toFixed(1),
        rightInstrumentPct: ref[st.name] ? +(100 * proj[st.name] / Math.max(1e-12, tot)).toFixed(1) : null,
        explainedByPartsPct: +(100 * Math.min(1, tot / Math.max(1e-12, e))).toFixed(1),
        onParts: Object.fromEntries(Object.entries(proj).map(([k, v]) => [k, +(100 * v / Math.max(1e-12, tot)).toFixed(1)])),
      };
    }
    const tracks = await ev(page, () => window.mgTest.song().tracks.map((t) => ({ name: t.name, mute: t.mixer.mute, stem: t.analysis?.stem ?? null })));
    check(r.stems.length === 6, 'six stems');
    const lv = await assertSilent(page, 'item3', 300);
    record(3, { model: 'htdemucs_6s', provider: r.provider, separateSeconds: r.seconds, wallSeconds: +wall.toFixed(1), audioSeconds: +r.audioSeconds.toFixed(1), purity, tracks, speaker: lv.postPeak });
  }

  // ---------- 4: audio to notes ----------
  if (want(4)) {
    const truth = await fixture(page, 'steady');
    await ev(page, (p) => window.mgTest.newFromRecording(p), truth.files.mix);
    await ev(page, () => window.mgTest.detectBeats());
    const st = await ev(page, () => window.mgTest.separateStems());
    const tn = (k) => truth.tracks.find((t) => t.name.toLowerCase().startsWith(k)).notes;
    const samePitch = (a, b) => a.pitch === b.pitch;
    const res = {};
    const run = async (label, trackId, kind, ref, grid = '1/16', loose = false) => {
      const r = await ev(page, ({ trackId, kind, grid, loose }) => window.mgTest.transcribe(trackId, { kind, grid, loose }), { trackId, kind, grid, loose });
      const notes = await ev(page, (id) => window.mgTest.trackNotesInRecording(id), r.trackId);
      const f = fscore(ref, notes, 0.05, samePitch);
      const rawF = fscore(ref, r.raw.map((n) => ({ t: n.startS, pitch: n.pitch })), 0.05, samePitch);
      res[label] = { f: f.f, p: f.p, r: f.r, notes: f.est, truth: f.ref, meanErrMs: f.meanErrMs, modelOnlyF: rawF.f, provider: r.provider, inferMs: r.inferMs };
      return { r, notes };
    };
    const cleanBass = await ev(page, ({ p }) => window.mgTest.importAligned(p, 'Part: bass'), { p: truth.files.bass });
    const cb = await run('bass (clean part, 1/16 grid)', cleanBass, 'bass', tn('bass'));
    await run('bass (clean part, loose timing)', cleanBass, 'bass', tn('bass'), '1/16', true);
    await run('bass (bass stem)', st.trackIds.bass, 'bass', tn('bass'));
    const cleanLead = await ev(page, ({ p }) => window.mgTest.importAligned(p, 'Part: lead'), { p: truth.files.lead });
    await run('lead guitar (clean part)', cleanLead, 'lead', tn('lead'));
    const cleanRhythm = await ev(page, ({ p }) => window.mgTest.importAligned(p, 'Part: rhythm'), { p: truth.files.rhythm });
    await run('rhythm guitar chords (clean part)', cleanRhythm, 'guitar', tn('rhythm'));
    const gs = await run('guitar stem (rhythm + lead)', st.trackIds.guitar, 'guitar', [...tn('rhythm'), ...tn('lead')].sort((a, b) => a.t - b.t));
    // Playable positions on the bass transcription: every note has string/fret, pitch = open string + fret.
    const bassTrack = await ev(page, (id) => { const s = window.mgTest.song(); const t = s.tracks.find((x) => x.id === id); return { tuning: t.tuning, mode: t.display.mode }; }, cb.r.trackId);
    const placed = cb.notes.filter((n) => n.string && n.fret !== null && bassTrack.tuning[n.string - 1] + n.fret === n.pitch && n.fret <= 24).length;
    const chords = await ev(page, () => window.mgTest.song().chordSymbols.filter((c) => c.source === 'detected').length);
    await ev(page, (id) => { const s = window.mgTest.song(); window.mgTest.setSelTrack(s.tracks.findIndex((t) => t.id === id)); }, cb.r.trackId);
    await screenshot(app, 'r6-4-bass-transcribed');
    res.playablePositions = `${placed}/${cb.notes.length}`;
    res.detectedChordSymbols = chords;
    res.guitarStemNotes = gs.notes.length;
    // Real-world benchmark: the private file's bass stem vs its bass chart.
    if (existsSync(PRIVATE)) {
      await open(page, PRIVATE);
      const tracks = await ev(page, () => window.mgTest.song().tracks.map((t) => t.name));
      const bi = tracks.findIndex((n) => /bass/i.test(n));
      const chart = await ev(page, (i) => window.mgTest.chartNotes(i), bi);
      const backing = await ev(page, () => window.mgTest.song().backing.path);
      await ev(page, (p) => window.mgTest.newFromRecording(p), backing);
      await ev(page, () => window.mgTest.detectBeats());
      const hs = await ev(page, () => window.mgTest.separateStems());
      const r = await ev(page, (id) => window.mgTest.transcribe(id, { kind: 'bass', grid: '1/16', loose: false }), hs.trackIds.bass);
      const notes = await ev(page, (id) => window.mgTest.trackNotesInRecording(id), r.trackId);
      const raw = r.raw.map((n) => ({ t: n.startS, pitch: n.pitch }));
      // The chart sits a constant ~75 ms from the audio (item 2): also score with that offset removed.
      const off = (() => { const d = []; for (const c of chart.notes) { let b = Infinity; for (const n of raw) if (n.pitch === c.pitch && Math.abs(n.t - c.t) < Math.abs(b)) b = n.t - c.t; if (Math.abs(b) < 0.2) d.push(b); } d.sort((a, b) => a - b); return d[Math.floor(d.length / 2)] ?? 0; })();
      const shifted = chart.notes.map((n) => ({ ...n, t: n.t + off }));
      res.huskerDu = {
        chartNotes: chart.notes.length, transcribed: notes.length, separateSeconds: hs.seconds,
        f: fscore(chart.notes, notes, 0.05, samePitch), fAfterOffset: fscore(shifted, notes, 0.05, samePitch), offsetMs: Math.round(off * 1000),
        fIgnoringOctave: fscore(shifted, notes, 0.05, (a, b) => (a.pitch - b.pitch) % 12 === 0),
      };
    } else res.huskerDu = 'skipped: private file not present';
    const lv = await assertSilent(page, 'item4', 300);
    record(4, { ...res, speaker: lv.postPeak });
  }

  // ---------- 5: drums to a drum track ----------
  if (want(5)) {
    const PIECE = (n) => ({ 35: 'kick', 36: 'kick', 37: 'snare', 38: 'snare', 40: 'snare', 42: 'hhClosed', 44: 'hhClosed', 46: 'hhOpen', 41: 'tomLow', 43: 'tomLow', 45: 'tomLow', 47: 'tomMid', 48: 'tomMid', 50: 'tomHigh', 49: 'crash', 52: 'crash', 55: 'crash', 57: 'crash', 51: 'ride', 53: 'ride', 59: 'ride' })[n] ?? 'other';
    const res = {};
    for (const name of ['steady', 'jazz']) {
      const truth = await fixture(page, name);
      const dt = truth.tracks.find((t) => t.percussion);
      const ref = dt.notes.map((n) => ({ t: n.t, piece: PIECE(n.pitch) }));
      await ev(page, (p) => window.mgTest.newFromRecording(p), truth.files.mix);
      await ev(page, () => window.mgTest.detectBeats());
      const part = await ev(page, ({ p }) => window.mgTest.importAligned(p, 'Part: drums'), { p: truth.files.drums });
      const st = await ev(page, () => window.mgTest.separateStems());
      for (const [label, id] of [['clean part', part], ['drum stem', st.trackIds.drums]]) {
        // Swung parts (Jazz) are read with loose timing: a straight grid would move the swung off-beats.
        const r = await ev(page, ({ id, loose }) => window.mgTest.drumsFromAudio(id, { grid: '1/16', loose }), { id, loose: name === 'jazz' });
        const hits = r.hits.map((h) => ({ t: h.t, piece: h.piece }));
        const notes = (await ev(page, (id) => window.mgTest.trackNotesInRecording(id), r.trackId)).map((n) => ({ t: n.t, piece: PIECE(n.pitch) }));
        const per = {};
        const pieces = [...new Set(ref.map((x) => x.piece))];
        for (const pc of pieces) {
          const f = fscore(ref.filter((x) => x.piece === pc), notes.filter((x) => x.piece === pc), 0.05);
          per[pc] = { f: f.f, p: f.p, r: f.r, n: f.ref, found: f.est };
        }
        const extra = [...new Set(notes.map((x) => x.piece))].filter((p) => !pieces.includes(p)).map((p) => `${p}:${notes.filter((x) => x.piece === p).length}`);
        res[`${name} (${label})`] = { perPiece: per, extraPieces: extra, allHitsF: fscore(ref, hits, 0.05).f, trackNotes: notes.length };
      }
      if (name === 'jazz') {
        await ev(page, () => { const s = window.mgTest.song(); window.mgTest.setSelTrack(s.tracks.length - 1); });
        await screenshot(app, 'r6-5-drums');
      }
    }
    const lv = await assertSilent(page, 'item5', 300);
    record(5, { method: 'onset detection + band-energy classification (no free drum-transcription model in ONNX)', ...res, speaker: lv.postPeak });
  }

  // ---------- 6: review and fix view ----------
  if (want(6)) {
    // Pitch at 50 % speed: a steady 440 Hz tone as the "recording", measured on the review
    // player's own output (before the master bus) while the speakers stay at 0.
    const tone = join(work, 'tone440.wav');
    {
      const sr = 44100, n = sr * 12, b = Buffer.alloc(44 + n * 4);
      b.write('RIFF', 0); b.writeUInt32LE(36 + n * 4, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22);
      b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 4, 40);
      for (let i = 0; i < n; i++) { const v = Math.round(0.4 * 32767 * Math.sin(2 * Math.PI * 440 * i / sr)); b.writeInt16LE(v, 44 + i * 4); b.writeInt16LE(v, 46 + i * 4); }
      writeFileSync(tone, b);
    }
    await ev(page, (p) => window.mgTest.newFromRecording(p), tone);
    await ev(page, () => window.mgTest.waitReady(30000));
    await ev(page, () => window.mgTest.review({ on: true, source: 'original' }));
    await sleep(1500);
    const pitch = {};
    for (const speed of [100, 50]) {
      await ev(page, (sp) => window.mgTest.setPractice({ speed: sp }), speed);
      await ev(page, () => { window.mgTest.seekBar(1); window.mgTest.play(); });
      await sleep(1200);
      const m = await ev(page, () => window.mgTest.reviewPitch(400));
      const pr = await ev(page, () => window.mgTest.reviewProbe());
      const lv = await assertSilent(page, `item6 tone at ${speed}%`, 400);
      await ev(page, () => window.mgTest.pause());
      pitch[speed + '%'] = { hz: +m.hz.toFixed(2), reviewOutputPeak: +m.peak.toFixed(3), audioSeconds: +pr.audioSeconds.toFixed(2), prePeak: +lv.prePeak.toFixed(3) };
    }
    check(Math.abs(pitch['50%'].hz - 440) < 4, 'pitch at 50% should stay 440 Hz, got ' + pitch['50%'].hz);
    await ev(page, () => window.mgTest.setPractice({ speed: 100 }));
    // A real song in review: waveform + beat lines over the one-row score, then the spectrogram.
    const truth = await fixture(page, 'steady');
    await ev(page, (p) => window.mgTest.newFromRecording(p), truth.files.mix);
    await ev(page, () => window.mgTest.detectBeats());
    const st = await ev(page, () => window.mgTest.separateStems());
    const tx = await ev(page, (id) => window.mgTest.transcribe(id, { kind: 'bass', grid: '1/16', loose: false }), st.trackIds.bass);
    await rendered(page, () => ev(page, ({ stem, tx }) => window.mgTest.review({ on: true, source: 'stemtx', stemId: stem, txId: tx, spectrogram: false }), { stem: st.trackIds.bass, tx: tx.trackId }));
    await sleep(1500);
    await screenshot(app, 'r6-6-review-waveform');
    await ev(page, () => window.mgTest.review({ spectrogram: true }));
    await sleep(2500);
    await screenshot(app, 'r6-6-review-spectrogram');
    // Editing still works in review: undo/redo of a beat move.
    const before = await ev(page, () => window.mgTest.song().tempos.length);
    await ev(page, () => { window.mgTest._r6.store.edit((s) => s, 'noop'); });
    const lv = await assertSilent(page, 'item6 review', 300);
    await ev(page, () => window.mgTest.review({ on: false }));
    record(6, { pitch, temposBefore: before, speaker: lv.postPeak, note: 'pitch measured on the review player output (pre-master); speakers 0' });
  }

  // ---------- 7: "Song to Rocksmith" wizard ----------
  if (want(7)) {
    const truth = await fixture(page, 'steady');
    const t0 = Date.now();
    const steps = {};
    const lap = (k) => { steps[k] = +((Date.now() - t0) / 1000).toFixed(1); };
    await ev(page, (p) => window.mgTest.newFromRecording(p), truth.files.mix); lap('load');
    await ev(page, () => window.mgTest.detectBeats()); lap('beats');
    const st = await ev(page, () => window.mgTest.separateStems()); lap('stems');
    const tx = await ev(page, (id) => window.mgTest.transcribe(id, { kind: 'bass', grid: '1/16', loose: false }), st.trackIds.bass); lap('notes');
    await ev(page, () => window.mgTest.openDock('rec'));
    await screenshot(app, 'r6-7-wizard');
    const before = await ev(page, (id) => window.mgTest.trackNotesInRecording(id), tx.trackId);
    const settings = await ev(page, () => window.mgTest.wizardSettings());
    check(settings.audio === 'file' && settings.arrangements.some((a) => a.type === 'Bass'), 'wizard settings use the recording and a bass arrangement');
    const out = join(work, 'rs-steady');
    const res = await ev(page, ([s, d]) => window.mgTest.exportRocksmith(s, d), [settings, out]); lap('export');
    record(7, { steps, stage: res.stage, psarc: res.psarc ? res.psarc.split(/[\\/]/).pop() : null, audio: res.audio, issues: res.issues.length, arrangements: res.arrangements.map((a) => `${a.arrangement}:${a.ddLevels}dd`), offsetMs: settings.audioOffsetMs });
    // Round trip: open the .psarc, line its audio up with the original recording (cross-correlation),
    // then compare the chart's notes with the notes before export and with the true notes.
    if (res.psarc) {
      await open(page, res.psarc);
      const tr = await ev(page, () => window.mgTest.song().tracks.map((t) => t.name));
      const bi = tr.findIndex((n) => /bass/i.test(n));
      const chart = await ev(page, (i) => window.mgTest.chartNotes(i), bi);
      const back = await ev(page, () => window.mgTest.song().backing.path);
      const { lagMs } = await ev(page, ([a, b]) => window.mgTest.alignAudio(a, b), [truth.files.mix, back]);
      const notesRec = chart.notes.map((n) => ({ t: n.t - lagMs / 1000, pitch: n.pitch }));
      const vsBefore = fscore(before.map((n) => ({ t: n.t, pitch: n.pitch })), notesRec, 0.05, (a, b) => a.pitch === b.pitch);
      const errs = [];
      for (const n of before) { let b = Infinity; for (const c of notesRec) if (c.pitch === n.pitch && Math.abs(c.t - n.t) < Math.abs(b)) b = c.t - n.t; if (Math.abs(b) < 0.05) errs.push(Math.abs(b)); }
      const tn = truth.tracks.find((t) => t.name.toLowerCase().startsWith('bass')).notes;
      const vsTruth = fscore(tn, notesRec, 0.05, (a, b) => a.pitch === b.pitch);
      record(7, {
        roundTrip: {
          chartNotes: chart.notes.length, notesBeforeExport: before.length, audioLagMs: +lagMs.toFixed(1), leadInMs: res.audio.leadInMs,
          vsBeforeExport: { f: vsBefore.f, meanAbsErrMs: +(1000 * errs.reduce((a, b) => a + b, 0) / Math.max(1, errs.length)).toFixed(1), maxAbsErrMs: +(1000 * Math.max(0, ...errs)).toFixed(1) },
          vsTrueNotes: { f: vsTruth.f, meanErrMs: vsTruth.meanErrMs },
        },
      });
      check(Math.max(0, ...errs) <= 0.02, 'round-trip notes within 20 ms of the audio');
    }
    if (existsSync(PRIVATE)) {
      const h0 = Date.now();
      await open(page, PRIVATE);
      const backing = await ev(page, () => window.mgTest.song().backing.path);
      await ev(page, (p) => window.mgTest.newFromRecording(p), backing);
      await ev(page, () => window.mgTest.detectBeats());
      const hs = await ev(page, () => window.mgTest.separateStems());
      const htx = await ev(page, (id) => window.mgTest.transcribe(id, { kind: 'bass', grid: '1/16', loose: false }), hs.trackIds.bass);
      const hset = await ev(page, () => window.mgTest.wizardSettings());
      const hout = join(work, 'rs-private');
      const hres = await ev(page, ([s, d]) => window.mgTest.exportRocksmith(s, d), [hset, hout]);
      record(7, { huskerDu: { stage: hres.stage, notes: htx.notes, ddLevels: hres.arrangements.map((a) => a.ddLevels), issues: hres.issues.length, minutes: +((Date.now() - h0) / 60000).toFixed(1), outputsDeleted: true } });
      rmSync(hout, { recursive: true, force: true });
    } else record(7, { huskerDu: 'skipped: private file not present' });
    rmSync(out, { recursive: true, force: true });
    const lv = await assertSilent(page, 'item7', 300);
    record(7, { speaker: lv.postPeak });
  }

  // ---------- 8: sheet music from PDF ----------
  if (want(8)) {
    await open(page, td('ode-to-joy-piano.musicxml'));
    const original = await ev(page, (p) => window.mgTest.reimportCount(p), td('ode-to-joy-piano.musicxml'));
    const pdfDir = join(work, 'pdf');
    const ex = await ev(page, (d) => window.mgTest.exportAll(d, { wav: false, mp3: false, midi: false, musicxml: false, gp: false, pdf: true }), pdfDir);
    const pdf = ex.files.find((f) => f.kind === 'pdf')?.path;
    check(!!pdf, 'PDF exported');
    await ev(page, () => window.mgTest.omrAutoAccept(true));
    const t0 = Date.now();
    const r = await ev(page, (p) => window.mgTest.omrImport(p), pdf);
    const read = await ev(page, (p) => window.mgTest.reimportCount(p), r.files[0]);
    await ev(page, () => window.mgTest.openDock('rec'));
    await screenshot(app, 'r6-8-sheet-music');
    const lv = await assertSilent(page, 'item8', 300);
    record(8, {
      pdf: pdf.split(/[\\/]/).pop(), seconds: +((Date.now() - t0) / 1000).toFixed(1), files: r.files.map((f) => f.split(/[\\/]/).pop()),
      notesOriginal: original.notes, notesRead: read.notes, barsOriginal: original.bars, barsRead: read.bars, tracksRead: read.tracks,
      notesMatchPct: +(100 * Math.min(read.notes, original.notes) / Math.max(read.notes, original.notes)).toFixed(1),
      unsure: r.issues.slice(0, 12), unsureCount: r.issues.length, speaker: lv.postPeak,
    });
  }

  // ---------- 9: save/load and undo of Round 6 results ----------
  if (want(9)) {
    const truth = await fixture(page, 'steady');
    await ev(page, (p) => window.mgTest.newFromRecording(p), truth.files.mix);
    await ev(page, () => window.mgTest.detectBeats());
    const st = await ev(page, () => window.mgTest.separateStems());
    const tx = await ev(page, (id) => window.mgTest.transcribe(id, { kind: 'bass', grid: '1/16', loose: false }), st.trackIds.bass);
    const before = await ev(page, () => { const s = window.mgTest.song(); return { tracks: s.tracks.length, bars: s.bars.length, tempos: s.tempos.length, recording: s.recording, analysis: s.tracks.map((t) => t.analysis?.kind ?? null) }; });
    const proj = join(work, 'r6-save.mgproj');
    await ev(page, (p) => window.mgTest.saveProjectTo(p), proj);
    await ev(page, (p) => window.mgTest.openPath(p), proj);
    await ev(page, () => window.mgTest.waitReady(30000));
    const after = await ev(page, () => { const s = window.mgTest.song(); return { tracks: s.tracks.length, bars: s.bars.length, tempos: s.tempos.length, recording: s.recording, analysis: s.tracks.map((t) => t.analysis?.kind ?? null), clipsExist: s.tracks.filter((t) => t.audio).map((t) => t.audio.clips[0].file) }; });
    const exist = [];
    for (const f of after.clipsExist) exist.push(await ev(page, (p) => window.mgTest.fileExists(p), f));
    const saved = JSON.parse(readFileSync(proj, 'utf8'));
    check(JSON.stringify(before.analysis) === JSON.stringify(after.analysis) && before.bars === after.bars && after.recording?.trackId === before.recording?.trackId, 'save/load keeps Round 6 tracks');
    // Undo: the transcription, then the stems, then the beats go away step by step.
    await ev(page, (p) => window.mgTest.newFromRecording(p), truth.files.mix);
    await ev(page, () => window.mgTest.detectBeats());
    const s2 = await ev(page, () => window.mgTest.separateStems());
    await ev(page, (id) => window.mgTest.transcribe(id, { kind: 'bass', grid: '1/16', loose: false }), s2.trackIds.bass);
    const counts = [await ev(page, () => window.mgTest.song().tracks.length)];
    for (let k = 0; k < 3; k++) { await ev(page, () => window.mgTest.undo()); counts.push(await ev(page, () => ({ tracks: window.mgTest.song().tracks.length, bars: window.mgTest.song().bars.length }))); }
    await ev(page, () => window.mgTest.redo());
    const redo = await ev(page, () => window.mgTest.song().bars.length);
    const lv = await assertSilent(page, 'item9', 300);
    record(9, { schemaVersion: saved.schemaVersion, before, after: { ...after, clipsExist: exist }, undoSteps: counts, redoBars: redo, transcriptionTrack: tx.trackId, speaker: lv.postPeak });
  }

  // ---------- 10: the download question, answered with the real buttons ----------
  if (want(10)) {
    // The question only appears for a model that is not there yet: remove basic-pitch (0.23 MB; item 1
    // and later items downloaded it) after stopping the worker that has it loaded.
    await ev(page, () => window.mgTest.mlCancel());
    await sleep(500);
    rmSync(join(MODEL_PROFILE, 'models', 'basic-pitch'), { recursive: true, force: true });
    await ev(page, () => window.mgTest.mlAutoAccept(false));
    const clickIn = (label) => ev(page, (l) => {
      const b = [...document.querySelectorAll('[data-testid="confirm"] button')].find((x) => x.textContent === l);
      if (!b) throw new Error('no ' + l + ' button');
      b.click();
    }, label);
    const waitQuestion = async () => {
      for (let i = 0; i < 100; i++) { if (await ev(page, () => !!document.querySelector('[data-testid="confirm"]'))) return ev(page, () => document.querySelector('[data-testid="confirm"] p').textContent); await sleep(100); }
      throw new Error('no download question shown');
    };
    // Cancel: nothing downloads, the job returns nothing.
    const p1 = ev(page, () => window.mgTest.mlProbe());
    const q1 = await waitQuestion();
    await clickIn('Cancel');
    const r1 = await p1;
    const after1 = await ev(page, () => window.mgTest.mlModels().then((m) => m.find((x) => x.id === 'basic-pitch').installed));
    // Download: the model arrives and the job runs.
    const p2 = ev(page, () => window.mgTest.mlProbe());
    await waitQuestion();
    await clickIn('Download');
    const r2 = await p2;
    const after2 = await ev(page, () => window.mgTest.mlModels().then((m) => m.find((x) => x.id === 'basic-pitch').installed));
    check(r1 === null && !after1, 'Cancel downloads nothing');
    check(!!r2 && after2, 'Download downloads and runs');
    const lv = await assertSilent(page, 'item10', 300);
    record(10, { question: q1, cancel: { result: r1, installed: after1 }, download: { provider: r2.provider, installed: after2 }, speaker: lv.postPeak });
    await ev(page, () => window.mgTest.mlAutoAccept(true));
  }
} catch (e) {
  console.error(e);
  report.error = String(e?.stack ?? e);
  process.exitCode = 1;
} finally {
  try { await app?.close(); } catch { /* ignore */ }
  await sleep(500);
  rmSync(work, { recursive: true, force: true });
  cleanProfile();
  if (!keepModels && only === undefined) { /* full run: models stay for the next run; delete with --clean-models */ }
  if (process.argv.includes('--clean-models')) rmSync(MODEL_PROFILE, { recursive: true, force: true });
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(RESULTS, 'report-round6.json'), JSON.stringify(report, null, 1));
  console.log('report: test-results/report-round6.json');
}
