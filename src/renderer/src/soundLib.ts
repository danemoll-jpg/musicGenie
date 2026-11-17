// Round 7 sound library (renderer side): the user's SoundFonts / SFZ instruments (settings.json),
// reading them (SFZ -> SF2 in memory), and the per-song set of library files the synth loads.
import { librarySoundFiles, LIBRARY_BANK_STEP, type Song } from '../../model';
import { moveSf2Banks, parseSfz, sf2Presets, sfzToSf2, type Sf2Preset } from '../../render/sf2';
import { readWav } from '../../ml/wav';
import { engine } from './audio/engine';

export interface LibraryItem { file: string; name: string; kind: 'sf2' | 'sfz' }

/** Recommended free libraries (Dan downloads them himself; nothing here is bundled). */
export const RECOMMENDED: { name: string; format: string; size: string; licence: string; url: string; note?: string }[] = [
  { name: 'MuseScore General', format: 'SF3 (or SF2)', size: '40 MB (SF2 216 MB)', licence: 'MIT', url: 'https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/', note: 'complete General MIDI set' },
  { name: 'FluidR3 GM', format: 'SF2', size: '141 MB (130 MB .tar.gz)', licence: 'MIT', url: 'https://ftp.osuosl.org/pub/musescore/soundfont/fluid-soundfont.tar.gz', note: 'classic General MIDI set' },
  { name: 'Salamander Grand Piano', format: 'SFZ + FLAC', size: '394 MB', licence: 'CC BY 3.0 (credit Alexander Holm)', url: 'https://sfzinstruments.github.io/pianos/salamander/', note: 'a Yamaha C5 grand, 16 velocity layers' },
  { name: 'VSCO 2 Community Edition', format: 'SFZ + WAV', size: '~2.3 GB', licence: 'CC0 (public domain)', url: 'https://github.com/sgossner/VSCO-2-CE', note: 'orchestral strings, winds, brass, percussion' },
  { name: 'VCSL (Versilian Community Sample Library)', format: 'SFZ + WAV', size: '~4 GB', licence: 'CC0 (public domain)', url: 'https://github.com/sgossner/VCSL', note: 'many acoustic instruments' },
  { name: 'Virtual Playing Orchestra 3', format: 'SFZ', size: '~600 MB', licence: 'mixed Creative Commons (free; credit)', url: 'https://virtualplaying.com/virtual-playing-orchestra/', note: 'link only: do not redistribute' },
];

const cache = new Map<string, Promise<Uint8Array>>();

const dirOf = (p: string) => p.replace(/[\\/][^\\/]*$/, '');
const join = (a: string, b: string) => (/^[a-zA-Z]:[\\/]|^[\\/]/.test(b) ? b : `${a}\\${b}`).replace(/\//g, '\\');

/** Sample rate written in a FLAC / Ogg Vorbis header (decodeAudioData resamples, so loops need the ratio). */
function headerRate(b: Uint8Array): number | null {
  if (b[0] === 0x66 && b[1] === 0x4c && b[2] === 0x61 && b[3] === 0x43) return (b[18] << 12) | (b[19] << 4) | (b[20] >> 4);
  for (let i = 0; i < Math.min(b.length - 16, 200); i++) {
    if (b[i] === 1 && b[i + 1] === 0x76 && b[i + 2] === 0x6f && b[i + 3] === 0x72) return new DataView(b.buffer, b.byteOffset + i + 12, 4).getUint32(0, true);
  }
  return null;
}

async function readSample(path: string): Promise<{ data: Float32Array; rate: number; loopStart?: number; loopEnd?: number; loopScale?: number }> {
  const f = await window.mg.readFile(path);
  if (/\.wav$/i.test(path)) {
    const pcm = readWav(f.bytes);
    const loop = wavLoop(f.bytes);
    return { data: pcm.channels[0], rate: pcm.sampleRate, ...(loop ?? {}) };
  }
  const buf = await engine.ctx.decodeAudioData(f.bytes.slice().buffer);
  // decodeAudioData resampled to the context rate: SFZ loop points (source frames) need scaling.
  const src = headerRate(f.bytes) ?? buf.sampleRate;
  return { data: buf.getChannelData(0).slice(), rate: buf.sampleRate, loopScale: buf.sampleRate / src };
}

/** A WAV's 'smpl' chunk loop (many SFZ libraries keep their loops there). */
function wavLoop(b: Uint8Array): { loopStart: number; loopEnd: number } | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let o = 12;
  while (o + 8 <= b.length) {
    const id = String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
    const size = dv.getUint32(o + 4, true);
    if (id === 'smpl' && size >= 60 && dv.getUint32(o + 8 + 28, true) > 0) return { loopStart: dv.getUint32(o + 8 + 44, true), loopEnd: dv.getUint32(o + 8 + 48, true) };
    o += 8 + size + (size & 1);
  }
  return null;
}

/** The library file as SoundFont bytes (SFZ converted once per session). */
export function libraryBytes(file: string): Promise<Uint8Array> {
  let p = cache.get(file);
  if (!p) {
    p = (async () => {
      if (!/\.sfz$/i.test(file)) return (await window.mg.readFile(file)).bytes;
      const text = new TextDecoder().decode((await window.mg.readFile(file)).bytes);
      const { regions, defaultPath } = parseSfz(text);
      const base = join(dirOf(file), defaultPath);
      const sampleOf = (r: Record<string, string>) => join(base, r.sample);
      const samples = new Map<string, Awaited<ReturnType<typeof readSample>>>();
      for (const r of regions) {
        const k = sampleOf(r);
        if (samples.has(k)) continue;
        try { samples.set(k, await readSample(k)); } catch { /* missing sample: its regions are skipped */ }
      }
      const name = file.split(/[\\/]/).pop()!.replace(/\.sfz$/i, '');
      return sfzToSf2(name, regions, samples, sampleOf);
    })();
    cache.set(file, p);
    p.catch(() => cache.delete(file));
  }
  return p;
}

export async function libraryPresets(item: LibraryItem): Promise<Sf2Preset[]> {
  const b = await libraryBytes(item.file);
  return sf2Presets(b).filter((p) => p.bank < 128);
}

/**
 * The extra SoundFonts a song needs, banks moved into place. A file that cannot be read is
 * replaced by the main SoundFont in that bank range, so its tracks still play (a GM sound).
 */
export async function songExtras(song: Song, mainBytes: () => Promise<Uint8Array>): Promise<{ extras: Uint8Array[]; missing: string[] }> {
  const files = librarySoundFiles(song);
  const extras: Uint8Array[] = [];
  const missing: string[] = [];
  for (let k = 0; k < files.length; k++) {
    let b: Uint8Array;
    try { b = await libraryBytes(files[k]); } catch { missing.push(files[k]); b = await mainBytes(); }
    extras.push(moveSf2Banks(b, LIBRARY_BANK_STEP * (k + 1)));
  }
  return { extras, missing };
}

export async function getLibrary(): Promise<LibraryItem[]> {
  return (await window.mg.settingsGet()).soundLibrary ?? [];
}

export async function addToLibrary(path?: string): Promise<LibraryItem | null> {
  const p = path ?? (await window.mg.pickFile('Add a SoundFont or SFZ instrument', [{ name: 'Sounds', extensions: ['sf2', 'sf3', 'sfz'] }]));
  if (!p) return null;
  const kind: LibraryItem['kind'] = /\.sfz$/i.test(p) ? 'sfz' : 'sf2';
  const item: LibraryItem = { file: p, name: p.split(/[\\/]/).pop()!.replace(/\.(sf2|sf3|sfz)$/i, ''), kind };
  await libraryPresets(item); // throws on a file we cannot use
  const lib = await getLibrary();
  if (!lib.some((x) => x.file.toLowerCase() === p.toLowerCase())) await window.mg.settingsSet({ soundLibrary: [...lib, item] });
  return item;
}

export async function removeFromLibrary(file: string) {
  const lib = await getLibrary();
  cache.delete(file);
  await window.mg.settingsSet({ soundLibrary: lib.filter((x) => x.file !== file) });
}
