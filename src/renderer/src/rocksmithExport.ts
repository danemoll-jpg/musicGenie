// Export to Rocksmith 2014: arrangements (model -> JSON), audio (render or recording -> WAV),
// then the .NET helper writes XML, runs the arrangement checks, converts audio with Wwise and
// builds the .psarc. If Wwise is missing or fails, it stops there and keeps everything (incl. a
// DLC Builder project) so the song can be finished by hand.
import { rocksmithArrangement, type RsArrangement, type RsExportReport } from '../../model/rocksmith';
import { songLengthMs } from '../../model/tempo';
import type { RocksmithExport, Song } from '../../model/types';
import { decodeRecording, place, renderMix, wavBytes, wavLengthMs } from './audio/render';
import type { ScorePlayer } from './player';

export interface RsIssue {
  arrangement: string;
  type: string;
  severity: 'error' | 'warning';
  timeMs: number | null;
}

export interface RsExportResult {
  stage: 'done' | 'wwise' | 'checks';
  error?: string;
  psarc?: string;
  copiedTo?: string | null;
  rs2dlc: string;
  outDir: string;
  audioWav: string;
  previewWav: string;
  xmlFiles: string[];
  issues: RsIssue[];
  arrangements: { arrangement: string; xml: string; ddLevels: number }[];
  reports: RsExportReport[];
  audio: { mode: RocksmithExport['audio']; wavMs: number; songMs: number; leadInMs: number; synthEndMs?: number; renderMs?: number };
}

const safe = (s: string) => (s || 'Untitled').replace(/[^\p{L}\p{N} _-]/gu, '').trim().replace(/\s+/g, '-') || 'Untitled';

export async function defaultExportDir(song: Song, s: RocksmithExport): Promise<string> {
  const { documents } = await window.mg.paths();
  return `${documents}\\musicGenie\\Rocksmith\\${safe(s.artist || song.artist || 'Unknown')}_${safe(s.title || song.title)}`;
}

export async function exportRocksmith(
  player: ScorePlayer,
  song: Song,
  s: RocksmithExport,
  opts: { outDir?: string; author?: string; onStep?: (msg: string) => void } = {},
): Promise<RsExportResult> {
  const step = opts.onStep ?? (() => {});
  if (!s.arrangements.length) throw new Error('Pick at least one guitar or bass track to export.');
  // 1. Arrangements
  step('Converting the parts');
  const built = s.arrangements.map((a) => rocksmithArrangement(song, a.trackId, { type: a.type, bonus: a.bonus }));
  const leadInMs = built[0].report.leadInMs;
  const totalMs = built[0].report.songLengthMs;
  const songMs = songLengthMs(song);

  // 2. Audio
  const outDir = opts.outDir ?? (await defaultExportDir(song, s));
  let samples: Float32Array;
  const audio: RsExportResult['audio'] = { mode: s.audio, wavMs: 0, songMs: Math.round(songMs), leadInMs };
  if (s.audio === 'file') {
    if (!s.audioFile) throw new Error('Choose the recording to use as the song audio.');
    step('Reading the recording');
    const rec = await decodeRecording(s.audioFile);
    samples = place(rec, s.audioOffsetMs ?? 0, leadInMs, totalMs);
  } else {
    step('Rendering the audio');
    const exclude = s.audio === 'mixWithout' ? s.arrangements.map((a) => a.trackId) : [];
    const r = await renderMix(player, song, exclude);
    audio.synthEndMs = Math.round(r.synthEndMs);
    audio.renderMs = r.renderMs;
    // Bar 1 of the render goes after the lead-in; the synth's release tail is cut at the song end.
    const cut = r.samples.subarray(0, Math.min(r.samples.length, Math.round((songMs / 1000) * r.sampleRate) * 2));
    samples = place(cut, 0, leadInMs, totalMs, r.sampleRate);
  }
  const wav = wavBytes(samples);
  audio.wavMs = Math.round(wavLengthMs(wav));
  const wavPath = `${outDir}\\song_audio.wav`;
  await window.mg.writeBytes(wavPath, wav);

  // 3. Helper
  step('Writing the Rocksmith files');
  const args = {
    outDir,
    title: s.title || song.title,
    artist: s.artist || song.artist || 'Unknown',
    album: s.album || song.album || '',
    year: s.year || new Date().getFullYear(),
    author: opts.author || 'musicGenie',
    albumArt: s.albumArt || '',
    audioWav: wavPath,
    previewStartMs: (s.previewStartMs ?? 0) + leadInMs,
    copyToDlc: s.copyToDlc || '',
    arrangements: built.map((b, i) => ({ ...b.arrangement, bassPicked: b.arrangement.bassPicked, priority: s.arrangements[i].bonus ? 'Bonus' : 'Main' }) as RsArrangement),
  };
  const r = await window.mg.rs<Omit<RsExportResult, 'reports' | 'audio'>>('write', args);
  return { ...r, reports: built.map((b) => b.report), audio };
}
