// Round 7 checks in the built app. Hidden + muted throughout: the speaker level (post-gain analyser)
// is measured on every step that makes sound and must be 0.
// Sound check: item 3 only (the sung Ode to Joy, 8 s, master gain 0.5); skip with --no-sound-check.
// Usage: node tests/e2e/round7.mjs [--dev] [--only=1,5] [--no-sound-check] [--songs=N] [--clean-models]
// Item 5 reads official Rocksmith songs in place from E:\Rocksmith2014\dlc (read-only) and the custom
// songs in TestData/private; their extracted audio, stems and transcriptions go to temp folders that
// are deleted at the end.
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { launch, RESULTS, ROOT, screenshot, sleep, td, windowInfo } from './harness.mjs';

const dev = process.argv.includes('--dev');
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const noSound = process.argv.includes('--no-sound-check');
const songLimit = Number(process.argv.find((a) => a.startsWith('--songs='))?.slice(8) ?? 99);
setTimeout(() => { console.error('GLOBAL TIMEOUT (150 min)'); process.exit(2); }, 150 * 60000).unref();
const report = { startedAt: new Date().toISOString(), mode: dev ? 'dev' : 'packaged', items: {}, soundChecks: [], speakerLevels: [] };
const want = (n) => !only || only.includes(String(n));
const work = mkdtempSync(join(tmpdir(), 'mg-r7-'));
const MODEL_PROFILE = join(tmpdir(), 'musicgenie-r6-models');
const RS_DLC = 'E:\\Rocksmith2014\\dlc';
// Official songs (Ubisoft charts): styles, tunings, bass + guitar.
const OFFICIAL = [
  ['creep_p.psarc', 'Radiohead - Creep (rock)'],
  ['cherubrock_p.psarc', 'Smashing Pumpkins - Cherub Rock (Eb)'],
  ['jimipurple_p.psarc', 'Jimi Hendrix - Purple Haze (Eb)'],
  ['queeanot_p.psarc', 'Queen - Another One Bites the Dust (funk bass)'],
  ['bobmthre_p.psarc', 'Bob Marley - Three Little Birds (reggae)'],
  ['nofxlino_p.psarc', 'NOFX (punk, fast)'],
  ['weezerbuddy_p.psarc', 'Weezer - Buddy Holly (Eb)'],
  ['misirlou_p.psarc', 'Dick Dale - Misirlou (surf)'],
  ['kansdust_p.psarc', 'Kansas - Dust in the Wind (acoustic)'],
  ['stoosear_p.psarc', 'Stone Sour (down-tuned)'],
  ['toadposs_p.psarc', 'Toadies - Possum Kingdom'],
  ['ccrbadm_p.psarc', 'CCR - Bad Moon Rising'],
];
const PRIVATE_DIR = join(ROOT, 'TestData', 'private');

const ODE_V1 = 'Joyful, joyful, we adore thee, God of glory, Lord of love; Hearts unfold like flowers before thee, Opening to the sun above. Melt the clouds of sin and sadness; drive the dark of doubt away; Giver of immortal gladness, fill us with the light of day!';
const ODE_V2 = 'All Thy works with joy sur-round Thee, earth and heav-en re-flect Thy rays, stars and an-gels sing a-round Thee, cen-ter of un-bro-ken praise. Field and for-est, vale and moun-tain, flow-ery mead-ow, flash-ing sea, chant-ing bird and flow-ing foun-tain, call us to re-joice_ in Thee.';

function record(item, data) {
  report.items[item] = { ...(report.items[item] ?? {}), ...data };
  console.log(`item ${item}:`, JSON.stringify(data).slice(0, 3000));
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
const stripHeld = (a) => a.filter((x) => x && x !== '_');
const norm = (w) => w.toLowerCase().replace(/[^a-z']/g, '');
function wordAccuracy(refText, hypWords) {
  const ref = refText.split(/\s+/).map((w) => norm(w.replace(/-/g, ''))).filter(Boolean);
  const hyp = hypWords.map(norm).filter(Boolean);
  const dp = Array.from({ length: ref.length + 1 }, (_, i) => Array.from({ length: hyp.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= ref.length; i++) for (let j = 1; j <= hyp.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
  const wer = dp[ref.length][hyp.length] / ref.length;
  return { wordAccuracy: +(1 - wer).toFixed(3), wer: +wer.toFixed(3), refWords: ref.length, hypWords: hyp.length };
}
/** One-to-one matching within tol (s). */
function fscore(ref, est, tol, same = () => true) {
  const used = new Uint8Array(est.length);
  const sorted = est.map((e, i) => ({ e, i })).sort((a, b) => a.e.t - b.e.t);
  let tp = 0;
  const matchedRef = new Uint8Array(ref.length);
  ref.forEach((r, ri) => {
    let best = -1, bd = tol + 1e-9;
    for (const { e, i } of sorted) {
      if (e.t < r.t - tol) continue;
      if (e.t > r.t + tol) break;
      if (used[i] || !same(r, e)) continue;
      const d = Math.abs(e.t - r.t);
      if (d <= bd) { bd = d; best = i; }
    }
    if (best >= 0) { used[best] = 1; tp++; matchedRef[ri] = 1; }
  });
  const p = est.length ? tp / est.length : 0, rr = ref.length ? tp / ref.length : 0;
  return { f: +(p + rr ? (2 * p * rr) / (p + rr) : 0).toFixed(3), p: +p.toFixed(3), r: +rr.toFixed(3), tp, ref: ref.length, est: est.length, usedEst: used, matchedRef };
}
const fOnly = (x) => ({ f: x.f, p: x.p, r: x.r, ref: x.ref, est: x.est });
const samePitch = (a, b) => a.pitch === b.pitch;
const sameClass = (a, b) => (((a.pitch - b.pitch) % 12) + 12) % 12 === 0;
/** Median time offset (s) between same-pitch neighbours within 200 ms. */
function medianOffset(ref, est) {
  const d = [];
  const s = est.slice().sort((a, b) => a.t - b.t);
  for (const r of ref) {
    let b = Infinity;
    for (const e of s) { if (e.t < r.t - 0.2) continue; if (e.t > r.t + 0.2) break; if (e.pitch === r.pitch && Math.abs(e.t - r.t) < Math.abs(b)) b = e.t - r.t; }
    if (Number.isFinite(b)) d.push(b);
  }
  d.sort((a, b) => a - b);
  return d.length ? d[d.length >> 1] : 0;
}
/** Scores for one part: raw, chart offset removed, + octave ignored, + loose timing (250 ms). */
function scoreSet(truth, est) {
  const off = medianOffset(truth, est);
  const sh = truth.map((n) => ({ ...n, t: n.t + off }));
  return {
    offsetMs: Math.round(off * 1000),
    raw: fOnly(fscore(truth, est, 0.05, samePitch)),
    offsetRemoved: fOnly(fscore(sh, est, 0.05, samePitch)),
    octaveIgnored: fOnly(fscore(sh, est, 0.05, sameClass)),
    timingIgnored: fOnly(fscore(sh, est, 0.25, samePitch)),
    _sh: sh,
  };
}
/** Rocksmith arrangement JSON (helper) -> true notes in recording seconds. */
const RS_STD = { bass: [28, 33, 38, 43], guitar: [40, 45, 50, 55, 59, 64] };
function truthNotes(arr) {
  const bass = arr.name === 'Bass';
  const std = bass ? RS_STD.bass : RS_STD.guitar;
  const tun = std.map((p, i) => p + (arr.tuning[i] ?? 0));
  const out = [];
  const add = (n, t) => { if ((n.mask & 32) === 0) out.push({ t: t / 1000, pitch: tun[n.s] + n.f }); };
  for (const n of arr.notes) add(n, n.t);
  for (const c of arr.chords) {
    const tpl = arr.chordTemplates[c.id];
    if (c.notes?.length) for (const n of c.notes) add(n, c.t);
    else if (tpl) tpl.frets.forEach((f, s) => { if (f >= 0 && (c.mask & 4) === 0) out.push({ t: c.t / 1000, pitch: tun[s] + f }); });
  }
  out.sort((a, b) => a.t - b.t || a.pitch - b.pitch);
  return { notes: out, tuning: tun, centOffset: arr.centOffset ?? 0 };
}
function dedupe(notes) {
  const out = [];
  for (const n of notes.slice().sort((a, b) => a.t - b.t)) if (!out.some((o) => o.pitch === n.pitch && Math.abs(o.t - n.t) < 0.03)) out.push(n);
  return out;
}
/** Bars (from the chart's beat markers) where chart and transcription disagree most. */
function worstBars(beats, sc, truthSh, est) {
  const fr = fscore(truthSh, est, 0.05, samePitch);
  const downs = beats.filter((b) => b[1] >= 0).map((b) => b[0] / 1000);
  const barOf = (t) => { let k = 0; while (k + 1 < downs.length && downs[k + 1] <= t) k++; return k; };
  const miss = new Map();
  truthSh.forEach((n, i) => { if (!fr.matchedRef[i]) { const b = barOf(n.t); miss.set(b, (miss.get(b) ?? 0) + 1); } });
  est.forEach((n, i) => { if (!fr.usedEst[i]) { const b = barOf(n.t); miss.set(b, (miss.get(b) ?? 0) + 1); } });
  return [...miss.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([b, n]) => ({ bar: b + 1, atS: +(downs[b] ?? 0).toFixed(1), disagreements: n }));
}

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

  const odeWithLyrics = async () => {
    await open(page, td('ode-to-joy-piano.musicxml'));
    await ev(page, () => { window.mgTest.setSelTrack(0); window.mgTest.openDock('lyrics'); });
    await sleep(200);
    const v = await ev(page, () => window.mgTest.text('lyrics-panel') !== null && document.querySelector('[data-testid="lyr-verse"]').value);
    check(v === '0', 'a newly opened song starts at verse 1 (was ' + v + ')');
    await ev(page, (t) => window.mgTest.setField('lyr-text', t), ODE_V1);
    await rendered(page, () => ev(page, () => window.mgTest.click('lyr-apply')));
  };

  // ---------- 1: lyrics ----------
  if (want(1)) {
    await odeWithLyrics();
    const msg = await ev(page, () => window.mgTest.text('lyr-msg'));
    // Verse 2 through the same panel (verse select -> 2).
    await ev(page, () => window.mgTest.setField('lyr-verse', '1'));
    await ev(page, (t) => window.mgTest.setField('lyr-text', t), ODE_V2);
    await rendered(page, () => ev(page, () => window.mgTest.click('lyr-apply')));
    const v1 = await ev(page, () => window.mgTest.verse(0, 0));
    const v2 = await ev(page, () => window.mgTest.verse(0, 1));
    const held = await ev(page, () => window.mgTest.lyricEvents(0, 1).filter((e) => e.notes > 1).map((e) => e.text));
    await ev(page, () => window.mgTest.openDock('lyrics'));
    await sleep(400);
    await screenshot(app, 'r7-1-lyrics');
    // Save / reopen.
    const proj = join(work, 'ode-lyrics.mgproj');
    await ev(page, (p) => window.mgTest.saveTo(p), proj);
    await open(page, proj);
    const r1 = await ev(page, () => [window.mgTest.verse(0, 0), window.mgTest.verse(0, 1)]);
    // Export -> re-import: MusicXML, Guitar Pro, MIDI (verse 1).
    const rt = {};
    for (const kind of ['musicxml', 'gp', 'mid']) {
      await open(page, proj);
      const f = join(work, 'ode.' + kind);
      await ev(page, ([k, p]) => window.mgTest.exportTo(k, p), [kind, f]);
      await open(page, f);
      const got = await ev(page, () => {
        const s = window.mgTest.song();
        const ti = s.tracks.findIndex((_, i) => window.mgTest.hasLyrics(i));
        if (ti < 0) return { v1: [], v2: [] };
        // A MIDI piano is split at middle C: read both staves in time order.
        const t = s.tracks[ti];
        const out = [[], []];
        for (const vn of [0, 1]) {
          const rows = [];
          t.staves.forEach((st, si) => {
            const starts = []; let acc = 0;
            for (const b of s.bars) { starts.push(acc); acc += b.timeSignature.numerator * 3840 / b.timeSignature.denominator; }
            st.measures.forEach((m, bi) => { let tk = starts[bi]; for (const b of m.voices[0]?.beats ?? []) { const l = b.lyrics?.[vn]; if (l && !b.grace) rows.push({ tk, l }); if (!b.grace) { const base = 3840 / b.duration.base; let d = base * (b.duration.dots === 1 ? 1.5 : b.duration.dots === 2 ? 1.75 : 1); if (b.duration.tuplet) d = d * b.duration.tuplet.den / b.duration.tuplet.num; tk += d; } } });
            void si;
          });
          out[vn] = rows.sort((a, b) => a.tk - b.tk).map((r) => r.l);
        }
        return { v1: out[0], v2: out[1] };
      });
      rt[kind] = { verse1: got.v1.filter((x) => x !== '_').join(' ') === stripHeld(v1).join(' '), verse2: got.v2.filter((x) => x !== '_').join(' ') === stripHeld(v2).join(' '), syllables: [got.v1.length, got.v2.length] };
    }
    // PDF through the export dialog's code path (page 1 as PNG to look at).
    await open(page, proj);
    const pdf = await ev(page, (d) => window.mgTest.exportAll(d, { stems: 'none', tailMs: 0, wav: false, mp3: false, midi: false, musicxml: false, gp: false, pdf: true, pdfMode: 'notation' }), join(work, 'pdf'));
    const pdfPng = pdf.pdf?.png;
    if (pdfPng && existsSync(pdfPng)) copyFileSync(pdfPng, join(RESULTS, 'r7-1-pdf-page1.png'));
    const lv = await assertSilent(page, 'item1', 300);
    check(stripHeld(v1).length >= 55, 'verse 1 syllables');
    check(JSON.stringify(r1) === JSON.stringify([v1, v2]), 'save/reopen keeps every syllable');
    check(rt.musicxml.verse1 && rt.musicxml.verse2 && rt.gp.verse1 && rt.gp.verse2 && rt.mid.verse1, 'export round trips');
    record(1, { pasteMessage: msg, verse1Syllables: stripHeld(v1).length, verse2Syllables: stripHeld(v2).length, heldSyllables: held, saveReopenIdentical: true, roundTrips: rt, pdfPages: pdf.pdf?.pages ?? null, speaker: lv.postPeak });
  }

  // ---------- 2: Rocksmith vocals ----------
  if (want(2)) {
    await odeWithLyrics();
    await ev(page, () => window.mgTest.setStyle('rock'));
    await rendered(page, () => ev(page, () => window.mgTest.clickGenerate()));
    await ev(page, () => window.mgTest.waitReady(30000));
    const s = await ev(page, () => window.mgTest.song().tracks.map((t) => ({ id: t.id, name: t.name, strings: t.tuning?.length ?? 0 })));
    const bass = s.find((t) => t.strings === 4);
    const settings = { title: 'Ode Vocals Test', artist: 'musicGenie', album: '', year: 2026, arrangements: [{ trackId: bass.id, type: 'Bass' }], audio: 'mix', previewStartMs: 0, vocals: { trackId: s[0].id, verse: 0 } };
    await ev(page, () => window.mgTest.openRsExport(true));
    await sleep(400);
    await screenshot(app, 'r7-2-rs-dialog');
    await ev(page, () => window.mgTest.openRsExport(false));
    const out = join(work, 'rs-ode');
    const res = await ev(page, ([st, d]) => window.mgTest.exportRocksmith(st, d), [settings, out]);
    const expected = await ev(page, () => window.mgTest.lyricEvents(0, 0).length);
    const vIssues = res.issues.filter((i) => i.arrangement === 'Vocals');
    const voc = res.arrangements.find((a) => a.arrangement === 'Vocals');
    let back = null;
    if (res.psarc) {
      const raw = await ev(page, ([p, d]) => window.mgTest.rsRead(p, d), [res.psarc, join(work, 'rs-ode-read')]);
      await open(page, res.psarc);
      const vt = await ev(page, () => { const s2 = window.mgTest.song(); const i = s2.tracks.findIndex((t) => t.name === 'Vocals'); return i < 0 ? null : { i, syll: window.mgTest.verse(i, 0).filter(Boolean) }; });
      back = { rawVocals: raw.vocals?.length ?? 0, lines: (raw.vocals ?? []).filter((v) => v.lyric.endsWith('+')).length, vocalsTrack: !!vt, syllables: vt?.syll.length ?? 0, first: vt?.syll.slice(0, 6) };
      if (vt) {
        await ev(page, (i) => { window.mgTest.setSelTrack(i); window.mgTest.openDock('lyrics'); }, vt.i);
        await sleep(300);
        await screenshot(app, 'r7-2-vocals-imported');
      }
    }
    const lv = await assertSilent(page, 'item2', 300);
    check(res.stage === 'done', 'psarc built: ' + res.stage + ' ' + (res.error ?? ''));
    check(vIssues.length === 0, 'vocals checks: ' + JSON.stringify(vIssues));
    check(back && back.rawVocals === expected && back.syllables === expected, 'vocals round trip');
    record(2, { stage: res.stage, psarc: res.psarc?.split(/[\\/]/).pop(), vocalsXml: voc ? { syllables: voc.syllables } : null, issuesAll: res.issues.map((i) => `${i.arrangement}:${i.type}`), vocalIssues: vIssues.length, expectedSyllables: expected, roundTrip: back, speaker: lv.postPeak });
  }

  // ---------- 3: singing ----------
  let sungWav = null;
  if (want(3) || want(4)) {
    await odeWithLyrics();
    const t0 = Date.now();
    const r = await ev(page, () => window.mgTest.sing(0, 0));
    const vt = await ev(page, () => window.mgTest.voiceTrack(0, 0));
    sungWav = vt.clips[0].file;
    const input = await ev(page, () => window.mgTest.singInput(0, 0));
    // Held notes (>= 400 ms): pitch of the middle 40 % vs the note.
    const cents = [];
    for (const sy of input) for (const n of sy.notes) {
      if (n.durMs < 400) continue;
      const p = await ev(page, ([w, a, l]) => window.mgTest.wavPitch(w, a, l), [sungWav, (n.ms + 0.3 * n.durMs) / 1000, 0.4 * n.durMs / 1000]);
      const want = 440 * 2 ** ((n.pitch - 69) / 12);
      cents.push(p.hz > 0 ? Math.round(1200 * Math.log2(p.hz / want)) : null);
    }
    const ok = cents.filter((c) => c !== null && Math.abs(c) <= 30).length;
    record(3, { engine: 'DiffSinger (Qixuan v2.7.0 voicebank, PC-NSF-HiFiGAN vocoder) on onnxruntime-node', render: r, wallS: +((Date.now() - t0) / 1000).toFixed(1), heldNotes: cents.length, within30cents: ok, centsMinMax: [Math.min(...cents.filter((c) => c !== null)), Math.max(...cents.filter((c) => c !== null))] });
    check(cents.length > 20 && ok === cents.length, 'sung pitch within 30 cents on every held note');
    // Out of date after a lyrics edit, up to date after singing again; auto re-sing after an edit.
    await ev(page, () => { const s = window.mgTest.song(); window.mgTest._r6.store.edit((x) => x, 'noop'); void s; });
    await ev(page, () => window.mgTest.setField('lyr-syl-4', 'you'));
    const stale = await ev(page, () => window.mgTest.voiceTrack(0, 0).outOfDate);
    await ev(page, () => window.mgTest.sing(0, 0));
    const fresh = await ev(page, () => window.mgTest.voiceTrack(0, 0).outOfDate);
    await ev(page, () => { const st = window.mgTest._r6.store; const t = st.state.song.tracks.find((x) => x.voice); st.updateTrack(t.id, (x) => ({ ...x, voice: { ...x.voice, auto: true } }), 'auto'); });
    await ev(page, () => window.mgTest.setField('lyr-syl-4', 'we'));
    let autoOk = false;
    for (let i = 0; i < 120 && !autoOk; i++) { await sleep(1000); autoOk = await ev(page, () => !window.mgTest.voiceTrack(0, 0).outOfDate && !window.mgTest.mlState().job); }
    await ev(page, () => window.mgTest.openDock('lyrics'));
    await sleep(500);
    await screenshot(app, 'r7-3-singing');
    // Review view: the sung track as waveform under the score with its lyrics.
    await rendered(page, () => ev(page, (id) => window.mgTest.review({ on: true, source: 'stem', stemId: id, txId: null, spectrogram: false }), vt.id));
    await sleep(1500);
    await screenshot(app, 'r7-3-review-sung');
    await ev(page, () => window.mgTest.review({ on: false }));
    // Fallback exports.
    const ustx = await ev(page, (p) => window.mgTest.exportTo('ustx', p), join(work, 'ode.ustx'));
    const svp = await ev(page, (p) => window.mgTest.exportTo('svp', p), join(work, 'ode.svp'));
    // Play the sung track muted (the engine really produces sound; speakers stay at 0).
    await ev(page, (id) => { const s = window.mgTest.song(); window.mgTest.soloTrackOnly(s.tracks.findIndex((t) => t.id === id)); }, vt.id);
    await ev(page, () => window.mgTest.play());
    await sleep(1500);
    const lv = await assertSilent(page, 'item3 sung track playing', 1500);
    let sc = null;
    if (!noSound) {
      await ev(page, () => window.mgTest.setMasterGain(0.5));
      const t1 = Date.now();
      const loud = await ev(page, () => window.mgTest.levels(8000));
      await ev(page, () => window.mgTest.setMasterGain(0));
      const unmutedMs = Date.now() - t1;
      await sleep(250);
      const after = await assertSilent(page, 'item3 after sound check', 600);
      sc = { item: 3, what: 'the sung Ode to Joy (DiffSinger), from bar 1', unmutedMs, peakWhileUnmuted: +loud.postPeak.toFixed(4), peakAfterRemute: after.postPeak };
      report.soundChecks.push(sc);
      console.log('  SOUND CHECK item 3:', JSON.stringify(sc));
    }
    await ev(page, () => window.mgTest.stop());
    record(3, { staleAfterEdit: stale, freshAfterResing: !fresh, autoResing: autoOk, ustxBytes: ustx.bytes, svpBytes: svp.bytes, playingPrePeak: +lv.prePeak.toFixed(4), speaker: lv.postPeak, soundCheck: sc });
    check(stale && !fresh && autoOk, 're-render when lyrics change');
  }

  // ---------- 4: vocals from a recording ----------
  if (want(4) && sungWav) {
    const truth = await ev(page, () => window.mgTest.singInput(0, 0));
    const tn = truth.flatMap((s) => s.notes.map((n) => ({ t: n.ms / 1000, pitch: n.pitch })));
    const copy = join(work, 'ode-sung.wav');
    copyFileSync(sungWav, copy);
    await ev(page, (p) => window.mgTest.newFromRecording(p), copy);
    const rec = await ev(page, () => window.mgTest.song().tracks[0].id);
    const t0 = Date.now();
    const r = await ev(page, (id) => window.mgTest.vocals(id, { grid: '1/16', loose: true, lyrics: true }), rec);
    const est = r.raw.map((n) => ({ t: n.startS, pitch: n.pitch }));
    const f50 = fOnly(fscore(tn, est, 0.05, samePitch));
    const f100 = fOnly(fscore(tn, est, 0.1, samePitch));
    const wa = wordAccuracy(ODE_V1, r.words.map((w) => w.word));
    await ev(page, (id) => { const s = window.mgTest.song(); window.mgTest.setSelTrack(s.tracks.findIndex((t) => t.id === id)); window.mgTest.openDock('lyrics'); }, r.trackId);
    await sleep(500);
    await screenshot(app, 'r7-4-vocals-transcribed');
    const lv = await assertSilent(page, 'item4', 300);
    record(4, { melody: { f50, f100, notes: est.length, truth: tn.length, centOffset: r.centOffset }, lyrics: { ...wa, wordsPlaced: r.placed, words: r.words.map((w) => w.word).join(' ') }, seconds: +((Date.now() - t0) / 1000).toFixed(1), speaker: lv.postPeak });
    check(f50.f >= 0.85, 'melody F >= 0.85');
  }

  // ---------- 5: real-song accuracy ----------
  if (want(5)) {
    const songs = [];
    for (const [f, label] of OFFICIAL.slice(0, songLimit)) if (existsSync(join(RS_DLC, f))) songs.push({ path: join(RS_DLC, f), label, official: true });
    if (existsSync(PRIVATE_DIR) && !process.argv.includes('--no-private')) for (const f of readdirSync(PRIVATE_DIR)) if (/\.psarc$/i.test(f)) songs.push({ path: join(PRIVATE_DIR, f), label: f.replace(/_p\.psarc$/i, ''), official: false });
    const results = [];
    for (const sg of songs) {
      const t0 = Date.now();
      const tmp = join(work, 'song-' + results.length);
      try {
        const raw = await ev(page, ([p, d]) => window.mgTest.rsRead(p, d), [sg.path, tmp]);
        const arrs = raw.arrangements;
        const bassArr = arrs.find((a) => a.name === 'Bass');
        const gtrArrs = arrs.filter((a) => a.name === 'Lead' || a.name === 'Rhythm' || a.name === 'Combo');
        if (!raw.audioOgg || (!bassArr && !gtrArrs.length)) { results.push({ song: sg.label, official: sg.official, skipped: 'no audio or no bass/guitar' }); continue; }
        await ev(page, (p) => window.mgTest.newFromRecording(p), raw.audioOgg);
        const st = await ev(page, () => window.mgTest.separateStems());
        const one = { song: sg.label, official: sg.official, seconds: 0, parts: {} };
        const parts = [];
        if (bassArr) parts.push(['bass', bassArr, [bassArr], st.trackIds.bass]);
        if (gtrArrs.length) parts.push(['guitar', gtrArrs[0], gtrArrs, st.trackIds.guitar]);
        for (const [kind, arr0, arrsP, stemId] of parts) {
          const truths = arrsP.map(truthNotes);
          const truth = dedupe(truths.flatMap((x) => x.notes));
          const before = await ev(page, ([id, k]) => window.mgTest.transcribeWith(id, { kind: k, grid: '1/16', loose: true, refine: false }), [stemId, kind]);
          const after = await ev(page, ([id, k]) => window.mgTest.transcribeWith(id, { kind: k, grid: '1/16', loose: true }), [stemId, kind]);
          const b = scoreSet(truth, before.raw.map((n) => ({ t: n.startS, pitch: n.pitch })));
          const aEst = after.raw.map((n) => ({ t: n.startS, pitch: n.pitch }));
          const a = scoreSet(truth, aEst);
          one.parts[kind] = {
            arrangements: arrsP.map((x) => x.name).join('+'), chartNotes: truth.length,
            chartTuning: truths[0].tuning, chartCents: truths[0].centOffset,
            detectedTuning: after.info?.tuning?.name, detectedTuningNotes: after.info?.tuning?.tuning, detectedCents: after.info?.cents,
            refine: { octaveMoved: after.info?.octaveMoved, linesDropped: after.info?.linesDropped, onsetShiftMs: after.info?.onsetShiftMs },
            before: { offsetMs: b.offsetMs, raw: b.raw, offsetRemoved: b.offsetRemoved, octaveIgnored: b.octaveIgnored, timingIgnored: b.timingIgnored },
            after: { offsetMs: a.offsetMs, raw: a.raw, offsetRemoved: a.offsetRemoved, octaveIgnored: a.octaveIgnored, timingIgnored: a.timingIgnored },
            worstBars: worstBars(arr0.beats, a, a._sh, aEst),
          };
          // Undo the two transcriptions (keep the song small).
          await ev(page, () => { window.mgTest.undo(); window.mgTest.undo(); });
        }
        one.seconds = Math.round((Date.now() - t0) / 1000);
        results.push(one);
        console.log('  bench', sg.label, JSON.stringify(Object.fromEntries(Object.entries(one.parts).map(([k, v]) => [k, [v.before.offsetRemoved.f, v.after.offsetRemoved.f]]))));
      } catch (e) {
        results.push({ song: sg.label, official: sg.official, error: String(e?.message ?? e).slice(0, 300) });
      } finally {
        await ev(page, () => window.mgTest.mlCleanTemp());
        rmSync(tmp, { recursive: true, force: true });
        // Stems of this song live in the profile media folder: delete them now.
        rmSync(join(MODEL_PROFILE, 'media'), { recursive: true, force: true });
      }
    }
    // Summary: mean F (offset removed) before/after per part, official and custom separately.
    const mean = (xs) => (xs.length ? +(xs.reduce((s, x) => s + x, 0) / xs.length).toFixed(3) : null);
    const summary = {};
    for (const official of [true, false]) for (const part of ['bass', 'guitar']) {
      const rows = results.filter((r) => r.official === official && r.parts?.[part]).map((r) => r.parts[part]);
      summary[(official ? 'official' : 'custom') + ' ' + part] = {
        songs: rows.length,
        before: { raw: mean(rows.map((x) => x.before.raw.f)), offsetRemoved: mean(rows.map((x) => x.before.offsetRemoved.f)), octaveIgnored: mean(rows.map((x) => x.before.octaveIgnored.f)), timingIgnored: mean(rows.map((x) => x.before.timingIgnored.f)) },
        after: { raw: mean(rows.map((x) => x.after.raw.f)), offsetRemoved: mean(rows.map((x) => x.after.offsetRemoved.f)), octaveIgnored: mean(rows.map((x) => x.after.octaveIgnored.f)), timingIgnored: mean(rows.map((x) => x.after.timingIgnored.f)) },
        tuningRight: rows.filter((x) => JSON.stringify(x.detectedTuningNotes) === JSON.stringify(x.chartTuning)).length,
      };
    }
    const ranked = results.filter((r) => r.parts).map((r) => ({ song: r.song, f: mean(Object.values(r.parts).map((p) => p.after.offsetRemoved.f)), parts: r.parts }))
      .sort((x, y) => x.f - y.f);
    const worst3 = ranked.slice(0, 3).map((r) => ({ song: r.song, f: r.f, bars: Object.fromEntries(Object.entries(r.parts).map(([k, v]) => [k, v.worstBars])) }));
    // Our own renders: no worse than before (Rock band: clean bass, clean lead, guitar stem).
    await open(page, td('ode-to-joy-piano.musicxml'));
    await ev(page, () => window.mgTest.setStyle('rock'));
    await rendered(page, () => ev(page, () => window.mgTest.clickGenerate()));
    await ev(page, () => window.mgTest.waitReady(30000));
    const fx = await ev(page, (d) => window.mgTest.renderFixture(d, 'rock'), work);
    const tn = (prefix) => fx.tracks.find((t) => t.name.toLowerCase().startsWith(prefix)).notes.map((n) => ({ t: n.t, pitch: n.pitch }));
    await ev(page, (p) => window.mgTest.newFromRecording(p), fx.files.mix);
    const ours = {};
    const runOurs = async (label, path, kind, truth) => {
      const id = await ev(page, ([p, n]) => window.mgTest.importAligned(p, n), [path, label]);
      const b = await ev(page, ([i, k]) => window.mgTest.transcribeWith(i, { kind: k, grid: '1/16', loose: true, refine: false }), [id, kind]);
      const a = await ev(page, ([i, k]) => window.mgTest.transcribeWith(i, { kind: k, grid: '1/16', loose: true }), [id, kind]);
      ours[label] = { before: fOnly(fscore(truth, b.raw.map((n) => ({ t: n.startS, pitch: n.pitch })), 0.05, samePitch)).f, after: fOnly(fscore(truth, a.raw.map((n) => ({ t: n.startS, pitch: n.pitch })), 0.05, samePitch)).f, info: a.info };
    };
    await runOurs('bass (clean part)', fx.files.bass, 'bass', tn('bass'));
    await runOurs('lead guitar (clean part)', fx.files.lead, 'lead', tn('lead'));
    await runOurs('rhythm guitar (clean part)', fx.files.rhythm, 'guitar', tn('rhythm'));
    const lv = await assertSilent(page, 'item5', 300);
    writeFileSync(join(RESULTS, 'r7-5-benchmark.json'), JSON.stringify({ results, summary, worst3, ours }, null, 1));
    record(5, { songs: results.length, summary, worst3, ours, speaker: lv.postPeak, perSong: results.map((r) => r.parts ? { song: r.song, official: r.official, seconds: r.seconds, ...Object.fromEntries(Object.entries(r.parts).map(([k, v]) => [k, { before: v.before.offsetRemoved.f, after: v.after.offsetRemoved.f, tuning: `${v.detectedTuning} (chart ${v.chartTuning.join(',')})`, cents: `${v.detectedCents} (chart ${v.chartCents})` }])) } : r) });
  }

  // ---------- 6: "Describe a song" ----------
  if (want(6)) {
    await ev(page, () => window.mgTest._r6.store.openDescribe(true));
    await sleep(200);
    await ev(page, () => window.mgTest.setField('describe-text', '12-bar blues in E, shuffle at 110, guitar, bass, piano and drums, 3 choruses'));
    await ev(page, () => window.mgTest.click('describe-plan'));
    await sleep(300);
    await screenshot(app, 'r7-6-describe-plan');
    const chart = await ev(page, () => window.mgTest.text('describe-chart'));
    await rendered(page, () => ev(page, () => window.mgTest.click('describe-create')));
    await ev(page, () => window.mgTest.waitReady(30000));
    const s = await ev(page, () => { const x = window.mgTest.song(); return { title: x.title, bars: x.bars.length, bpm: x.tempos[0].bpm, swing: x.playback?.swing, tracks: x.tracks.map((t) => t.name + ':' + t.instrument.id), sections: x.sections.map((q) => q.name), repeats: x.bars.filter((b) => b.repeatEnd).map((b) => b.repeatEnd), chords: x.chordSymbols.slice(0, 12).map((c) => c.name) }; });
    await ev(page, () => window.mgTest.play());
    await sleep(2500);
    const lv = await assertSilent(page, 'item6 playing the described song', 1500);
    await ev(page, () => window.mgTest.stop());
    await screenshot(app, 'r7-6-described-song');
    const claude = await ev(page, () => window.mg.describeAvailable());
    check(s.bars === 12 && s.bpm === 110 && s.swing === 1 && s.tracks.length === 4, 'described song built');
    check(lv.prePeak > 0, 'the band really played (pre-gain level)');
    record(6, { chart, song: s, prePeak: +lv.prePeak.toFixed(4), speaker: lv.postPeak, claudeKeySet: claude, unitTests: '15 descriptions in tests/unit/round7.test.ts' });
  }

  // ---------- 7: sound library ----------
  if (want(7)) {
    const sf = join(work, 'test-sine.sf2');
    await ev(page, (p) => window.mgTest.writeSineSf2(p), sf);
    // An SFZ instrument: one sine sample (C4) + the .sfz text, in their own folder.
    const sfzDir = join(work, 'sine-sfz');
    mkdirSync(join(sfzDir, 'samples'), { recursive: true });
    {
      const sr = 44100, n = sr; const b = Buffer.alloc(44 + n * 2);
      b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
      b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
      const f = 261.6255653; const per = Math.round(sr / f * 100) / 100;
      for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(14000 * Math.sin((2 * Math.PI * f * i) / sr)), 44 + i * 2);
      writeFileSync(join(sfzDir, 'samples', 'sine c4.wav'), b);
      writeFileSync(join(sfzDir, 'sine.sfz'), `<control> default_path=samples/\n<group> ampeg_release=0.1\n<region> sample=sine c4.wav pitch_keycenter=c4 lokey=0 hikey=127 loop_mode=loop_continuous loop_start=0 loop_end=${Math.round(per * 100) - 1}\n`);
    }
    await ev(page, (p) => window.mgTest.libraryAdd(p), sf);
    await ev(page, (p) => window.mgTest.libraryAdd(p), join(sfzDir, 'sine.sfz'));
    const lib = await ev(page, () => window.mgTest.library());
    await open(page, td('ode-to-joy-piano.musicxml'));
    await ev(page, () => window.mgTest.setStyle('rock'));
    await rendered(page, () => ev(page, () => window.mgTest.clickGenerate()));
    await ev(page, () => window.mgTest.waitReady(30000));
    const names = await ev(page, () => window.mgTest.song().tracks.map((t) => t.name));
    const bassI = names.findIndex((n) => /bass/i.test(n));
    // Renders: the melody (track 0) and the bass with the song SoundFont, then melody on the sine.
    const highShare = async (file) => ev(page, (p) => window.mg.readFile(p).then((f) => {
      const b = f.bytes; const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
      let o = 12, data = 0, len = 0, ch = 2;
      while (o < b.length) { const id = String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]); const sz = dv.getUint32(o + 4, true); if (id === 'fmt ') ch = dv.getUint16(o + 10, true); if (id === 'data') { data = o + 8; len = sz; break; } o += 8 + sz + (sz & 1); }
      const n = Math.floor(len / (2 * ch)); const x = new Float32Array(n);
      for (let i = 0; i < n; i++) x[i] = dv.getInt16(data + i * 2 * ch, true) / 32768;
      // Energy above ~1.5 kHz (first difference ~ high-pass) vs all.
      let all = 0, hi = 0; for (let i = 1; i < n; i++) { all += x[i] * x[i]; const d = x[i] - x[i - 1]; hi += d * d; }
      return { rms: Math.sqrt(all / n), hiRatio: +(hi / Math.max(1e-12, all)).toFixed(5) };
    }), file);
    const r0 = await ev(page, (p) => window.mgTest.renderTrack(0, p), join(work, 'mel-default.wav'));
    const bass0 = await ev(page, ([i, p]) => window.mgTest.renderTrack(i, p), [bassI, join(work, 'bass-default.wav')]);
    await ev(page, (p) => window.mgTest.setTrackSound(0, { file: p, bank: 0, program: 0, name: 'Test Sine: Test Sine' }), sf);
    let loads = 0;
    for (let i = 0; i < 50; i++) { await sleep(200); loads = await ev(page, () => window.mgTest.soundFontStatus()); if (/library/.test(loads)) break; }
    await ev(page, () => window.mgTest.waitReady(30000));
    await sleep(800);
    const bank = await ev(page, () => window.mgTest.trackBank(0));
    const r1 = await ev(page, (p) => window.mgTest.renderTrack(0, p), join(work, 'mel-sine.wav'));
    const bass1 = await ev(page, ([i, p]) => window.mgTest.renderTrack(i, p), [bassI, join(work, 'bass-after.wav')]);
    const hDef = await highShare(r0.path), hSine = await highShare(r1.path), hb0 = await highShare(bass0.path), hb1 = await highShare(bass1.path);
    // SFZ on the melody instead.
    await ev(page, (p) => window.mgTest.setTrackSound(0, { file: p, bank: 0, program: 0, name: 'sine: sine' }), join(sfzDir, 'sine.sfz'));
    for (let i = 0; i < 50; i++) { await sleep(200); if (await ev(page, () => /library/.test(window.mgTest.soundFontStatus()))) break; }
    await sleep(1200);
    const r2 = await ev(page, (p) => window.mgTest.renderTrack(0, p), join(work, 'mel-sfz.wav'));
    const hSfz = await highShare(r2.path);
    // Back to the SF2, save, reopen: the choice stays.
    await ev(page, (p) => window.mgTest.setTrackSound(0, { file: p, bank: 0, program: 0, name: 'Test Sine: Test Sine' }), sf);
    const proj = join(work, 'sounds.mgproj');
    await ev(page, (p) => window.mgTest.saveTo(p), proj);
    await open(page, proj);
    const after = await ev(page, () => ({ sound: window.mgTest.song().tracks[0].sound, others: window.mgTest.song().tracks.slice(1).map((t) => t.sound ?? null) }));
    await ev(page, () => { window.mgTest.setSelTrack(0); window.mgTest.openDock('sounds'); });
    for (let i = 0; i < 50; i++) { await sleep(200); if (await ev(page, () => /library/.test(window.mgTest.soundFontStatus()))) break; }
    await sleep(1500);
    await screenshot(app, 'r7-7-sound-library');
    const n0 = await ev(page, () => window.mgTest.liveNotesPlayed());
    // The band generator muted the melody track: unmute it so its preview is heard (by the meters).
    await ev(page, () => window.mgTest.setMixer(0, { mute: false }));
    await sleep(2000);
    let lv = null;
    for (let k = 0; k < 3; k++) {
      await ev(page, () => window.mgTest.click('sound-preview'));
      await sleep(200);
      lv = await assertSilent(page, 'item7 preview', 2500);
      if (lv.prePeak > 0.01) break;
    }
    const n1 = await ev(page, () => window.mgTest.liveNotesPlayed());
    record(7, { previewNotes: n1 - n0 });
    for (const it of lib) await ev(page, (p) => window.mgTest.libraryRemove(p), it.file);
    if (!(lv.prePeak > 0.01)) {
      const diag = await ev(page, () => { const s2 = window.mgTest.song(); const st = window.mgTest.state(); return { sel: st.selTrack, t0: s2.tracks[0].name, mute: s2.tracks.map((t) => t.mixer.mute), solo: s2.tracks.map((t) => t.mixer.solo), bank: window.mgTest.trackBank(0), live: window.mgTest.liveSynthName(), sf: window.mgTest.soundFontStatus() }; });
      check(false, 'the preview played (pre-gain level ' + lv.prePeak + ') ' + JSON.stringify(diag));
    }
    check(hSine.hiRatio < hDef.hiRatio * 0.3 && hSfz.hiRatio < hDef.hiRatio * 0.3, 'melody plays the sine library sound');
    check(Math.abs(hb1.hiRatio - hb0.hiRatio) < 0.02 * Math.max(hb0.hiRatio, 1e-6) + 1e-5 && Math.abs(hb1.rms - hb0.rms) < 0.01 * hb0.rms + 1e-6, 'other tracks keep the default sound');
    check(after.sound?.file === sf && after.others.every((x) => x === null), 'save/reopen keeps the choice');
    record(7, { library: lib.map((x) => `${x.kind}:${x.name}`), bank, melodyHighBandRatio: { default: hDef.hiRatio, sineSf2: hSine.hiRatio, sineSfz: hSfz.hiRatio }, bassUnchanged: { before: hb0, after: hb1 }, savedSound: after.sound, previewPrePeak: +lv.prePeak.toFixed(5), speaker: lv.postPeak });
  }

  // ---------- 8: save/load + undo ----------
  if (want(8)) {
    await odeWithLyrics();
    const label = () => ev(page, () => window.mgTest.undoLabel());
    const snap = () => ev(page, () => ({ v: window.mgTest.verse(0, 0).filter(Boolean).length, s2: window.mgTest.verse(0, 0)[2], sound: window.mgTest.song().tracks[0].sound?.name ?? null }));
    const states = [await snap()];
    const labels = [await label()];
    await ev(page, () => window.mgTest.setField('lyr-syl-2', 'JOY'));
    states.push(await snap()); labels.push(await label());
    await ev(page, (p) => window.mgTest.setTrackSound(0, { file: p, bank: 0, program: 0, name: 'x' }, 'Sound: test'), join(work, 'missing.sf2'));
    states.push(await snap()); labels.push(await label());
    // Undo one step at a time: each undo goes back exactly one state.
    const undone = [];
    for (let k = states.length - 1; k >= 1; k--) {
      await ev(page, () => window.mgTest.undo());
      undone.push(JSON.stringify(await snap()) === JSON.stringify(states[k - 1]));
    }
    await ev(page, () => window.mgTest.undo());
    const afterAll = await snap();
    for (let k = 0; k < 3; k++) await ev(page, () => window.mgTest.redo());
    const redone = JSON.stringify(await snap()) === JSON.stringify(states[states.length - 1]);
    const proj = join(work, 'all.mgproj');
    await ev(page, (p) => window.mgTest.saveTo(p), proj);
    const saved = JSON.parse(readFileSync(proj, 'utf8'));
    const before = await ev(page, () => window.mgTest.serialized());
    await open(page, proj);
    const after = await ev(page, () => window.mgTest.serialized());
    const lv = await assertSilent(page, 'item8', 300);
    check(saved.schemaVersion === 7, 'format v7');
    check(JSON.stringify(JSON.parse(before).song) === JSON.stringify(JSON.parse(after).song), 'reopen identical');
    check(undone.every(Boolean) && afterAll.v === 4 && redone, 'one undo step per action ' + JSON.stringify({ states, labels, undone, afterAll, redone }));
    record(8, { schemaVersion: saved.schemaVersion, reopenIdentical: true, undoLabels: labels, eachUndoOneStep: undone, afterUndoingPaste: afterAll, redoAll: redone, speaker: lv.postPeak, note: 'singing, vocals-to-notes and sound choice are one undo step each (items 3/4/7 use them); Describe makes a new song (like Open)' });
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
  if (process.argv.includes('--clean-models')) rmSync(MODEL_PROFILE, { recursive: true, force: true });
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(RESULTS, 'report-round7.json'), JSON.stringify(report, null, 1));
  console.log('report: test-results/report-round7.json');
}
