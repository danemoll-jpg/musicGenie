// Harmony lines: a new track a diatonic 3rd or 6th (or an octave) above or below a melody,
// staying in the key of each bar and following the chord symbols on strong beats.
import { chordAt } from './chords';
import { chordPcs, parseChordSpec } from './chordTheory';
import { buildMeasures, type NoteEvent } from './events';
import { barAtTick, staffNotes } from './pianoRoll';
import { keyOfBar, MAJOR_SCALE, MINOR_SCALE, scalePcs } from './progressions';
import { barStartTicks } from './timing';
import { PPQ, type Song, type Track } from './types';

export type HarmonyInterval = 'third' | 'sixth' | 'octave';
export type HarmonyDirection = 'above' | 'below';

export interface HarmonyNote {
  start: number;
  dur: number;
  melody: number;
  pitch: number;
  /** True when the plain diatonic interval was swapped for a chord tone (strong beat, clash). */
  adjusted: boolean;
}

const mod12 = (n: number) => ((n % 12) + 12) % 12;

/** The melody: the top note of every onset (all staves of the track). */
export function melodyLine(song: Song, trackIndex: number): NoteEvent[] {
  const t = song.tracks[trackIndex];
  const all = t.staves.flatMap((_, si) => staffNotes(song, trackIndex, si));
  const byStart = new Map<number, NoteEvent>();
  for (const e of all) {
    const cur = byStart.get(e.start);
    if (!cur || e.pitch > cur.pitch) byStart.set(e.start, e);
  }
  return [...byStart.values()].sort((a, b) => a.start - b.start);
}

/** Harmony notes for a melody (pure; used by the track maker and the tests). */
export function harmonize(song: Song, melody: NoteEvent[], interval: HarmonyInterval, dir: HarmonyDirection): HarmonyNote[] {
  const starts = barStartTicks(song);
  const sign = dir === 'above' ? 1 : -1;
  return melody.map((m) => {
    if (interval === 'octave') return { start: m.start, dur: m.dur, melody: m.pitch, pitch: m.pitch + 12 * sign, adjusted: false };
    const bar = barAtTick(song, m.start);
    const key = keyOfBar(song, bar);
    const scale = scalePcs(key);
    // Degree of the melody note (a chromatic note is treated as the scale note below it).
    let p = m.pitch;
    let deg = scale.indexOf(mod12(p));
    while (deg < 0) {
      p--;
      deg = scale.indexOf(mod12(p));
    }
    const steps = interval === 'third' ? 2 : 5;
    const ivs = key.mode === 'major' ? MAJOR_SCALE : MINOR_SCALE;
    const target = (d: number) => {
      const base = p - ivs[deg]; // the tonic at or below p
      const j = deg + sign * d;
      const oct = Math.floor(j / 7);
      return base + ivs[j - 7 * oct] + 12 * oct;
    };
    let pitch = target(steps);
    let adjusted = false;
    const tickInBar = m.start - starts[bar];
    const strong = tickInBar % PPQ === 0;
    const cs = chordAt(song.chordSymbols, bar, tickInBar);
    const spec = cs ? parseChordSpec(cs.name) : null;
    if (spec && strong && mod12(m.pitch) !== mod12(pitch)) {
      const pcs = chordPcs(spec);
      if (!pcs.has(mod12(pitch)) && pcs.has(mod12(m.pitch))) {
        // Nearest in-key chord tone on the same side, between a 3rd and a 6th from the melody.
        const lo = interval === 'third' ? 3 : 8;
        const hi = interval === 'third' ? 5 : 9;
        let best: number | null = null;
        for (let d = lo; d <= hi; d++) {
          const q = m.pitch + d * sign;
          if (pcs.has(mod12(q)) && scale.includes(mod12(q)) && (best === null || Math.abs(q - pitch) < Math.abs(best - pitch))) best = q;
        }
        if (best !== null) {
          pitch = best;
          adjusted = true;
        }
      }
    }
    return { start: m.start, dur: m.dur, melody: m.pitch, pitch, adjusted };
  });
}

/** Add a harmony track after the melody track. Returns the new song. */
export function addHarmonyTrack(song: Song, trackId: string, interval: HarmonyInterval, dir: HarmonyDirection): Song {
  const ti = song.tracks.findIndex((t) => t.id === trackId);
  if (ti < 0) throw new Error('No such track');
  const src = song.tracks[ti];
  if (src.instrument.percussion) throw new Error('Drum tracks have no melody to harmonize.');
  const mel = melodyLine(song, ti);
  if (!mel.length) throw new Error('This track has no notes to harmonize.');
  const notes = harmonize(song, mel, interval, dir);
  const next = structuredClone(song);
  const fretted = !!src.tuning && !src.instrument.percussion;
  const events: NoteEvent[] = notes.map((n, i) => ({ start: n.start, dur: n.dur, pitch: n.pitch, velocity: Math.max(1, (mel[i].velocity ?? 96) - 10), staff: 0, voice: 0 }));
  const label = `${interval === 'third' ? '3rd' : interval === 'sixth' ? '6th' : 'octave'} ${dir}`;
  let id = `${src.id}-harm`;
  for (let k = 2; next.tracks.some((t) => t.id === id); k++) id = `${src.id}-harm${k}`;
  const mean = events.reduce((a, e) => a + e.pitch, 0) / events.length;
  const track: Track = {
    id,
    name: `${src.name} harmony (${label})`,
    instrument: { ...src.instrument },
    mixer: { ...src.mixer, volume: Math.max(0.1, src.mixer.volume * 0.8), mute: false, solo: false },
    display: { ...src.display },
    staves: [{ clef: fretted ? 'treble' : mean < 55 ? 'bass' : 'treble', measures: buildMeasures(next, events, { tuning: fretted ? src.tuning : undefined, capo: src.capo ?? 0 }) }],
  };
  if (src.tuning) track.tuning = [...src.tuning];
  if (src.capo) track.capo = src.capo;
  if (src.displayTranspose !== undefined) track.displayTranspose = src.displayTranspose;
  next.tracks.splice(ti + 1, 0, track);
  return next;
}
