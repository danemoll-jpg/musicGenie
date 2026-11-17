// Round 7 sound library: which library files a song uses and the bank range each one gets in the
// synth (the song's own SoundFont keeps banks 0..255; library file k gets 256*(k+1) + its own bank).
import type { Song, Track } from './types';

export const LIBRARY_BANK_STEP = 256;
/** alphaTab's synth keeps 11 bits of the bank (0..2047): 7 library files per song. */
export const MAX_LIBRARY_FILES = 7;

/** Library files used by the song's tracks, in a stable order (first use). */
export function librarySoundFiles(song: Song): string[] {
  const out: string[] = [];
  for (const t of song.tracks) if (t.sound && !out.includes(t.sound.file)) out.push(t.sound.file);
  return out.slice(0, MAX_LIBRARY_FILES);
}

/** The synth bank a track plays from (0 = the song's SoundFont as before). */
export function trackBank(song: Song, track: Track): number {
  if (!track.sound) return 0;
  const k = librarySoundFiles(song).indexOf(track.sound.file);
  return k < 0 ? 0 : Math.min(2047, LIBRARY_BANK_STEP * (k + 1) + (track.sound.bank & 127));
}

export function setTrackSound(song: Song, trackId: string, sound: Track['sound'] | null): Song {
  return {
    ...song,
    tracks: song.tracks.map((t) => {
      if (t.id !== trackId) return t;
      const n = { ...t };
      // The instrument stays: removing the sound brings the track's own instrument back.
      if (sound) n.sound = sound;
      else delete n.sound;
      return n;
    }),
  };
}
