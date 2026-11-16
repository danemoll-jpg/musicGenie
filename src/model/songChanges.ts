// Song-wide changes at any bar: key, time signature, tempo (sudden, or gradual accelerando /
// ritardando written as one tempo point per beat). Playback, the band engine and Rocksmith
// export all read bars/tempos, so they follow automatically.
import { cloneSong } from './edits';
import { fitVoice } from './noteEdit';
import { barTicks } from './timing';
import { PPQ, type BarHeader, type Song, type TempoChange } from './types';

const sameKey = (a: BarHeader['key'], b: BarHeader['key']) => a.fifths === b.fifths && a.mode === b.mode;
const sameTs = (a: BarHeader['timeSignature'], b: BarHeader['timeSignature']) => a.numerator === b.numerator && a.denominator === b.denominator;

/** Bars from `bar` up to (not including) the next bar where `differs` says the old value changes. */
function region(song: Song, bar: number, differs: (a: BarHeader, b: BarHeader) => boolean): number {
  let end = bar + 1;
  while (end < song.bars.length && !differs(song.bars[end], song.bars[bar])) end++;
  return end;
}

/** Key change at a bar: lasts until the next key change. Notes are not changed. */
export function setKeyAt(song: Song, bar: number, fifths: number, mode: 'major' | 'minor'): Song {
  if (bar < 0 || bar >= song.bars.length) return song;
  const next = cloneSong(song);
  const end = region(song, bar, (a, b) => !sameKey(a.key, b.key));
  for (let i = bar; i < end; i++) next.bars[i].key = { fifths, mode };
  return next;
}

/** Remove a key change: the bars take the key before them. */
export function removeKeyChange(song: Song, bar: number): Song {
  if (bar <= 0) return song;
  const k = song.bars[bar - 1].key;
  return setKeyAt(song, bar, k.fifths, k.mode);
}

/** Bars where the key changes (bar 0 included). */
export function keyChanges(song: Song): { bar: number; key: BarHeader['key'] }[] {
  return song.bars.flatMap((b, i) => (i === 0 || !sameKey(b.key, song.bars[i - 1].key) ? [{ bar: i, key: b.key }] : []));
}

export function timeSigChanges(song: Song): { bar: number; ts: BarHeader['timeSignature'] }[] {
  return song.bars.flatMap((b, i) => (i === 0 || !sameTs(b.timeSignature, song.bars[i - 1].timeSignature) ? [{ bar: i, ts: b.timeSignature }] : []));
}

/**
 * Time signature change at a bar (until the next change, or only `count` bars). Every voice of
 * the changed bars is refitted to the new length: rests fill, beats past the end are dropped.
 * Chord symbols and tempo points past the new bar end are dropped.
 */
export function setTimeSignatureAt(song: Song, bar: number, numerator: number, denominator: number, count?: number): Song {
  if (bar < 0 || bar >= song.bars.length) return song;
  const next = cloneSong(song);
  const end = count ? Math.min(song.bars.length, bar + count) : region(song, bar, (a, b) => !sameTs(a.timeSignature, b.timeSignature));
  for (let i = bar; i < end; i++) {
    next.bars[i].timeSignature = { numerator, denominator };
    const len = barTicks(next.bars[i]);
    for (const t of next.tracks) {
      for (const st of t.staves) {
        const m = st.measures[i];
        for (const v of m.voices) if (v.beats.length) v.beats = fitVoice(v.beats, len);
      }
    }
    next.chordSymbols = next.chordSymbols.filter((c) => c.bar !== i || c.tick < len);
    next.tempos = next.tempos.filter((tc) => tc.bar !== i || tc.tick < len);
  }
  return next;
}

/** Tempo (bpm) in effect at (bar, tick). */
export function tempoAt(song: Song, bar: number, tick = 0): number {
  let bpm = song.tempos[0]?.bpm ?? 120;
  for (const t of song.tempos) {
    if (t.bar < bar || (t.bar === bar && t.tick <= tick)) bpm = t.bpm;
    else break;
  }
  return bpm;
}

const sortTempos = (t: TempoChange[]) => t.sort((a, b) => a.bar - b.bar || a.tick - b.tick);
const clampBpm = (b: number) => Math.max(20, Math.min(400, Math.round(b * 100) / 100));

/** Remove the tempo point at a bar start, and the ramp it starts (if any). */
function removeTempoPoints(tempos: TempoChange[], bar: number): TempoChange[] {
  const at = tempos.find((t) => t.bar === bar && t.tick === 0 && !t.ramp);
  if (!at) return tempos;
  const to = at.rampTo?.bar ?? bar;
  return tempos.filter((t) => t !== at && !(t.ramp && t.bar >= bar && t.bar < to));
}

/** Sudden tempo change at the start of a bar (replaces a change or ramp that started there). */
export function setTempoAt(song: Song, bar: number, bpm: number): Song {
  const next = cloneSong(song);
  next.tempos = removeTempoPoints(next.tempos, bar);
  next.tempos.push({ bar, tick: 0, bpm: clampBpm(bpm) });
  sortTempos(next.tempos);
  return next;
}

/**
 * Gradual tempo change (accelerando / ritardando): from `fromBpm` (default: the tempo there) at
 * the start of `fromBar` to `toBpm` at the start of `toBar`, one tempo point per beat in
 * between. The first point carries `rampTo`; the in-between points are marked `ramp`. The
 * target tempo then holds.
 */
export function setTempoRamp(song: Song, fromBar: number, toBar: number, toBpm: number, fromBpm?: number): Song {
  const end = Math.min(toBar, song.bars.length);
  if (end <= fromBar || fromBar < 0) return song;
  const next = cloneSong(song);
  const start = clampBpm(fromBpm ?? tempoAt(song, fromBar, 0));
  next.tempos = next.tempos.filter((t) => (t.bar < fromBar || t.bar >= end) && !(t.bar === end && t.tick === 0));
  const beats: { bar: number; tick: number }[] = [];
  for (let b = fromBar; b < end; b++) {
    const step = (PPQ * 4) / next.bars[b].timeSignature.denominator;
    for (let t = 0; t < barTicks(next.bars[b]); t += step) beats.push({ bar: b, tick: t });
  }
  beats.forEach((p, i) => {
    const bpm = clampBpm(start + ((toBpm - start) * i) / beats.length);
    next.tempos.push(i === 0 ? { bar: p.bar, tick: 0, bpm, rampTo: { bar: end, bpm: clampBpm(toBpm) } } : { bar: p.bar, tick: p.tick, bpm, ramp: true });
  });
  if (end < next.bars.length) next.tempos.push({ bar: end, tick: 0, bpm: clampBpm(toBpm) });
  sortTempos(next.tempos);
  return next;
}

/** Remove the tempo change (or ramp) at a bar. Bar 1 always keeps a tempo. */
export function removeTempoChange(song: Song, bar: number): Song {
  const next = cloneSong(song);
  const first = song.tempos.find((t) => t.bar === 0 && t.tick === 0)?.bpm ?? 120;
  next.tempos = removeTempoPoints(next.tempos, bar);
  if (!next.tempos.some((t) => t.bar === 0 && t.tick === 0)) next.tempos.push({ bar: 0, tick: 0, bpm: first });
  sortTempos(next.tempos);
  return next;
}

/** Tempo changes as the user sees them: sudden changes and ramps. */
export function tempoChanges(song: Song): { bar: number; bpm: number; rampTo?: { bar: number; bpm: number } }[] {
  return song.tempos.filter((t) => t.tick === 0 && !t.ramp).map((t) => ({ bar: t.bar, bpm: t.bpm, ...(t.rampTo ? { rampTo: { ...t.rampTo } } : {}) }));
}
