// Round 7 singing: notes + lyrics -> DiffSinger inputs (phonemes, durations, f0) -> audio.
// Pure host code (no onnxruntime import): the worker passes the model runs in as callbacks.
// The phoneme timing, pitch curve (portamento + vibrato) and phrase splitting are ours; the
// voicebank's variance model predicts breathiness/voicing, its acoustic model makes the mel
// spectrogram and the NSF-HiFiGAN vocoder makes the waveform.

export interface SungNote { ms: number; durMs: number; pitch: number }
export interface SungSyllable {
  /** Syllable text without the trailing hyphen. */
  text: string;
  /** The word continues on the next syllable. */
  hyphen: boolean;
  /** 1..127 */
  velocity: number;
  notes: SungNote[];
}

export interface SingSettings {
  /** Vibrato depth in cents (0 = none) and rate in Hz. */
  vibratoCents: number;
  vibratoHz: number;
  /** 0..1: how much note velocity changes the loudness. */
  dynamics: number;
  /** 0..1: breaths before phrases + breathiness. */
  breath: number;
  /** -1..1 voice character (DiffSinger "gender": key-shift embedding). */
  gender: number;
  /** Diffusion steps (quality vs speed). */
  steps: number;
}

export const DEFAULT_SING: SingSettings = { vibratoCents: 35, vibratoHz: 5.5, dynamics: 0.5, breath: 0.4, gender: 0, steps: 20 };

export interface DsDict {
  words: Map<string, string[]>;
  /** symbol -> type (vowel, stop, fricative, liquid, nasal, semivowel, ...). */
  types: Map<string, string>;
}

/** Reads an OpenUtau DiffSinger dsdict*.yaml (symbols + entries) with a line parser (27 MB files). */
export function parseDsDict(text: string, prefix = 'en/'): DsDict {
  const words = new Map<string, string[]>();
  const types = new Map<string, string>();
  const lines = text.split(/\r?\n/);
  let mode: 'none' | 'symbols' | 'entries' = 'none';
  let sym = '';
  let word = '';
  let phs: string[] | null = null;
  const unq = (s: string) => {
    s = s.trim();
    if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) s = s.slice(1, -1).replace(/''/g, "'");
    return s;
  };
  const flush = () => { if (word && phs?.length) words.set(word.toLowerCase(), phs); word = ''; phs = null; };
  for (const line of lines) {
    if (/^symbols:/.test(line)) { mode = 'symbols'; continue; }
    if (/^entries:/.test(line)) { flush(); mode = 'entries'; continue; }
    if (/^\S/.test(line) && !line.startsWith('-')) { flush(); mode = 'none'; continue; }
    if (mode === 'symbols') {
      let m = /^- symbol:\s*(.+)$/.exec(line);
      if (m) { sym = unq(m[1]); continue; }
      m = /^\s+type:\s*(.+)$/.exec(line);
      if (m && sym) types.set(sym, unq(m[1]));
    } else if (mode === 'entries') {
      const m = /^- grapheme:\s*(.+)$/.exec(line);
      if (m) { flush(); word = unq(m[1]); continue; }
      if (/^\s+phonemes:/.test(line)) { phs = []; continue; }
      const p = /^\s+-\s*(.+)$/.exec(line);
      if (p && phs) {
        const ph = unq(p[1]);
        if (!prefix || ph.startsWith(prefix) || ph === 'SP' || ph === 'AP') phs.push(ph);
        else phs.length = 0, word = ''; // another language's phonemes: skip the entry
      }
    }
  }
  flush();
  return { words, types };
}

const isVowel = (d: DsDict, ph: string) => d.types.get(ph) === 'vowel' && ph !== 'SP' && ph !== 'AP';

const LETTERS: [RegExp, string[]][] = [
  [/^tch/, ['ch']], [/^ch/, ['ch']], [/^sh/, ['sh']], [/^th/, ['th']], [/^ng/, ['ng']], [/^ph/, ['f']], [/^ck/, ['k']], [/^qu/, ['k', 'w']],
  [/^ee/, ['iy']], [/^ea/, ['iy']], [/^oo/, ['uw']], [/^ou/, ['aw']], [/^ow/, ['ow']], [/^ai/, ['ey']], [/^ay/, ['ey']], [/^oa/, ['ow']], [/^oi/, ['oy']], [/^oy/, ['oy']],
  [/^a/, ['ae']], [/^e/, ['eh']], [/^i/, ['ih']], [/^o/, ['aa']], [/^u/, ['ah']], [/^y$/, ['iy']], [/^y/, ['y']],
  [/^b/, ['b']], [/^c(?=[eiy])/, ['s']], [/^c/, ['k']], [/^d/, ['d']], [/^f/, ['f']], [/^g/, ['g']], [/^h/, ['hh']], [/^j/, ['jh']], [/^k/, ['k']],
  [/^l/, ['l']], [/^m/, ['m']], [/^n/, ['n']], [/^p/, ['p']], [/^r/, ['r']], [/^s/, ['s']], [/^t/, ['t']], [/^v/, ['v']], [/^w/, ['w']],
  [/^x/, ['k', 's']], [/^z/, ['z']],
];

/** Phonemes of one word: the dictionary, else simple letter rules (unknown names, made-up words). */
export function wordPhonemes(d: DsDict, word: string, prefix = 'en/'): string[] {
  const w = word.toLowerCase().replace(/[^\p{L}']/gu, '');
  if (!w) return [];
  const hit = d.words.get(w) ?? d.words.get(w.replace(/'/g, '')) ?? d.words.get(w.replace(/'s$/, ''));
  if (hit) return hit;
  const out: string[] = [];
  let s = w.replace(/'/g, '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (s.length > 2 && s.endsWith('e') && !/[aeiou]e$/.test(s)) s = s.slice(0, -1); // silent e
  while (s) {
    const r = LETTERS.find(([re]) => re.test(s));
    if (!r) { s = s.slice(1); continue; }
    const m = r[0].exec(s)!;
    out.push(...r[1].map((p) => prefix + p));
    s = s.slice(m[0].length || 1);
  }
  return out;
}

/** Splits a word's phonemes over its sung syllables: one vowel nucleus each, consonants by maximal onset. */
export function splitWordPhonemes(d: DsDict, phs: string[], nSyl: number): string[][] {
  const out: string[][] = Array.from({ length: nSyl }, () => []);
  if (!phs.length) return out;
  const vowels = phs.map((p, i) => (isVowel(d, p) ? i : -1)).filter((i) => i >= 0);
  if (!vowels.length) { out[0] = phs.slice(); return out; }
  // Which vowel starts each syllable (extra vowels join the syllable before them).
  const starts: number[] = [];
  for (let k = 0; k < nSyl; k++) starts.push(vowels[Math.min(vowels.length - 1, Math.floor((k * vowels.length) / nSyl))]);
  for (let k = 0; k < nSyl; k++) {
    if (k > 0 && starts[k] === starts[k - 1]) {
      // More syllables than vowels: this syllable sings the previous vowel again.
      out[k] = [phs[starts[k]]];
      continue;
    }
    // Onset: consonants after the previous syllable's last vowel; the first of 2+ stays as its coda.
    const prevV = k === 0 ? -1 : vowels.filter((v) => v < starts[k]).pop()!;
    const cons = phs.slice(prevV + 1, starts[k]).filter((p) => !isVowel(d, p));
    const onset = k === 0 ? phs.slice(0, starts[k]) : cons.length >= 2 ? cons.slice(1) : cons;
    if (k > 0 && cons.length >= 2) out[k - 1].push(cons[0]);
    const nextStart = k + 1 < nSyl && starts[k + 1] !== starts[k] ? starts[k + 1] : phs.length;
    let end = nextStart;
    if (k + 1 < nSyl && starts[k + 1] !== starts[k]) {
      // Stop before the consonants that belong to the next syllable.
      end = starts[k] + 1;
      while (end < nextStart && isVowel(d, phs[end])) end++;
    }
    out[k].push(...onset, ...phs.slice(starts[k], end));
  }
  return out;
}

// ------------------------------------------------------------------ timing

export interface PhonemeSpan { ph: string; start: number; end: number }
export interface Phrase {
  /** ms of the first frame (phrase audio starts here). */
  startMs: number;
  phonemes: PhonemeSpan[];
  notes: SungNote[];
  syllables: SungSyllable[];
}

const CONS_MS: Record<string, number> = { stop: 55, fricative: 85, affricate: 85, aspirate: 70, liquid: 60, nasal: 65, semivowel: 55, vowel: 110 };
const consMs = (d: DsDict, ph: string) => CONS_MS[d.types.get(ph) ?? 'stop'] ?? 65;

/**
 * Lays the phonemes out in time: onset consonants end at the note start (so the vowel lands on
 * the beat), the vowel holds the note(s), coda consonants close it. Rests of 300 ms or more split
 * phrases; shorter ones become SP. A breath (AP) goes before a phrase when `breath` > 0 and there is room.
 */
export function layoutPhrases(d: DsDict, sylls: SungSyllable[], breath: number, prefix = 'en/'): Phrase[] {
  // Words -> syllable phonemes.
  const sp: string[][] = [];
  for (let i = 0; i < sylls.length;) {
    let j = i;
    while (j < sylls.length - 1 && sylls[j].hyphen) j++;
    const word = sylls.slice(i, j + 1).map((s) => s.text).join('');
    const parts = splitWordPhonemes(d, wordPhonemes(d, word, prefix), j - i + 1);
    for (const p of parts) sp.push(p.length ? p : [prefix + 'ah']);
    i = j + 1;
  }
  const phrases: Phrase[] = [];
  let cur: Phrase | null = null;
  let lastEnd = -Infinity;
  sylls.forEach((s, i) => {
    const start = s.notes[0].ms;
    const end = s.notes[s.notes.length - 1].ms + s.notes[s.notes.length - 1].durMs;
    if (!cur || start - lastEnd >= 300) {
      cur = { startMs: 0, phonemes: [], notes: [], syllables: [] };
      phrases.push(cur);
    }
    cur.syllables.push(s);
    cur.notes.push(...s.notes);
    lastEnd = end;
    void i;
  });
  // Phoneme spans per phrase.
  let k = 0;
  const FRAME = 512 / 44.1;
  let prevPhraseEnd = -Infinity;
  for (const p of phrases) {
    const spans: PhonemeSpan[] = [];
    const n = p.syllables.length;
    for (let i = 0; i < n; i++, k++) {
      const s = p.syllables[i];
      const phs = sp[k];
      const vi = Math.max(0, phs.findIndex((x) => isVowel(d, x)));
      const onset = phs.slice(0, vi);
      const rest = phs.slice(vi + 1);
      const sStart = s.notes[0].ms;
      const sEnd = s.notes[s.notes.length - 1].ms + s.notes[s.notes.length - 1].durMs;
      const prev = i > 0 ? p.syllables[i - 1] : null;
      const prevStart = prev ? prev.notes[0].ms : -Infinity;
      // Onset: wanted lengths, squeezed into 45 % of the previous syllable (or 250 ms at a phrase start).
      let on = onset.map((c) => consMs(d, c));
      const room = prev ? 0.45 * (sStart - prevStart) : 250;
      const sumOn = on.reduce((a, b) => a + b, 0);
      if (sumOn > room) on = on.map((x) => (x * room) / sumOn);
      let t = sStart - on.reduce((a, b) => a + b, 0);
      // The previous syllable ends where this onset starts (trim its last span).
      if (spans.length) {
        const last = spans[spans.length - 1];
        if (last.end > t) last.end = Math.max(last.start + FRAME, t);
        else if (last.end < t - 1) spans.push({ ph: 'SP', start: last.end, end: t });
      }
      onset.forEach((c, j) => { spans.push({ ph: c, start: t, end: t + on[j] }); t += on[j]; });
      // Vowel + the rest (coda); the coda takes at most 40 % of the syllable.
      const nextStart = i + 1 < n ? p.syllables[i + 1].notes[0].ms : Infinity;
      const end = Math.min(sEnd, nextStart);
      let cd = rest.map((c) => consMs(d, c));
      const sumCd = cd.reduce((a, b) => a + b, 0);
      const maxCd = 0.4 * (end - sStart);
      if (sumCd > maxCd) cd = cd.map((x) => (x * maxCd) / sumCd);
      const vEnd = end - cd.reduce((a, b) => a + b, 0);
      spans.push({ ph: phs[vi] ?? prefix + 'ah', start: t, end: Math.max(t + FRAME, vEnd) });
      t = Math.max(t + FRAME, vEnd);
      rest.forEach((c, j) => { spans.push({ ph: c, start: t, end: t + cd[j] }); t += cd[j]; });
    }
    // Breath before the phrase when the rest before it is long enough.
    const first = spans[0].start;
    const head = 8 * FRAME;
    if (breath > 0 && first - prevPhraseEnd > 450) {
      const bl = Math.min(380, (first - prevPhraseEnd) - 200) * (0.6 + 0.4 * breath);
      spans.unshift({ ph: 'AP', start: first - bl, end: first });
    }
    p.startMs = spans[0].start - head;
    spans.unshift({ ph: 'SP', start: p.startMs, end: spans[0].start });
    spans.push({ ph: 'SP', start: spans[spans.length - 1].end, end: spans[spans.length - 1].end + head });
    p.phonemes = spans;
    prevPhraseEnd = spans[spans.length - 1].end;
  }
  return phrases;
}

/** Phoneme spans -> whole-frame durations (cumulative rounding, like OpenUtau). */
export function frameDurations(p: Phrase, frameMs = 512 / 44.1): number[] {
  const out: number[] = [];
  let prev = 0;
  for (const s of p.phonemes) {
    const f = Math.max(prev + 1, Math.round((s.end - p.startMs) / frameMs));
    out.push(f - prev);
    prev = f;
  }
  return out;
}

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/** Pitch (MIDI, fractional) per frame: notes, 40 ms glides between them, delayed vibrato on long notes. */
export function pitchCurve(p: Phrase, frames: number, s: SingSettings, frameMs = 512 / 44.1): Float32Array {
  const notes = p.notes;
  const out = new Float32Array(frames);
  const G = 40;
  for (let f = 0; f < frames; f++) {
    const t = p.startMs + f * frameMs;
    let i = 0;
    while (i + 1 < notes.length && notes[i + 1].ms <= t) i++;
    const n = notes[i];
    let m = n.pitch;
    // Glide into the next note / from the previous one.
    const nx = notes[i + 1];
    if (nx && nx.ms - t < G) {
      const x = 0.5 - (nx.ms - t) / (2 * G);
      m += (nx.pitch - n.pitch) * (0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, x)));
    }
    const pv = notes[i - 1];
    if (pv && t - n.ms < G && t >= n.ms) {
      const x = 0.5 + (t - n.ms) / (2 * G);
      m = pv.pitch + (m - pv.pitch) * (0.5 - 0.5 * Math.cos(Math.PI * x));
    }
    // Vibrato: notes of 350 ms+, after a delay, fading in over 150 ms, stopping 60 ms before the end.
    if (s.vibratoCents > 0 && n.durMs >= 350 && t >= n.ms) {
      const delay = Math.min(250, n.durMs * 0.35);
      const into = t - n.ms - delay;
      const left = n.ms + n.durMs - 60 - t;
      if (into > 0 && left > 0) {
        const amp = Math.min(1, into / 150) * Math.min(1, left / 60);
        m += (amp * s.vibratoCents / 100) * Math.sin((2 * Math.PI * s.vibratoHz * into) / 1000);
      }
    }
    out[f] = m;
  }
  return out;
}

export const midiToHz = (c: Float32Array) => c.map((m) => hz(m));

/** Gain per output sample from note velocities (dynamics) with 20 ms ramps. */
export function dynamicsGain(p: Phrase, samples: number, sr: number, dynamics: number): Float32Array {
  const g = new Float32Array(samples).fill(1);
  if (dynamics <= 0) return g;
  const ramp = Math.round(0.02 * sr);
  let prev = 1;
  for (const s of p.syllables) {
    const target = Math.pow(Math.max(1, s.velocity) / 96, 1.6 * dynamics);
    const a = Math.max(0, Math.round(((s.notes[0].ms - p.startMs) / 1000) * sr));
    for (let i = a; i < samples; i++) {
      const k = Math.min(1, (i - a) / ramp);
      g[i] = prev + (target - prev) * k;
    }
    prev = target;
  }
  return g;
}

// ------------------------------------------------------------------ the run

export interface DsModels {
  /** phoneme -> token id, for the acoustic model and the variance model. */
  acousticIds: Record<string, number>;
  varianceIds: Record<string, number> | null;
  languages: Record<string, number>;
  /** Acoustic model: returns mel [frames * 128]. */
  acoustic: (x: { tokens: number[]; languages: number[]; durations: number[]; f0: Float32Array; breathiness: Float32Array; voicing: Float32Array; gender: Float32Array; velocity: Float32Array; steps: number; depth: number }) => Promise<Float32Array>;
  /** Variance model: breathiness + voicing per frame (dB). Null = constants. */
  variance: ((x: { tokens: number[]; languages: number[]; durations: number[]; pitch: Float32Array; steps: number }) => Promise<{ breathiness: Float32Array; voicing: Float32Array }>) | null;
  vocoder: (mel: Float32Array, f0: Float32Array, frames: number) => Promise<Float32Array>;
}

const tok = (ids: Record<string, number>, ph: string) => ids[ph] ?? ids['SP'] ?? 0;
const langOf = (langs: Record<string, number>, ph: string) => (ph.includes('/') ? langs[ph.split('/')[0]] ?? 0 : 0);

/** Renders all phrases into one mono buffer at 44.1 kHz, `totalMs` long. */
export async function singPhrases(m: DsModels, phrases: Phrase[], s: SingSettings, totalMs: number, onProgress?: (done: number, total: number) => void): Promise<{ audio: Float32Array; sampleRate: number; frames: number }> {
  const SR = 44100;
  const frameMs = 512 / 44.1;
  const audio = new Float32Array(Math.ceil(((totalMs + 1000) / 1000) * SR));
  let frames = 0;
  for (let pi = 0; pi < phrases.length; pi++) {
    const p = phrases[pi];
    const durs = frameDurations(p, frameMs);
    const T = durs.reduce((a, b) => a + b, 0);
    frames += T;
    const phs = p.phonemes.map((x) => x.ph);
    const midi = pitchCurve(p, T, s, frameMs);
    const f0 = midiToHz(midi);
    let breathiness: Float32Array = new Float32Array(T).fill(-60);
    let voicing: Float32Array = new Float32Array(T).fill(-12);
    if (m.variance && m.varianceIds) {
      const v = await m.variance({ tokens: phs.map((x) => tok(m.varianceIds!, x)), languages: phs.map((x) => langOf(m.languages, x)), durations: durs, pitch: midi, steps: 10 });
      breathiness = v.breathiness;
      voicing = v.voicing;
    }
    // Breath setting: +/- 8 dB around what the voicebank predicts.
    const bOff = (s.breath - 0.4) * 20;
    for (let i = 0; i < T; i++) breathiness[i] = Math.max(-96, Math.min(0, breathiness[i] + bOff));
    const mel = await m.acoustic({
      tokens: phs.map((x) => tok(m.acousticIds, x)), languages: phs.map((x) => langOf(m.languages, x)), durations: durs, f0,
      breathiness, voicing, gender: new Float32Array(T).fill(s.gender), velocity: new Float32Array(T).fill(1), steps: s.steps, depth: 0.6,
    });
    const wav = await m.vocoder(mel, f0, T);
    const gain = dynamicsGain(p, wav.length, SR, s.dynamics);
    const at = Math.round((p.startMs / 1000) * SR);
    // Short fades at both ends so phrases never click.
    const fade = Math.min(256, wav.length >> 2);
    for (let i = 0; i < wav.length; i++) {
      const j = at + i;
      if (j < 0 || j >= audio.length) continue;
      const f = Math.min(1, i / fade, (wav.length - 1 - i) / fade);
      audio[j] += wav[i] * gain[i] * f;
    }
    onProgress?.(pi + 1, phrases.length);
  }
  return { audio, sampleRate: SR, frames };
}
