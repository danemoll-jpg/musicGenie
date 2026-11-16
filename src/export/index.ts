// File exporters (Round 5): MIDI, MusicXML, Guitar Pro. Pure (no DOM/Electron), unit-tested by
// exporting and re-importing with the app's own importers.
import * as alphaTab from '@coderline/alphatab';
import { Midi } from '@tonejs/midi';
import { barStartTicks, durationTicks, trackEvents, PPQ, type Beat, type Note, type Song, type Track } from '../model';
import { toAlphaTabScore } from '../render/toAlphaTab';

const playable = (song: Song) => song.tracks.filter((t) => !t.audio);

// ------------------------------------------------------------------ MIDI

/** Standard MIDI file (type 1): tempo map, time and key signatures, one track per part. */
export function exportMidi(song: Song): Uint8Array {
  const midi = new Midi();
  const k = midi.header.ppq / PPQ; // @tonejs/midi writes 480 PPQ
  const starts = barStartTicks(song);
  midi.header.name = song.title;
  for (const t of song.tempos) midi.header.tempos.push({ ticks: Math.round(((starts[t.bar] ?? 0) + t.tick) * k), bpm: t.bpm });
  let prevTs = '';
  let prevKey = '';
  song.bars.forEach((b, i) => {
    const ts = b.timeSignature.numerator + '/' + b.timeSignature.denominator;
    if (ts !== prevTs) midi.header.timeSignatures.push({ ticks: Math.round(starts[i] * k), timeSignature: [b.timeSignature.numerator, b.timeSignature.denominator] });
    const key = b.key.fifths + b.key.mode;
    if (key !== prevKey) {
      const names = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
      const minor = ['Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'A#'];
      midi.header.keySignatures.push({ ticks: Math.round(starts[i] * k), key: (b.key.mode === 'minor' ? minor : names)[b.key.fifths + 7], scale: b.key.mode });
    }
    prevTs = ts;
    prevKey = key;
  });
  midi.header.update();
  let ch = 0;
  for (const t of playable(song)) {
    const tr = midi.addTrack();
    tr.name = t.name;
    if (t.instrument.percussion) tr.channel = 9;
    else {
      if (ch === 9) ch++;
      tr.channel = Math.min(15, ch++);
      tr.instrument.number = t.instrument.program;
    }
    for (const e of trackEvents(song, t)) {
      tr.addNote({ midi: e.pitch, ticks: Math.round(e.start * k), durationTicks: Math.max(1, Math.round(e.dur * k)), velocity: Math.max(1, e.velocity) / 127 });
    }
    // Grace notes take no time in the notation: play them as a 64th just before their beat.
    t.staves.forEach((st) => st.measures.forEach((m, bi) => m.voices.forEach((v) => {
      let at = starts[bi] ?? 0;
      for (const b of v.beats) {
        if (b.grace) {
          for (const n of b.notes) if (!n.tieFromPrevious) tr.addNote({ midi: n.pitch, ticks: Math.max(0, Math.round((at - 60) * k)), durationTicks: Math.round(60 * k), velocity: Math.max(1, n.velocity) / 127 });
        } else at += durationTicks(b.duration);
      }
    })));
    // Pan and volume as controllers at the start.
    tr.addCC({ number: 7, value: Math.round(Math.min(1, t.mixer.volume / 0.8) * 100) / 127, ticks: 0 });
    tr.addCC({ number: 10, value: (t.mixer.pan + 1) / 2, ticks: 0 });
  }
  return midi.toArray();
}

// ------------------------------------------------------------------ MusicXML

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const SHARP = [['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0]] as const;
const FLAT = [['C', 0], ['D', -1], ['D', 0], ['E', -1], ['E', 0], ['F', 0], ['G', -1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0]] as const;
const TYPE: Record<number, string> = { 1: 'whole', 2: 'half', 4: 'quarter', 8: 'eighth', 16: '16th', 32: '32nd', 64: '64th' };
const CLEF: Record<string, [string, number]> = { treble: ['G', 2], bass: ['F', 4], alto: ['C', 3], tenor: ['C', 4], neutral: ['percussion', 2] };

function pitchXml(p: number, flats: boolean): string {
  const [step, alter] = (flats ? FLAT : SHARP)[((p % 12) + 12) % 12];
  // Octave from the written step (Cb/B# are never produced by these tables).
  const octave = Math.floor(p / 12) - 1;
  return `<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${octave}</octave></pitch>`;
}

/** MusicXML 4.0 (partwise) of the song: notes, rests, chords, ties, tuplets, dots, keys, times, tempos, repeats, sections, lyrics, tab positions. */
export function exportMusicXml(song: Song): string {
  const tracks = playable(song);
  const starts = barStartTicks(song);
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8" standalone="no"?>');
  out.push('<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">');
  out.push('<score-partwise version="4.0">');
  out.push(`<work><work-title>${esc(song.title)}</work-title></work>`);
  out.push('<identification>' + (song.composer ? `<creator type="composer">${esc(song.composer)}</creator>` : '') +
    (song.artist ? `<creator type="lyricist">${esc(song.artist)}</creator>` : '') + '<encoding><software>musicGenie</software></encoding></identification>');
  out.push('<part-list>');
  let ch = 0;
  tracks.forEach((t, i) => {
    const id = 'P' + (i + 1);
    out.push(`<score-part id="${id}"><part-name>${esc(t.name)}</part-name>`);
    if (t.instrument.percussion) {
      const used = new Set(trackEvents(song, t).map((e) => e.pitch));
      for (const p of used) out.push(`<score-instrument id="${id}-I${p + 1}"><instrument-name>${p}</instrument-name></score-instrument>`);
      for (const p of used) out.push(`<midi-instrument id="${id}-I${p + 1}"><midi-channel>10</midi-channel><midi-unpitched>${p + 1}</midi-unpitched></midi-instrument>`);
    } else {
      if (ch === 9) ch++;
      out.push(`<score-instrument id="${id}-I1"><instrument-name>${esc(t.name)}</instrument-name></score-instrument>`);
      out.push(`<midi-instrument id="${id}-I1"><midi-channel>${Math.min(16, ++ch)}</midi-channel><midi-program>${t.instrument.program + 1}</midi-program></midi-instrument>`);
    }
    out.push('</score-part>');
  });
  out.push('</part-list>');

  tracks.forEach((t, ti) => {
    const id = 'P' + (ti + 1);
    out.push(`<part id="${id}">`);
    const fretted = !!t.tuning && !t.instrument.percussion && !t.capo;
    // Next beat per staff/voice, to know where ties start.
    const flat = t.staves.map((st) => {
      const voices: { bar: number; beat: Beat }[][] = [];
      st.measures.forEach((m, bi) => m.voices.forEach((v, vi) => {
        (voices[vi] ??= []);
        for (const b of v.beats) voices[vi].push({ bar: bi, beat: b });
      }));
      return voices;
    });
    const tieStarts = new Set<Note>();
    flat.forEach((voices) => voices.forEach((seq) => {
      for (let i = 0; i + 1 < seq.length; i++) {
        let j = i + 1;
        while (j < seq.length && seq[j].beat.grace) j++;
        if (j >= seq.length) continue;
        for (const n of seq[i].beat.notes) if (seq[j].beat.notes.some((x) => x.tieFromPrevious && x.pitch === n.pitch)) tieStarts.add(n);
      }
    }));
    song.bars.forEach((bar, bi) => {
      out.push(`<measure number="${bi + 1}">`);
      const prev = song.bars[bi - 1];
      if (bar.repeatStart) out.push('<barline location="left"><repeat direction="forward"/></barline>');
      const attrs: string[] = [];
      if (bi === 0) attrs.push(`<divisions>${PPQ}</divisions>`);
      if (bi === 0 || prev.key.fifths !== bar.key.fifths || prev.key.mode !== bar.key.mode) {
        attrs.push(t.instrument.percussion ? '' : `<key><fifths>${bar.key.fifths}</fifths><mode>${bar.key.mode}</mode></key>`);
      }
      if (bi === 0 || prev.timeSignature.numerator !== bar.timeSignature.numerator || prev.timeSignature.denominator !== bar.timeSignature.denominator) {
        attrs.push(`<time><beats>${bar.timeSignature.numerator}</beats><beat-type>${bar.timeSignature.denominator}</beat-type></time>`);
      }
      if (bi === 0) {
        if (t.staves.length > 1) attrs.push(`<staves>${t.staves.length}</staves>`);
        t.staves.forEach((st, si) => {
          const [sign, line] = CLEF[st.clef] ?? CLEF.treble;
          attrs.push(`<clef${t.staves.length > 1 ? ` number="${si + 1}"` : ''}><sign>${sign}</sign>${sign === 'percussion' ? '' : `<line>${line}</line>`}</clef>`);
        });
        if (fretted) {
          attrs.push(`<staff-details><staff-lines>${t.tuning!.length}</staff-lines>${t.tuning!.map((p, i) => {
            const [step, alter] = SHARP[p % 12];
            return `<staff-tuning line="${i + 1}"><tuning-step>${step}</tuning-step>${alter ? `<tuning-alter>${alter}</tuning-alter>` : ''}<tuning-octave>${Math.floor(p / 12) - 1}</tuning-octave></staff-tuning>`;
          }).join('')}</staff-details>`);
        }
      }
      const a = attrs.filter(Boolean);
      if (a.length) out.push('<attributes>' + a.join('') + '</attributes>');
      if (ti === 0) {
        const sec = song.sections.find((s) => s.bar === bi);
        if (sec) out.push(`<direction placement="above"><direction-type><rehearsal>${esc(sec.name)}</rehearsal></direction-type></direction>`);
        for (const tp of song.tempos.filter((x) => x.bar === bi && !x.ramp)) {
          out.push(`<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${Math.round(tp.bpm)}</per-minute></metronome></direction-type>` +
            (tp.tick ? `<offset>${tp.tick}</offset>` : '') + `<sound tempo="${Math.round(tp.bpm * 100) / 100}"/></direction>`);
        }
      }
      const flats = bar.key.fifths < 0;
      let first = true;
      const barLen = starts[bi + 1] !== undefined ? starts[bi + 1] - starts[bi] : null;
      t.staves.forEach((st, si) => {
        st.measures[bi].voices.forEach((v, vi) => {
          if (!first) out.push(`<backup><duration>${barLen ?? 0}</duration></backup>`);
          first = false;
          const voice = si * 4 + vi + 1;
          for (const b of v.beats) {
            const d = durationTicks(b.duration);
            const timing = (b.grace ? '<grace/>' : '');
            const typ = `<type>${TYPE[b.duration.base]}</type>` + '<dot/>'.repeat(b.duration.dots) +
              (b.duration.tuplet ? `<time-modification><actual-notes>${b.duration.tuplet.num}</actual-notes><normal-notes>${b.duration.tuplet.den}</normal-notes></time-modification>` : '');
            const staff = t.staves.length > 1 ? `<staff>${si + 1}</staff>` : '';
            const lyric = b.lyric ? `<lyric number="1"><syllabic>single</syllabic><text>${esc(b.lyric)}</text></lyric>` : '';
            if (!b.notes.length) {
              out.push(`<note>${timing}<rest/>${b.grace ? '' : `<duration>${d}</duration>`}<voice>${voice}</voice>${typ}${staff}</note>`);
            } else {
              b.notes.forEach((n, ni) => {
                const tieS = tieStarts.has(n);
                const tieE = !!n.tieFromPrevious;
                const ties = (tieE ? '<tie type="stop"/>' : '') + (tieS ? '<tie type="start"/>' : '');
                const tied = (tieE ? '<tied type="stop"/>' : '') + (tieS ? '<tied type="start"/>' : '');
                const tech = fretted && n.string !== undefined && n.fret !== undefined
                  ? `<technical><string>${t.tuning!.length - n.string + 1}</string><fret>${n.fret}</fret></technical>` : '';
                const notations = tied || tech ? `<notations>${tied}${tech}</notations>` : '';
                const pitch = t.instrument.percussion
                  ? (() => { const [step] = SHARP[n.pitch % 12]; return `<unpitched><display-step>${step}</display-step><display-octave>${Math.floor(n.pitch / 12) - 1}</display-octave></unpitched>`; })()
                  : pitchXml(n.pitch, flats);
                const inst = t.instrument.percussion ? `<instrument id="${id}-I${n.pitch + 1}"/>` : '';
                out.push(`<note>${timing}${ni > 0 ? '<chord/>' : ''}${pitch}${b.grace ? '' : `<duration>${d}</duration>`}${ties}${inst}<voice>${voice}</voice>${typ}${staff}${notations}${ni === 0 ? lyric : ''}</note>`);
              });
            }
          }
        });
      });
      if (bar.repeatEnd) out.push(`<barline location="right"><bar-style>light-heavy</bar-style><repeat direction="backward" times="${bar.repeatEnd}"/></barline>`);
      out.push('</measure>');
    });
    out.push('</part>');
  });
  out.push('</score-partwise>');
  return out.join('\n');
}

// ------------------------------------------------------------------ Guitar Pro

/** Guitar Pro 7 (.gp) through alphaTab's exporter (the same score the app draws and plays). */
export function exportGuitarPro(song: Song): Uint8Array {
  const settings = new alphaTab.Settings();
  const s: Song = { ...song, tracks: playable(song) as Track[] };
  const score = toAlphaTabScore(s, settings);
  return new alphaTab.exporter.Gp7Exporter().export(score, settings);
}
