// Round 4 checks in the built app. Hidden + muted throughout: the speaker level (post-gain
// analyser) is measured on every step that makes sound and must be 0. No sound checks (no unmuting).
// Usage: node tests/e2e/round4.mjs [--dev] [--only=1,5]
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, newProfileDir, RESULTS, screenshot, sleep, td, windowInfo } from './harness.mjs';

const dev = process.argv.includes('--dev');
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
setTimeout(() => { console.error('GLOBAL TIMEOUT (12 min)'); process.exit(2); }, 12 * 60000).unref();
const report = { startedAt: new Date().toISOString(), mode: dev ? 'dev' : 'packaged', items: {}, soundChecks: [], speakerLevels: [] };
const want = (n) => !only || only.includes(String(n));

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
const settle = (page) => page.evaluate(() => window.mgTest.waitRender().catch(() => {}));
const T = (name) => (page) => page.evaluate((n) => window.mgTest.click(n), name);

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

  // ---------- 1: piano roll ----------
  if (want(1)) {
    await clickButton(page, 'New');
    await rendered(page, () => clickButton(page, 'Guitar song'));
    await ev(page, () => { window.mgTest.setEditMode(false); window.mgTest.openDock('roll'); });
    await sleep(300);
    await ev(page, () => window.mgTest.rollSnap('8'));
    const draws = [[0, 64, 480], [480, 67, 480], [960, 69, 960], [960, 57, 960], [1920, 71, 1920], [3840, 72, 1440], [5280, 76, 960]];
    let steps = 0;
    for (const [s, p, d] of draws) {
      await ev(page, (a) => window.mgTest.rollDraw(a[0], a[1], a[2]), [s, p, d]);
      steps++;
    }
    // Triplet grid: three 8th triplets in bar 3, beat 1.
    await ev(page, () => window.mgTest.rollSnap('8T'));
    for (const [s, p] of [[7680, 60], [8000, 62], [8320, 64]]) await ev(page, (a) => window.mgTest.rollDraw(a[0], a[1], 320), [s, p]);
    // Move the 71 (bar 1 beat 3) up a tone with the mouse, on the 1/8 grid.
    await ev(page, () => window.mgTest.rollSnap('8'));
    await ev(page, () => window.mgTest.rollDrag(2000, 71, 2000, 73));
    await settle(page);
    const notes = await ev(page, () => window.mgTest.rollNotes(0));
    const inTab = await ev(page, () => window.mgTest.notesOf(0));
    const expected = [[0, 480, 64], [480, 480, 67], [960, 960, 57], [960, 960, 69], [1920, 1920, 73], [3840, 1440, 72], [5280, 960, 76], [7680, 320, 60], [8000, 320, 62], [8320, 320, 64]];
    const same = JSON.stringify(notes.map((n) => [n[0], n[1], n[2]])) === JSON.stringify(expected);
    const fretsOk = notes.every((n) => n[4] !== null && n[5] !== null);
    const scoreMatches = JSON.stringify(inTab.map((n) => [n[0], n[1], n[2], n[3]])) === JSON.stringify(notes.map((n) => [n[0], n[2], n[4], n[5]]));
    // Undo: the move is one step.
    await ev(page, () => window.mgTest.undo());
    const afterUndo = await ev(page, () => window.mgTest.rollNotes(0));
    await ev(page, () => window.mgTest.redo());
    await settle(page);
    await ev(page, () => window.mgTest.scrollScoreToBar(0));
    await sleep(300);
    await screenshot(app, 'r4-1-piano-roll-score-tab');
    // Plays with the cursor (muted).
    await ev(page, () => window.mgTest.waitReady(60000));
    await ev(page, () => window.mgTest.play());
    await sleep(1200);
    await assertSilent(page, 'piano roll playback');
    const tick = await ev(page, () => window.mgTest.state().player.tick);
    await ev(page, () => window.mgTest.stop());
    record(1, {
      notesMatchDrawn: same, notes: notes.map((n) => `${n[0]}:${n[2]}@${n[4]}/${n[5]}`).join(' '), allHaveStringFret: fretsOk,
      scoreAndTabSameNotes: scoreMatches, moveUndoneInOneStep: afterUndo.some((n) => n[2] === 71) && !afterUndo.some((n) => n[2] === 73),
      playheadTickAfter1200ms: tick,
    });
  }

  // ---------- 2: chord explorer ----------
  if (want(2)) {
    await clickButton(page, 'New');
    await rendered(page, () => clickButton(page, 'Guitar song'));
    await ev(page, () => { window.mgTest.openDock('chords'); window.mgTest.setEditMode(true); window.mgTest.setCursor({ track: 0, staff: 0, bar: 0, voice: 0, beat: 0, string: 1 }); });
    const res = {};
    for (const tuning of ['standard', 'dropD']) {
      if (tuning === 'dropD') await ev(page, () => window.mgTest.setTuning(0, [38, 45, 50, 55, 59, 64], 'keepPitch'));
      for (const name of ['C', 'Am7', 'D/F#', 'E7#9']) {
        await ev(page, (n) => window.mgTest.exploreChord(n), name);
        await sleep(150);
        const shapes = await ev(page, () => window.mgTest.count('[data-testid^="ce-f"]'));
        const piano = await ev(page, () => window.mgTest.count('[data-testid^="ce-p"]'));
        const title = await ev(page, () => window.mgTest.text('ce-title'));
        res[`${tuning} ${name}`] = { title, shapes, piano };
        if ((tuning === 'standard' && name === 'E7#9') || (tuning === 'dropD' && name === 'D/F#')) await screenshot(app, `r4-2-chords-${tuning}-${name.replace('/', '-').replace('#', 's')}`);
      }
    }
    // Hear one (live synth, muted) and insert it with the chord symbol.
    await ev(page, (n) => window.mgTest.exploreChord(n), 'Am7');
    await sleep(150);
    const before = await ev(page, () => window.mgTest.liveNotesPlayed());
    await ev(page, () => window.mgTest.click('ce-f0'));
    await sleep(400);
    const lv = await assertSilent(page, 'chord preview (live synth)', 600);
    const played = (await ev(page, () => window.mgTest.liveNotesPlayed())) - before;
    await rendered(page, () => ev(page, () => window.mgTest.click('ce-insert')));
    const song = await ev(page, () => window.mgTest.song());
    const beat = song.tracks[0].staves[0].measures[0].voices[0].beats[0];
    await screenshot(app, 'r4-2-chords-inserted');
    record(2, {
      voicings: res, previewNotesPlayed: played, previewPrePeak: +lv.prePeak.toFixed(4),
      inserted: beat.notes.map((n) => `${n.pitch}@${n.string}/${n.fret}`).join(' '), chordSymbol: song.chordSymbols.map((c) => `${c.bar}:${c.name}`).join(' '),
    });
  }

  // ---------- 3: progression helper ----------
  if (want(3)) {
    await clickButton(page, 'New');
    await rendered(page, () => clickButton(page, 'Guitar song'));
    await ev(page, () => { window.mgTest.setEditMode(false); window.mgTest.keyChange(0, 4, 'major'); });
    await settle(page);
    // 12 bars: insert 4 more after the 8.
    await ev(page, () => { window.mgTest.timeSig(0, 4, 4); });
    const bars0 = await ev(page, () => window.mgTest.state().bars);
    if (bars0 < 12) {
      await ev(page, () => { window.mgTest.setEditMode(true); window.mgTest.setCursor({ track: 0, staff: 0, bar: 7, voice: 0, beat: 0, string: 1 }); });
      for (let i = bars0; i < 12; i++) await ev(page, () => window.mgTest.key('Insert', { ctrl: true }));
      await ev(page, () => window.mgTest.setEditMode(false));
    }
    await settle(page);
    await ev(page, () => window.mgTest.openDock('prog'));
    await ev(page, () => window.mgTest.selectBars(0, 11));
    await sleep(200);
    await ev(page, () => window.mgTest.setField('pg-lib', 'blues12'));
    const preview = await ev(page, () => window.mgTest.text('pg-preview'));
    await rendered(page, () => ev(page, () => window.mgTest.click('pg-insert')));
    const song = await ev(page, () => window.mgTest.song());
    const chords = song.chordSymbols.map((c) => c.name).join(' ');
    const inKey = await ev(page, () => [...document.querySelectorAll('.pg-row')][0]?.textContent);
    await ev(page, () => window.mgTest.scrollScoreToBar(0));
    await sleep(300);
    await screenshot(app, 'r4-3-progression-blues-E');
    record(3, {
      bars: song.bars.length, key: song.bars[0].key, preview, chords,
      expected: 'E7 E7 E7 E7 A7 A7 E7 E7 B7 A7 E7 B7', match: chords === 'E7 E7 E7 E7 A7 A7 E7 E7 B7 A7 E7 B7',
      diatonicRow: inKey?.replace(/⤓/g, ' ').replace(/\s+/g, ' ').trim(),
    });
  }

  // ---------- 4: drum step sequencer ----------
  if (want(4)) {
    await open(page, td('ode-to-joy-piano.musicxml'));
    await ev(page, () => { window.mgTest.setSection(0, 7, 'Verse'); window.mgTest.setSection(8, 15, 'Chorus'); });
    await rendered(page, () => ev(page, () => window.mgTest.clickGenerate()));
    const di = await ev(page, () => window.mgTest.song().tracks.findIndex((t) => t.generated?.role === 'drums'));
    await ev(page, (i) => { window.mgTest.setSelTrack(i); window.mgTest.openDock('drums'); }, di);
    await sleep(300);
    // Bar 1: clear it with an empty pattern-like approach: click every lit cell off, then build a beat.
    const lit = await ev(page, () => [...document.querySelectorAll('[data-cell].on')].map((e) => e.getAttribute('data-cell')));
    for (const c of lit) { const [p, s] = c.split(':').map(Number); await ev(page, (a) => window.mgTest.drumClick(a[0], a[1]), [p, s]); }
    const beat = [[36, 0], [36, 8], [36, 10], [42, 0], [42, 2], [42, 4], [42, 6], [42, 8], [42, 10], [42, 12], [42, 14]];
    for (const [p, s] of beat) await ev(page, (a) => window.mgTest.drumClick(a[0], a[1]), [p, s]);
    await ev(page, () => window.mgTest.drumClick(38, 4, { shift: true })); // accent
    await ev(page, () => window.mgTest.drumClick(38, 12));
    await ev(page, () => window.mgTest.drumClick(38, 15, { alt: true })); // ghost
    await ev(page, () => window.mgTest.drumClick(46, 14)); // open hi-hat... replaces nothing
    await settle(page);
    const ns = await ev(page, (i) => window.mgTest.notesOf(i).filter((n) => n[0] < 3840).map((n) => [n[0], n[1]]), di);
    const want4 = [...beat, [38, 4], [38, 12], [38, 15], [46, 14]].map(([p, s]) => [s * 240, p]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const vel = await ev(page, (i) => window.mgTest.song().tracks[i].staves[0].measures[0].voices[0].beats.flatMap((b) => b.notes).filter((n) => n.pitch === 38).map((n) => n.velocity), di);
    const editedTag = await ev(page, () => [...document.querySelectorAll('.tag.edited')].map((x) => x.closest('.track')?.querySelector('.name')?.textContent));
    // Save as a pattern (settings.json), fill the verse, apply a built-in pattern to bar 9.
    await ev(page, () => window.mgTest.setField('dg-name', 'My beat'));
    await ev(page, () => window.mgTest.click('dg-save'));
    await sleep(300);
    await ev(page, () => window.mgTest.click('dg-fill'));
    await settle(page);
    const verse = await ev(page, (i) => { const n = window.mgTest.notesOf(i); return [1, 2, 3, 7].map((b) => n.filter((x) => x[0] >= b * 3840 && x[0] < (b + 1) * 3840).length); }, di);
    const saved = await ev(page, () => window.mgTest.count('[data-testid="dg-pattern"] optgroup[label="Saved"] option'));
    await screenshot(app, 'r4-4-drum-grid');
    record(4, {
      gridMatchesNotation: JSON.stringify(ns) === JSON.stringify(want4), notes: ns.length, snareVelocities: vel,
      generatedMarkedEdited: editedTag, savedPatterns: saved, verseBarsHitCounts: verse, bar1Hits: want4.length,
    });
  }

  // ---------- 5: chord chart + song-wide changes ----------
  if (want(5)) {
    await clickButton(page, 'New');
    await ev(page, () => window.mgTest.click('new-chart'));
    const CHART = '{key: G}\n[Verse]\n|: G | Em | C D | % :|\n[Chorus] {key: A} {3/4}\n| A | F#m | D / E | A |\n{4/4}\n| D | E | A | A |';
    await ev(page, (t) => window.mgTest.setField('chart-text', t), CHART);
    await ev(page, () => window.mgTest.setField('chart-title', 'Chart test'));
    await ev(page, () => window.mgTest.setField('chart-bpm', '100'));
    await ev(page, () => window.mgTest.setField('chart-style', 'blues'));
    await rendered(page, () => ev(page, () => window.mgTest.click('chart-create')));
    await ev(page, () => window.mgTest.waitReady(60000));
    let song = await ev(page, () => window.mgTest.song());
    const shape = {
      bars: song.bars.length, ts: song.bars.map((b) => b.timeSignature.numerator).join(''), keys: song.bars.map((b) => b.key.fifths).join(','),
      tracks: song.tracks.map((t) => t.name), chords: song.chordSymbols.map((c) => c.name).join(' '), repeat: [song.bars[0].repeatStart, song.bars[3].repeatEnd],
    };
    // Ritardando from bar 9 to 60 bpm by bar 12, through the dialog.
    await ev(page, () => window.mgTest.openChanges(8));
    await sleep(200);
    await ev(page, () => window.mgTest.setField('chg-bpm', '100'));
    await ev(page, () => window.mgTest.click('chg-gradual'));
    await ev(page, () => window.mgTest.setField('chg-tobpm', '60'));
    await ev(page, () => window.mgTest.setField('chg-tobar', '12'));
    await rendered(page, () => ev(page, () => window.mgTest.click('chg-tempo-set')));
    await screenshot(app, 'r4-5-changes-dialog');
    await ev(page, () => window.mgTest.openChanges(null));
    const tempos = await ev(page, () => window.mgTest.tempoChanges());
    // Play the 3/4 chorus (muted) and the ritardando.
    await ev(page, () => window.mgTest.waitReady(60000));
    await ev(page, () => { window.mgTest.seekBar(4); window.mgTest.play(); });
    await sleep(1500);
    const lv = await assertSilent(page, 'chord chart 3/4 bars playing');
    const bar34 = await ev(page, () => window.mgTest.state().player.currentBar);
    await ev(page, () => window.mgTest.stop());
    song = await ev(page, () => window.mgTest.song());
    const bassI = song.tracks.findIndex((t) => t.generated?.role === 'bass');
    const bassBar5 = await ev(page, (i) => window.mgTest.notesOf(i).filter((n) => n[0] >= 4 * 3840 && n[0] < 4 * 3840 + 2880).map((n) => n[1] % 12), bassI);
    await ev(page, () => window.mgTest.scrollScoreToBar(4));
    await sleep(300);
    await screenshot(app, 'r4-5-chord-chart');
    record(5, { ...shape, tempos, playingBarAfter1500ms: bar34 + 1, prePeak: +lv.prePeak.toFixed(4), bassPitchClassesBar5: bassBar5 });
  }

  // ---------- 6: harmony lines ----------
  if (want(6)) {
    await open(page, td('ode-to-joy-piano.musicxml'));
    await rendered(page, () => ev(page, () => window.mgTest.harmony(0, 'third:above')));
    const song = await ev(page, () => window.mgTest.song());
    const h = await ev(page, () => window.mgTest.notesOf(1));
    const m = await ev(page, () => window.mgTest.notesOf(0));
    await ev(page, () => window.mgTest.openDock(null));
    await ev(page, () => window.mgTest.setDisplay(0, { visible: true }));
    await settle(page);
    await sleep(300);
    await screenshot(app, 'r4-6-harmony');
    record(6, { tracks: song.tracks.map((t) => t.name), harmonyNotes: h.length, melodyOnsets: new Set(m.map((n) => n[0])).size, key: song.bars[0].key });
  }

  // ---------- 7: MIDI keyboard (simulated input) ----------
  if (want(7)) {
    await clickButton(page, 'New');
    await rendered(page, () => clickButton(page, 'Guitar song'));
    await ev(page, () => { window.mgTest.openDock('midi'); window.mgTest.midiOptions({ quantize: '8', countIn: true, metronome: true, mode: 'merge' }); });
    await ev(page, () => window.mgTest.waitReady(60000));
    // Step entry: a C major triad at the cursor, then a single E.
    await ev(page, () => { window.mgTest.setEditMode(true); window.mgTest.setCursor({ track: 0, staff: 0, bar: 0, voice: 0, beat: 0, string: 1 }); window.mgTest.midiOptions({ step: true }); });
    await ev(page, () => window.mgTest.midiSimulate([{ delay: 0, data: [0x90, 60, 100] }, { delay: 10, data: [0x90, 64, 100] }, { delay: 10, data: [0x90, 67, 100] },
      { delay: 50, data: [0x80, 60, 0] }, { delay: 0, data: [0x80, 64, 0] }, { delay: 0, data: [0x80, 67, 0] }]));
    await sleep(200);
    await ev(page, () => window.mgTest.midiSimulate([{ delay: 0, data: [0x90, 76, 90] }, { delay: 60, data: [0x80, 76, 0] }]));
    await sleep(200);
    const stepNotes = await ev(page, () => window.mgTest.notesOf(0).map((n) => [n[0], n[1]]));
    await ev(page, () => { window.mgTest.midiOptions({ step: false }); window.mgTest.setEditMode(false); });
    // Live recording from bar 2 (cursor there), count-in + metronome, 120 bpm: play quarter notes.
    await ev(page, () => window.mgTest.setCursor({ track: 0, staff: 0, bar: 1, voice: 0, beat: 0, string: 1 }));
    await ev(page, () => window.mgTest.midiRecord());
    // Wait for the count-in to finish (the position starts moving).
    const t0 = Date.now();
    for (;;) {
      const tk = await ev(page, () => window.mgTest.state().player.tick);
      if (tk > 3840 + 30 || Date.now() - t0 > 6000) break;
      await sleep(20);
    }
    const startTick = await ev(page, () => window.mgTest.state().player.tick);
    const lv = await assertSilent(page, 'recording (count-in done, metronome on)', 300);
    // Notes on the next beats: 4 quarters (500 ms apart), each held 400 ms.
    const msgs = [];
    const toNextBeat = 500 - ((((startTick - 3840) / 960) * 500) % 500);
    [60, 62, 64, 65].forEach((p, i) => {
      msgs.push({ delay: i === 0 ? toNextBeat - 300 /* already waited 300 ms measuring */ : 100, data: [0x90, p, 100] });
      msgs.push({ delay: 400, data: [0x80, p, 0] });
    });
    await ev(page, (mm) => window.mgTest.midiSimulate(mm), msgs);
    await sleep(300);
    const n = await ev(page, () => window.mgTest.midiStop());
    await settle(page);
    await sleep(500);
    const playingAfterStop = await ev(page, () => window.mgTest.state().player.playing);
    const rec = await ev(page, () => window.mgTest.notesOf(0).filter((x) => x[0] >= 3840).map((x) => [x[0], x[1]]));
    const label = await ev(page, () => window.mgTest.undoLabel());
    await ev(page, () => window.mgTest.scrollScoreToBar(0));
    await sleep(200);
    await screenshot(app, 'r4-7-midi');
    const spacing = rec.slice(1).map((x, i) => x[0] - rec[i][0]);
    record(7, {
      stepEntry: stepNotes.map((x) => x.join('@')).join(' '), recordedNotes: n, recorded: rec.map((x) => x.join('@')).join(' '),
      spacingTicks: spacing, recordingStartTick: startTick, playingAfterStop, prePeak: +lv.prePeak.toFixed(4), undoLabel: label,
      received: await ev(page, () => window.mgTest.midiReceived()),
    });
  }

  // ---------- 8: save / reopen, undo ----------
  if (want(8)) {
    await clickButton(page, 'New');
    await ev(page, () => window.mgTest.click('new-chart'));
    await ev(page, (t) => window.mgTest.setField('chart-text', t), '{key: Em}\n[Intro]\n|: Em | C G | D | B7 :|\n{3/4}\n| Am | B7 | Em |');
    await rendered(page, () => ev(page, () => window.mgTest.click('chart-create')));
    const di = await ev(page, () => window.mgTest.song().tracks.findIndex((t) => t.generated?.role === 'drums'));
    const steps = [];
    // One action each; check that each made exactly one undo entry.
    const actions = [
      ['drum step', async () => { await ev(page, (i) => { window.mgTest.setSelTrack(i); window.mgTest.openDock('drums'); }, di); await sleep(200); await ev(page, () => window.mgTest.drumClick(49, 0, { shift: true })); }],
      ['piano roll note', async () => { await ev(page, () => { window.mgTest.setSelTrack(1); window.mgTest.openDock('roll'); }); await sleep(200); await ev(page, () => window.mgTest.rollDraw(1920, 52, 960)); }],
      ['key change', async () => ev(page, () => window.mgTest.keyChange(2, 2, 'major'))],
      ['tempo ramp', async () => ev(page, () => window.mgTest.tempoChange(1, 120, { toBar: 3, toBpm: 80 }))],
      ['harmony', async () => ev(page, () => window.mgTest.harmony(2, 'sixth:below'))],
      ['progression', async () => { await ev(page, () => window.mgTest.openDock('prog')); await ev(page, () => window.mgTest.selectBars(0, 3)); await sleep(100); await ev(page, () => window.mgTest.click('pg-insert')); }],
    ];
    const snapshots = [await ev(page, () => window.mgTest.serialized())];
    for (const [name, fn] of actions) {
      await fn();
      await settle(page);
      snapshots.push(await ev(page, () => window.mgTest.serialized()));
      steps.push({ name, label: await ev(page, () => window.mgTest.undoLabel()), changed: snapshots.at(-1) !== snapshots.at(-2) });
    }
    // Save -> reopen -> identical.
    const file = join(profileDir, 'round4-check.mgproj');
    await ev(page, (f) => window.mgTest.saveTo(f), file);
    const before = await ev(page, () => JSON.stringify(window.mgTest.song()));
    await open(page, file);
    const after = await ev(page, () => JSON.stringify(window.mgTest.song()));
    // Second pass on a fresh song: each undo goes back exactly one action.
    let undoOk = true;
    await clickButton(page, 'New');
    await ev(page, () => window.mgTest.click('new-chart'));
    await ev(page, (t) => window.mgTest.setField('chart-text', t), '{key: Em}\n[Intro]\n|: Em | C G | D | B7 :|\n{3/4}\n| Am | B7 | Em |');
    await rendered(page, () => ev(page, () => window.mgTest.click('chart-create')));
    const snaps2 = [await ev(page, () => window.mgTest.serialized())];
    for (const [, fn] of actions) {
      await fn();
      await settle(page);
      snaps2.push(await ev(page, () => window.mgTest.serialized()));
    }
    for (let i = actions.length; i > 0; i--) {
      await ev(page, () => window.mgTest.undo());
      await settle(page);
      const cur = await ev(page, () => window.mgTest.serialized());
      if (cur !== snaps2[i - 1]) undoOk = false;
    }
    record(8, { steps, reopenIdentical: before === after, bytes: before.length, eachUndoOneStep: undoOk, schemaVersion: JSON.parse(snapshots.at(-1)).schemaVersion });
  }

  const finalGain = await ev(page, () => window.mgTest.state().masterGain);
  const win2 = await windowInfo(app);
  report.finalMasterGain = finalGain;
  report.windowAtEnd = win2;
  if (win2.some((w) => w.visible || w.focused)) throw new Error('Window became visible/focused!');
  report.ok = true;
} catch (e) {
  report.ok = false;
  report.error = String(e?.stack ?? e);
  console.error(e);
} finally {
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(RESULTS, 'report-round4.json'), JSON.stringify(report, null, 1));
  await app?.close().catch(() => {});
  if (profileDir) rmSync(profileDir, { recursive: true, force: true });
}
console.log(report.ok ? 'ROUND 4 CHECKS DONE' : 'ROUND 4 CHECKS FAILED');
process.exit(report.ok ? 0 : 1);
