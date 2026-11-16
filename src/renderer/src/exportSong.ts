// File > Export (Round 5): mixdown WAV/MP3 (offline, through the mixer, faster than real time),
// loudness normalise + peak limit, stems, MIDI, MusicXML, Guitar Pro and a PDF of the score.
import { exportGuitarPro, exportMidi, exportMusicXml } from '../../export';
import { integratedLoudness, limitPeaks, normalizeLoudness, peakOf, serializeProject, songLengthMs, type DisplayMode, type Song } from '../../model';
import { renderSong } from './audio/offline';
import { wavBytes } from './audio/render';
import type { ScorePlayer } from './player';

export interface ExportSettings {
  dir: string;
  name: string;
  wav: boolean;
  mp3: boolean;
  mp3Kbps: number;
  normalize: boolean;
  targetLufs: number;
  limit: boolean;
  ceilingDb: number;
  stems: 'none' | 'tracks' | 'buses' | 'both';
  midi: boolean;
  musicxml: boolean;
  gp: boolean;
  pdf: boolean;
  pdfTracks: number[];
  pdfMode: DisplayMode;
  pageSize: 'Letter' | 'A4';
  /** Keep this much after the last bar for reverb/delay tails (0 = exactly the song length). */
  tailMs: number;
}

export function defaultExportSettings(song: Song, dir: string): ExportSettings {
  return {
    dir, name: (song.title || 'Song').replace(/[\\/:*?"<>|]/g, '_'),
    wav: true, mp3: true, mp3Kbps: 192, normalize: true, targetLufs: -14, limit: true, ceilingDb: -1,
    stems: 'none', midi: true, musicxml: true, gp: !!song.tracks.some((t) => t.tuning), pdf: true,
    pdfTracks: song.tracks.map((t, i) => (t.display.visible && !t.audio ? i : -1)).filter((i) => i >= 0), pdfMode: 'both', pageSize: 'Letter', tailMs: 0,
  };
}

export interface ExportReport {
  files: { kind: string; path: string; bytes: number }[];
  songMs: number;
  wavMs?: number;
  lufsBefore?: number;
  lufsAfter?: number;
  peakDb?: number;
  renderMs?: number;
  /** Rendering speed (x real time). */
  speed?: number;
  pdf?: { pages: number; png: string | null };
}

async function mp3Bytes(samples: Float32Array, sr: number, kbps: number, progress?: (m: string) => void): Promise<Uint8Array> {
  const { Mp3Encoder } = await import('@breezystack/lamejs'); // LGPL: kept as its own chunk
  const enc = new Mp3Encoder(2, sr, kbps);
  const frames = samples.length / 2;
  const block = 1152 * 20;
  const out: Uint8Array[] = [];
  const L = new Int16Array(block);
  const R = new Int16Array(block);
  for (let i = 0; i < frames; i += block) {
    const n = Math.min(block, frames - i);
    for (let j = 0; j < n; j++) {
      L[j] = Math.max(-32768, Math.min(32767, Math.round(samples[2 * (i + j)] * 32767)));
      R[j] = Math.max(-32768, Math.min(32767, Math.round(samples[2 * (i + j) + 1] * 32767)));
    }
    const b = enc.encodeBuffer(L.subarray(0, n), R.subarray(0, n));
    if (b.length) out.push(b.slice());
    if ((i / block) % 40 === 0) {
      progress?.('Encoding MP3 ' + Math.round((i / frames) * 100) + '%');
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  const tail = enc.flush();
  if (tail.length) out.push(tail.slice());
  const total = out.reduce((a, b) => a + b.length, 0);
  const res = new Uint8Array(total);
  let o = 0;
  for (const b of out) { res.set(b, o); o += b.length; }
  return res;
}

export async function exportSong(player: ScorePlayer, song: Song, s: ExportSettings, progress?: (m: string) => void): Promise<ExportReport> {
  const base = s.dir.replace(/[\\/]+$/, '') + '\\' + s.name;
  const report: ExportReport = { files: [], songMs: songLengthMs(song) };
  const write = async (kind: string, path: string, bytes: Uint8Array) => {
    await window.mg.writeBytes(path, bytes);
    report.files.push({ kind, path, bytes: bytes.length });
  };

  if (s.wav || s.mp3 || s.stems !== 'none') {
    progress?.('Rendering the mix…');
    const stems = s.stems === 'none' ? null : { tracks: s.stems !== 'buses', buses: s.stems !== 'tracks' };
    const r = await renderSong(player, song, { stems, tailMs: s.tailMs });
    report.renderMs = r.renderMs;
    report.speed = Math.round(((r.samples.length / 2 / r.sampleRate) * 1000 / Math.max(1, r.renderMs)) * 10) / 10;
    const mix = r.samples;
    if (s.normalize) {
      progress?.('Normalising loudness…');
      const n = normalizeLoudness(mix, r.sampleRate, s.targetLufs, s.limit ? s.ceilingDb : 0);
      report.lufsBefore = Math.round(n.before * 10) / 10;
      report.lufsAfter = Math.round(n.after * 10) / 10;
    } else {
      if (s.limit) limitPeaks(mix, r.sampleRate, s.ceilingDb);
      report.lufsAfter = Math.round(integratedLoudness(mix, r.sampleRate) * 10) / 10;
    }
    report.peakDb = Math.round(20 * Math.log10(peakOf(mix) || 1e-9) * 100) / 100;
    if (s.wav) {
      const wav = wavBytes(mix, r.sampleRate);
      report.wavMs = ((wav.length - 44) / 4 / r.sampleRate) * 1000;
      await write('wav', base + '.wav', wav);
    }
    if (s.mp3) await write('mp3', base + '.mp3', await mp3Bytes(mix, r.sampleRate, s.mp3Kbps, progress));
    for (const [i, st] of r.stems.entries()) {
      progress?.('Writing stems…');
      await write('stem', base + '_stems\\' + String(i + 1).padStart(2, '0') + ' ' + st.name.replace(/[\\/:*?"<>|]/g, '_') + '.wav', wavBytes(st.samples, r.sampleRate));
    }
  }
  if (s.midi) await write('midi', base + '.mid', exportMidi(song));
  if (s.musicxml) await write('musicxml', base + '.musicxml', new TextEncoder().encode(exportMusicXml(song)));
  if (s.gp) {
    try {
      await write('gp', base + '.gp', exportGuitarPro(song));
    } catch (e) {
      report.files.push({ kind: 'gp-error: ' + (e as Error).message, path: '', bytes: 0 });
    }
  }
  if (s.pdf) {
    progress?.('Printing the score…');
    const r = await window.mg.printPdf({
      out: base + '.pdf',
      pngOut: base + '-page1.png',
      job: { json: serializeProject(song), tracks: s.pdfTracks, mode: s.pdfMode, pageSize: s.pageSize },
    });
    report.files.push({ kind: 'pdf', path: r.path, bytes: r.bytes });
    report.pdf = { pages: r.pages, png: r.png };
  }
  return report;
}
