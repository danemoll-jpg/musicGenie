// "Split into band parts": melody (top line), bass (lowest notes) and the harmony in between.
// The rhythm structure of the source is copied exactly; each part keeps only its own notes
// (beats left without notes become rests), so every source note lands in exactly one part.
import { barStartTicks, durationTicks } from './timing';
import type { Song, SplitPart, Staff, Track } from './types';

/** Address of a note in a track: staff, measure, voice, beat, note index. */
export type NoteAddress = string;
const addr = (s: number, m: number, v: number, b: number, n: number) => `${s}.${m}.${v}.${b}.${n}`;

interface Placed {
  a: NoteAddress;
  start: number;
  end: number;
  pitch: number;
  staff: number;
  tie: boolean;
  voice: number;
}

/** Which part each note of the track belongs to. Tied continuations follow the note they continue. */
export function classifyParts(song: Song, track: Track): Map<NoteAddress, SplitPart> {
  const starts = barStartTicks(song);
  const notes: Placed[] = [];
  track.staves.forEach((st, si) =>
    st.measures.forEach((m, mi) =>
      m.voices.forEach((v, vi) => {
        let t = starts[mi] ?? 0;
        v.beats.forEach((b, bi) => {
          const d = b.grace ? 0 : durationTicks(b.duration);
          b.notes.forEach((n, ni) =>
            notes.push({ a: addr(si, mi, vi, bi, ni), start: t, end: t + Math.max(d, 1), pitch: n.pitch, staff: si, tie: !!n.tieFromPrevious, voice: vi }),
          );
          t += d;
        });
      }),
    ),
  );
  notes.sort((x, y) => x.start - y.start || x.staff - y.staff || y.pitch - x.pitch);

  // Extend tied notes so a held note keeps "sounding" for the notes struck while it rings.
  const sounding = notes.map((n) => ({ ...n }));
  const result = new Map<NoteAddress, SplitPart>();
  const lastOf = new Map<string, SplitPart>(); // staff:voice:pitch -> part of the note being tied
  let lastMelody = 72;
  let lastBass = 48;

  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    const key = `${n.staff}:${n.voice}:${n.pitch}`;
    if (n.tie && lastOf.has(key)) {
      result.set(n.a, lastOf.get(key)!);
      continue;
    }
    // Everything sounding when this note is struck (including itself).
    const here = sounding.filter((x) => x.start <= n.start && x.end > n.start);
    let top = here[0];
    let bottom = here[0];
    for (const x of here) {
      if (x.pitch > top.pitch || (x.pitch === top.pitch && x.staff < top.staff)) top = x;
      if (x.pitch < bottom.pitch || (x.pitch === bottom.pitch && x.staff > bottom.staff)) bottom = x;
    }
    let part: SplitPart;
    if (top.a === n.a && bottom.a === n.a) {
      // Alone: whichever line it is closer to.
      part = Math.abs(n.pitch - lastMelody) <= Math.abs(n.pitch - lastBass) ? 'melody' : 'bass';
    } else if (top.a === n.a) part = 'melody';
    else if (bottom.a === n.a) part = 'bass';
    else part = 'harmony';
    if (part === 'melody') lastMelody = n.pitch;
    if (part === 'bass') lastBass = n.pitch;
    result.set(n.a, part);
    lastOf.set(key, part);
  }
  return result;
}

function partStaves(track: Track, parts: Map<NoteAddress, SplitPart>, want: SplitPart): Staff[] {
  const staves: Staff[] = track.staves.map((st, si) => ({
    clef: st.clef,
    measures: st.measures.map((m, mi) => ({
      voices: m.voices.map((v, vi) => ({
        beats: v.beats.map((b, bi) => ({
          ...structuredClone(b),
          notes: b.notes.filter((_, ni) => parts.get(addr(si, mi, vi, bi, ni)) === want).map((n) => structuredClone(n)),
        })),
      })),
    })),
  }));
  // Grace beats with no notes left are dropped; lyrics stay with the melody only.
  for (const st of staves)
    for (const m of st.measures)
      for (const v of m.voices) {
        v.beats = v.beats.filter((b) => !b.grace || b.notes.length > 0);
        if (want !== 'melody') for (const b of v.beats) { delete b.lyric; delete b.lyrics; }
      }
  // Drop voices that are all rests (keep voice 0), then staves with no notes at all.
  for (const st of staves)
    for (const m of st.measures) m.voices = m.voices.filter((v, vi) => vi === 0 || v.beats.some((b) => b.notes.length));
  const used = staves.filter((st) => st.measures.some((m) => m.voices.some((v) => v.beats.some((b) => b.notes.length))));
  return used;
}

const PART_NAMES: Record<SplitPart, string> = { melody: 'Melody', harmony: 'Harmony', bass: 'Bass' };

/**
 * Split a track into melody / harmony / bass tracks, inserted after it. The source track is
 * kept and muted. Parts with no notes are not created.
 */
export function splitTrack(song: Song, trackId: string): Song {
  const next = structuredClone(song);
  const idx = next.tracks.findIndex((t) => t.id === trackId);
  if (idx < 0) throw new Error(`No track with id ${trackId}`);
  const src = next.tracks[idx];
  if (src.instrument.percussion) throw new Error('Drum tracks cannot be split into melody/harmony/bass.');
  const parts = classifyParts(next, src);
  const made: Track[] = [];
  for (const part of ['melody', 'harmony', 'bass'] as SplitPart[]) {
    const staves = partStaves(src, parts, part);
    if (!staves.length) continue;
    let id = `${src.id}-${part}`;
    for (let n = 2; next.tracks.some((t) => t.id === id); n++) id = `${src.id}-${part}${n}`;
    const t: Track = {
      ...structuredClone(src),
      id,
      name: `${src.name} – ${PART_NAMES[part]}`,
      mixer: { ...src.mixer, mute: false, solo: false },
      staves,
      derived: { from: src.id, part },
    };
    delete t.generated;
    if (part === 'bass' && !t.tuning) {
      // Keep the instrument; only make sure the bass part reads in bass clef.
      for (const st of t.staves) if (st.clef === 'treble' && avgPitch(st) < 55) st.clef = 'bass';
    }
    made.push(t);
  }
  src.mixer.mute = true;
  next.tracks.splice(idx + 1, 0, ...made);
  return next;
}

function avgPitch(st: Staff): number {
  let s = 0;
  let n = 0;
  for (const m of st.measures) for (const v of m.voices) for (const b of v.beats) for (const x of b.notes) { s += x.pitch; n++; }
  return n ? s / n : 60;
}

/** Notes in a track, by address (used by tests to prove nothing is lost or doubled). */
export function noteAddresses(track: Track): NoteAddress[] {
  const out: NoteAddress[] = [];
  track.staves.forEach((st, si) =>
    st.measures.forEach((m, mi) => m.voices.forEach((v, vi) => v.beats.forEach((b, bi) => b.notes.forEach((_, ni) => out.push(addr(si, mi, vi, bi, ni)))))),
  );
  return out;
}


/** One part of a track as staves (rhythm structure kept), e.g. the melody for a lead player. */
export function extractPart(song: Song, track: Track, part: SplitPart): Staff[] {
  return partStaves(track, classifyParts(song, track), part);
}
