// Round 7 sound library: SoundFont 2 helpers (pure, no DOM).
//  - list a file's presets, move all its presets to another bank range (so several SoundFonts can
//    be loaded into alphaTab's synth at once and a track picks one by bank + program),
//  - parse an SFZ instrument and write it as a one-preset SF2 (alphaTab only plays SoundFonts).

export interface Sf2Preset { name: string; bank: number; program: number }

interface Chunk { id: string; start: number; size: number }

function chunks(b: Uint8Array, start: number, end: number): Chunk[] {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: Chunk[] = [];
  let p = start;
  while (p + 8 <= end) {
    const id = String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);
    const size = dv.getUint32(p + 4, true);
    out.push({ id, start: p + 8, size });
    p += 8 + size + (size & 1);
  }
  return out;
}

function phdrChunk(b: Uint8Array): Chunk {
  if (String.fromCharCode(b[0], b[1], b[2], b[3]) !== 'RIFF' || String.fromCharCode(b[8], b[9], b[10], b[11]) !== 'sfbk') throw new Error('Not a SoundFont (sf2/sf3) file.');
  for (const c of chunks(b, 12, b.length)) {
    if (c.id !== 'LIST' || String.fromCharCode(b[c.start], b[c.start + 1], b[c.start + 2], b[c.start + 3]) !== 'pdta') continue;
    const ph = chunks(b, c.start + 4, c.start + c.size).find((x) => x.id === 'phdr');
    if (ph) return ph;
  }
  throw new Error('This SoundFont has no preset list.');
}

/** Presets of a .sf2 / .sf3 (bank 128 = drum kits). */
export function sf2Presets(b: Uint8Array): Sf2Preset[] {
  const ph = phdrChunk(b);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: Sf2Preset[] = [];
  const n = Math.floor(ph.size / 38) - 1; // the last record is the EOP terminator
  for (let i = 0; i < n; i++) {
    const p = ph.start + i * 38;
    let name = '';
    for (let k = 0; k < 20 && b[p + k]; k++) name += String.fromCharCode(b[p + k]);
    out.push({ name: name.trim(), program: dv.getUint16(p + 20, true), bank: dv.getUint16(p + 22, true) });
  }
  return out.sort((a, c) => a.bank - c.bank || a.program - c.program);
}

/** A copy with every preset's bank moved up by `base` (the file's own banks stay apart inside the range). */
export function moveSf2Banks(b: Uint8Array, base: number): Uint8Array {
  const out = b.slice();
  const ph = phdrChunk(out);
  const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const n = Math.floor(ph.size / 38) - 1;
  for (let i = 0; i < n; i++) {
    const p = ph.start + i * 38 + 22;
    dv.setUint16(p, Math.min(16383, dv.getUint16(p, true) + base), true);
  }
  return out;
}

/** Library sounds get bank ranges of 256 starting at 256 (the song's own SoundFont keeps 0..255). */
export { LIBRARY_BANK_STEP } from '../model/sounds';

// ------------------------------------------------------------------ SFZ

export type SfzRegion = Record<string, string>;

const NOTE: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
/** "c4" / "C#3" / "60" -> MIDI number (SFZ: c4 = 60). */
export function sfzKey(v: string | undefined, def: number): number {
  if (v === undefined || v === '') return def;
  if (/^-?\d+$/.test(v)) return Number(v);
  const m = /^([a-gA-G])([#b]?)(-?\d+)$/.exec(v.trim());
  if (!m) return def;
  return (Number(m[3]) + 1) * 12 + NOTE[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

/** Regions of an SFZ file (headers <control> <global> <master> <group> <region> inherit downwards; #define is applied). */
export function parseSfz(text: string): { regions: SfzRegion[]; defaultPath: string } {
  const defines = new Map<string, string>();
  const src = text.replace(/\/\*[\s\S]*?\*\//g, ' ').split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  let body = '';
  for (const line of src.split('\n')) {
    const d = /^\s*#define\s+(\$\w+)\s+(.+?)\s*$/.exec(line);
    if (d) { defines.set(d[1], d[2]); continue; }
    if (/^\s*#include/.test(line)) continue;
    body += line + '\n';
  }
  for (const [k, v] of defines) body = body.split(k).join(v);
  const regions: SfzRegion[] = [];
  const levels: Record<string, SfzRegion> = { global: {}, master: {}, group: {} };
  let current: SfzRegion | null = null;
  let header = '';
  let defaultPath = '';
  // Tokens: <header> or opcode=value (values may contain spaces: sample paths run until the next opcode).
  const re = /<(\w+)>|(\w+)=/g;
  const marks: { i: number; header?: string; key?: string; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) marks.push({ i: m.index, header: m[1], key: m[2], end: re.lastIndex });
  marks.forEach((mk, idx) => {
    if (mk.header) {
      header = mk.header;
      if (header === 'region') { current = { ...levels.global, ...levels.master, ...levels.group }; regions.push(current); }
      else if (header === 'group') { levels.group = {}; current = levels.group; }
      else if (header === 'master') { levels.master = {}; levels.group = {}; current = levels.master; }
      else if (header === 'global') { levels.global = {}; levels.master = {}; levels.group = {}; current = levels.global; }
      else current = header === 'control' ? {} : null;
      return;
    }
    const next = marks[idx + 1]?.i ?? body.length;
    const value = body.slice(mk.end, next).trim();
    if (header === 'control' && mk.key === 'default_path') { defaultPath = value; return; }
    if (current) (current as SfzRegion)[mk.key!] = value;
  });
  return { regions: regions.filter((r) => r.sample && (r.trigger ?? 'attack') === 'attack'), defaultPath };
}

// ------------------------------------------------------------------ SF2 writer

export interface Sf2Sample { name: string; data: Int16Array; rate: number; rootKey: number; correction: number; loopStart: number; loopEnd: number }
export interface Sf2Zone {
  sample: number;
  loKey: number; hiKey: number; loVel: number; hiVel: number;
  rootKey?: number;
  /** cents */
  tune?: number;
  /** centibels of attenuation (>= 0) */
  attenuation?: number;
  /** -500..500 (0.1 %) */
  pan?: number;
  /** 0 = no loop, 1 = loop, 3 = loop until release */
  loop?: number;
  /** seconds */
  attack?: number; decay?: number; release?: number;
  /** sustain attenuation in centibels */
  sustainCb?: number;
  /** sample start offset in frames */
  offset?: number;
}

const tc = (s: number) => Math.max(-12000, Math.min(8000, Math.round(1200 * Math.log2(Math.max(0.001, s)))));

/** One preset (bank 0, program 0) with one instrument holding every zone. */
export function writeSf2(name: string, samples: Sf2Sample[], zones: Sf2Zone[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const u8 = (n: number) => new Uint8Array(n);
  const str = (s: string, n: number) => { const a = u8(n); for (let i = 0; i < Math.min(n - 1, s.length); i++) a[i] = s.charCodeAt(i) & 0x7f; return a; };
  const chunk = (id: string, data: Uint8Array) => {
    const h = u8(8);
    for (let i = 0; i < 4; i++) h[i] = id.charCodeAt(i);
    new DataView(h.buffer).setUint32(4, data.length, true);
    return concat([h, data, data.length & 1 ? u8(1) : u8(0)]);
  };
  const list = (type: string, items: Uint8Array[]) => chunk('LIST', concat([str(type, 5).subarray(0, 4), ...items]));
  void parts;
  // sdta: samples back to back, 46 zero frames after each.
  const offsets: number[] = [];
  let total = 0;
  for (const s of samples) { offsets.push(total); total += s.data.length + 46; }
  const smpl = new Int16Array(total);
  samples.forEach((s, i) => smpl.set(s.data, offsets[i]));
  const smplBytes = new Uint8Array(smpl.buffer);
  // pdta
  const rec = (n: number, f: (dv: DataView) => void) => { const a = u8(n); f(new DataView(a.buffer)); return a; };
  const phdr = concat([
    rec(38, (dv) => { str(name, 20).forEach((c, i) => dv.setUint8(i, c)); dv.setUint16(20, 0, true); dv.setUint16(22, 0, true); dv.setUint16(24, 0, true); }),
    rec(38, (dv) => { str('EOP', 20).forEach((c, i) => dv.setUint8(i, c)); dv.setUint16(24, 1, true); }),
  ]);
  const pbag = concat([rec(4, (dv) => { dv.setUint16(0, 0, true); dv.setUint16(2, 0, true); }), rec(4, (dv) => { dv.setUint16(0, 1, true); dv.setUint16(2, 0, true); })]);
  const pmod = u8(10);
  const pgen = concat([rec(4, (dv) => { dv.setUint16(0, 41, true); dv.setUint16(2, 0, true); }), u8(4)]);
  const igens: Uint8Array[] = [];
  const ibags: Uint8Array[] = [];
  const gen = (oper: number, amount: number) => rec(4, (dv) => { dv.setUint16(0, oper, true); dv.setInt16(2, amount, true); });
  const range = (oper: number, lo: number, hi: number) => rec(4, (dv) => { dv.setUint16(0, oper, true); dv.setUint8(2, lo); dv.setUint8(3, hi); });
  for (const z of zones) {
    ibags.push(rec(4, (dv) => { dv.setUint16(0, igens.length, true); dv.setUint16(2, 0, true); }));
    igens.push(range(43, z.loKey, z.hiKey));
    igens.push(range(44, z.loVel, z.hiVel));
    if (z.offset) igens.push(gen(0, z.offset & 0x7fff), gen(4, Math.floor(z.offset / 32768)));
    if (z.pan) igens.push(gen(17, Math.max(-500, Math.min(500, Math.round(z.pan)))));
    if (z.attack !== undefined) igens.push(gen(34, tc(z.attack)));
    if (z.decay !== undefined) igens.push(gen(36, tc(z.decay)));
    if (z.sustainCb !== undefined) igens.push(gen(37, Math.max(0, Math.min(1440, Math.round(z.sustainCb)))));
    if (z.release !== undefined) igens.push(gen(38, tc(z.release)));
    if (z.attenuation) igens.push(gen(48, Math.max(0, Math.min(1440, Math.round(z.attenuation)))));
    if (z.tune) {
      const coarse = Math.trunc(z.tune / 100);
      if (coarse) igens.push(gen(51, coarse));
      if (z.tune - coarse * 100) igens.push(gen(52, Math.round(z.tune - coarse * 100)));
    }
    if (z.loop) igens.push(gen(54, z.loop));
    if (z.rootKey !== undefined) igens.push(gen(58, z.rootKey));
    igens.push(gen(53, z.sample));
  }
  ibags.push(rec(4, (dv) => { dv.setUint16(0, igens.length, true); }));
  igens.push(u8(4));
  const inst = concat([
    rec(22, (dv) => { str(name, 20).forEach((c, i) => dv.setUint8(i, c)); dv.setUint16(20, 0, true); }),
    rec(22, (dv) => { str('EOI', 20).forEach((c, i) => dv.setUint8(i, c)); dv.setUint16(20, zones.length, true); }),
  ]);
  const imod = u8(10);
  const shdr = concat([
    ...samples.map((s, i) => rec(46, (dv) => {
      str(s.name, 20).forEach((c, k) => dv.setUint8(k, c));
      const o = offsets[i];
      dv.setUint32(20, o, true);
      dv.setUint32(24, o + s.data.length, true);
      dv.setUint32(28, o + Math.max(0, Math.min(s.data.length - 1, s.loopStart)), true);
      dv.setUint32(32, o + Math.max(1, Math.min(s.data.length, s.loopEnd)), true);
      dv.setUint32(36, s.rate, true);
      dv.setUint8(40, s.rootKey);
      dv.setInt8(41, s.correction);
      dv.setUint16(42, 0, true);
      dv.setUint16(44, 1, true); // mono
    })),
    rec(46, (dv) => { str('EOS', 20).forEach((c, k) => dv.setUint8(k, c)); }),
  ]);
  const ifil = rec(4, (dv) => { dv.setUint16(0, 2, true); dv.setUint16(2, 1, true); });
  const body = concat([
    str('sfbk', 5).subarray(0, 4),
    list('INFO', [chunk('ifil', ifil), chunk('isng', str('EMU8000', 8)), chunk('INAM', str(name, Math.min(256, (name.length + 2) & ~1)))]),
    list('sdta', [chunk('smpl', smplBytes)]),
    list('pdta', [chunk('phdr', phdr), chunk('pbag', pbag), chunk('pmod', pmod), chunk('pgen', pgen), chunk('inst', inst), chunk('ibag', concat(ibags)), chunk('imod', imod), chunk('igen', concat(igens)), chunk('shdr', shdr)]),
  ]);
  return chunk('RIFF', body);
}

function concat(a: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(a.reduce((s, x) => s + x.length, 0));
  let p = 0;
  for (const x of a) { out.set(x, p); p += x.length; }
  return out;
}

/** SFZ regions + decoded samples -> SF2 zones (the opcodes SoundFont 2 can express). */
export function sfzToSf2(name: string, regions: SfzRegion[], samples: Map<string, { data: Float32Array; rate: number; loopStart?: number; loopEnd?: number; loopScale?: number }>, sampleOf: (r: SfzRegion) => string): Uint8Array {
  const list: Sf2Sample[] = [];
  const index = new Map<string, number>();
  const zones: Sf2Zone[] = [];
  for (const r of regions) {
    const key = sampleOf(r);
    const s = samples.get(key);
    if (!s) continue;
    const root = sfzKey(r.pitch_keycenter ?? r.key, 60);
    let si = index.get(key);
    if (si === undefined) {
      const d = new Int16Array(s.data.length);
      for (let i = 0; i < d.length; i++) d[i] = Math.max(-32768, Math.min(32767, Math.round(s.data[i] * 32767)));
      si = list.length;
      index.set(key, si);
      list.push({ name: key.split(/[\\/]/).pop()!.slice(0, 19), data: d, rate: Math.round(s.rate), rootKey: Math.max(0, Math.min(127, root)), correction: 0,
        loopStart: Math.round(Number(r.loop_start ?? r.loopstart ?? s.loopStart ?? 0) * (s.loopScale ?? 1)),
        loopEnd: Math.round(Number(r.loop_end ?? r.loopend ?? s.loopEnd ?? d.length - 1) * (s.loopScale ?? 1)) });
    }
    const lo = sfzKey(r.lokey ?? r.key, 0);
    const hi = sfzKey(r.hikey ?? r.key, 127);
    const mode = r.loop_mode ?? r.loopmode ?? (s.loopEnd ? 'loop_continuous' : 'no_loop');
    const vol = Number(r.volume ?? 0) + Number(r.amplitude !== undefined ? 20 * Math.log10(Math.max(0.0001, Number(r.amplitude) / 100)) : 0);
    zones.push({
      sample: si, loKey: Math.max(0, lo), hiKey: Math.min(127, hi), loVel: Number(r.lovel ?? 1), hiVel: Number(r.hivel ?? 127),
      rootKey: Math.max(0, Math.min(127, root)),
      tune: Number(r.tune ?? 0) + 100 * Number(r.transpose ?? 0),
      attenuation: vol < 0 ? -vol * 10 : 0, // dB -> centibels
      pan: Number(r.pan ?? 0) * 5,
      loop: mode === 'loop_continuous' ? 1 : mode === 'loop_sustain' ? 3 : 0,
      attack: r.ampeg_attack !== undefined ? Number(r.ampeg_attack) : undefined,
      decay: r.ampeg_decay !== undefined ? Number(r.ampeg_decay) : undefined,
      release: Number(r.ampeg_release ?? 0.25),
      sustainCb: r.ampeg_sustain !== undefined ? -200 * Math.log10(Math.max(0.001, Number(r.ampeg_sustain) / 100)) : undefined,
      offset: r.offset ? Number(r.offset) : undefined,
    });
  }
  if (!zones.length) throw new Error('No playable regions in this SFZ (samples missing or not readable).');
  return writeSf2(name, list, zones);
}
