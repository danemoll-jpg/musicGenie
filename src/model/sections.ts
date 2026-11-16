// Song sections (Intro, Verse, Chorus...): each is a name at a start bar and runs to the next one.
import type { Song } from './types';

export const SECTION_NAMES = ['Intro', 'Verse', 'Pre-Chorus', 'Chorus', 'Bridge', 'Solo', 'Riff', 'Breakdown', 'Interlude', 'Outro', 'No guitar'];

export interface SectionRange {
  name: string;
  startBar: number;
  /** Exclusive. */
  endBar: number;
}

/** Sections as bar ranges covering the whole song. No sections = one section "Song". */
export function sectionRanges(song: Song): SectionRange[] {
  const n = song.bars.length;
  const secs = [...song.sections].filter((s) => s.bar >= 0 && s.bar < n).sort((a, b) => a.bar - b.bar);
  if (!secs.length) return [{ name: 'Song', startBar: 0, endBar: n }];
  const out: SectionRange[] = [];
  if (secs[0].bar > 0) out.push({ name: 'Start', startBar: 0, endBar: secs[0].bar });
  secs.forEach((s, i) => out.push({ name: s.name, startBar: s.bar, endBar: i + 1 < secs.length ? secs[i + 1].bar : n }));
  return out;
}

/**
 * Name bars [startBar, endBar] (inclusive). Section marks inside the range are replaced; the
 * section that was running after the range continues after it.
 */
export function setSection(song: Song, startBar: number, endBar: number, name: string): Song {
  const next = structuredClone(song);
  const n = next.bars.length;
  const a = Math.max(0, Math.min(startBar, endBar));
  const b = Math.min(n - 1, Math.max(startBar, endBar));
  const before = sectionRanges(song).find((r) => r.startBar <= b + 1 && r.endBar > b + 1);
  next.sections = next.sections.filter((s) => s.bar < a || s.bar > b);
  next.sections.push({ bar: a, name });
  if (b + 1 < n && !next.sections.some((s) => s.bar === b + 1) && before && song.sections.length) {
    next.sections.push({ bar: b + 1, name: before.name });
  }
  next.sections.sort((x, y) => x.bar - y.bar);
  return next;
}

/** Remove the section mark at a bar. */
export function removeSection(song: Song, bar: number): Song {
  const next = structuredClone(song);
  next.sections = next.sections.filter((s) => s.bar !== bar);
  return next;
}
