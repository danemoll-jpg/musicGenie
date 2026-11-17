// Round 7 "Describe a song": a sentence -> a song plan (key, tempo, time, feel, style, lineup, form)
// -> a chord chart (Round 4) -> the band (Round 2). The built-in parser understands the common
// wording; a free-form description can instead be turned into the same plan by Claude (main process).
import { STYLES, STYLE_IDS } from './band';
import { parseKeyName } from './chart';
import { PROGRESSIONS, romanToChord, type Key } from './progressions';
import type { BandRole, BandSettings, StyleId } from './types';

export interface PlanSection {
  name: string;
  /** Roman numerals, one per bar ("IV V" = two chords in the bar). */
  bars: string[];
  /** Times through (1 = once). */
  repeat: number;
}

export interface SongPlan {
  title: string;
  /** Tonic, e.g. "E", "F#", "Bb". */
  key: string;
  mode: 'major' | 'minor';
  bpm: number;
  timeSig: [number, number];
  feel: 'straight' | 'shuffle' | 'swing';
  style: StyleId;
  /** Band players that play, with their instrument (catalogue ids). */
  players: { role: BandRole; instrumentId: string }[];
  sections: PlanSection[];
  /** What the parser assumed (shown with the plan). */
  notes: string[];
}

const NUM_WORDS: Record<string, number> = { one: 1, once: 1, two: 2, twice: 2, three: 3, thrice: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, sixteen: 16 };
const num = (s: string) => (/^\d+$/.test(s) ? Number(s) : NUM_WORDS[s.toLowerCase()] ?? NaN);
const NUMBER = '(\\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve|sixteen)';

/** Instrument words -> catalogue id and the band role they prefer. */
const INSTR: { re: RegExp; id: string | ((style: StyleId) => string); role: BandRole | 'chordal' | 'melodic' }[] = [
  { re: /\bdrums?\b|\bdrum kit\b|\bpercussion\b/, id: 'drum-kit', role: 'drums' },
  { re: /\bupright bass\b|\bdouble bass\b|\bacoustic bass\b/, id: 'acoustic-bass', role: 'bass' },
  { re: /\bslap bass\b/, id: 'slap-bass', role: 'bass' },
  { re: /\bfretless\b/, id: 'fretless-bass', role: 'bass' },
  { re: /\bsynth bass\b/, id: 'synth-bass', role: 'bass' },
  { re: /\bbass\b/, id: (s) => STYLES[s].instruments.bass, role: 'bass' },
  { re: /\b(acoustic|steel[- ]string) guitar\b/, id: 'steel-guitar', role: 'chordal' },
  { re: /\b(nylon|classical) guitar\b/, id: 'nylon-guitar', role: 'chordal' },
  { re: /\bjazz guitar\b/, id: 'jazz-guitar', role: 'chordal' },
  { re: /\b(distorted|distortion|heavy|metal) guitar\b/, id: 'distortion-guitar', role: 'chordal' },
  { re: /\b(overdrive|overdriven|crunchy?) guitar\b/, id: 'overdrive-guitar', role: 'chordal' },
  { re: /\bclean guitar\b/, id: 'electric-guitar-clean', role: 'chordal' },
  { re: /\blead guitar\b/, id: (s) => STYLES[s].instruments.lead.includes('guitar') ? STYLES[s].instruments.lead : 'overdrive-guitar', role: 'lead' },
  { re: /\bguitars?\b/, id: (s) => STYLES[s].instruments.rhythm.includes('guitar') ? STYLES[s].instruments.rhythm : 'electric-guitar-clean', role: 'chordal' },
  { re: /\b(electric piano|rhodes|wurlitzer|e-?piano)\b/, id: 'electric-piano', role: 'chordal' },
  { re: /\bpiano\b|\bkeys\b|\bkeyboards?\b/, id: 'acoustic-grand-piano', role: 'chordal' },
  { re: /\b(hammond|organ)\b/, id: 'drawbar-organ', role: 'chordal' },
  { re: /\bstrings\b/, id: 'string-ensemble', role: 'chordal' },
  { re: /\bpads?\b/, id: 'warm-pad', role: 'chordal' },
  { re: /\btenor sax/, id: 'tenor-sax', role: 'melodic' },
  { re: /\balto sax/, id: 'alto-sax', role: 'melodic' },
  { re: /\bsax(ophone)?\b/, id: 'tenor-sax', role: 'melodic' },
  { re: /\btrumpet\b|\bhorns?\b/, id: 'trumpet', role: 'melodic' },
  { re: /\btrombone\b/, id: 'trombone', role: 'melodic' },
  { re: /\b(violin|fiddle)\b/, id: 'violin', role: 'melodic' },
  { re: /\bcello\b/, id: 'cello', role: 'melodic' },
  { re: /\bflute\b/, id: 'flute', role: 'melodic' },
  { re: /\bclarinet\b/, id: 'clarinet', role: 'melodic' },
  { re: /\bharmonica\b/, id: 'accordion', role: 'melodic' },
  { re: /\bsynth\b|\bsynthesi[sz]er\b/, id: 'saw-lead', role: 'melodic' },
  { re: /\bvibes\b|\bvibraphone\b/, id: 'vibraphone', role: 'melodic' },
];

const STYLE_WORDS: [RegExp, StyleId][] = [
  [/\bblues\b|\bshuffle\b|\bboogie\b/, 'blues'],
  [/\bjazz\b|\bswing\b|\bbebop\b|\bbossa\b|\blatin\b/, 'jazz'],
  [/\bcountry\b|\bbluegrass\b|\bfolk\b|\bwestern\b/, 'country'],
  [/\bpop\b|\bballad\b|\bsoul(ful)?\b|\bfunky?\b|\bdisco\b|\br&b\b|\bindie\b/, 'pop'],
  [/\brock\b|\bpunk\b|\bmetal\b|\bgrunge\b|\bhard rock\b/, 'rock'],
];

const PROG_WORDS: [RegExp, string][] = [
  [/\bminor blues\b/, 'minorblues'],
  [/\bquick[- ]change\b/, 'quickchange'],
  [/\b12[- ]bar\b|\btwelve[- ]bar\b|\bblues (form|changes)\b/, 'blues12'],
  [/\bii[- ]v[- ]i\b|\b2[- ]5[- ]1\b/, 'iiVI'],
  [/\b(50s|fifties|doo[- ]wop)\b|\bi[- ]vi[- ]iv[- ]v\b/, 'fifties'],
  [/\bi[- ]v[- ]vi[- ]iv\b|\baxis\b/, 'pop'],
  [/\bvi[- ]iv[- ]i[- ]v\b/, 'sadpop'],
  [/\bcanon\b|\bpachelbel\b/, 'canon'],
  [/\bandalusian\b/, 'andalusian'],
  [/\broyal road\b/, 'royal'],
  [/\bturnaround\b|\bi[- ]vi[- ]ii[- ]v\b/, 'turnaround'],
  [/\bi[- ]bvii[- ]iv\b|\bmixolydian\b/, 'mixo'],
  [/\bi[- ]iv[- ]v\b|\bthree[- ]chord\b|\b3[- ]chord\b/, 'threechord'],
];

const prog = (id: string) => PROGRESSIONS.find((p) => p.id === id)!;

/** Built-in parser: the description -> a plan (always returns one; `notes` says what was assumed). */
export function parseDescription(text: string): SongPlan {
  const t = ' ' + text.toLowerCase().replace(/[♯]/g, '#').replace(/[♭]/g, 'b').replace(/\s+/g, ' ') + ' ';
  const notes: string[] = [];
  // ---- style
  let style: StyleId | null = null;
  for (const [re, s] of STYLE_WORDS) if (re.test(t)) { style = s; break; }
  // ---- key + mode
  let key = '';
  let mode: 'major' | 'minor' = 'major';
  const km = /\b(?:in|key of|key:?)\s+([a-g])(#|b| sharp| flat)?\s*(major|minor|maj|min|m)?(?![a-z])/.exec(t)
    ?? /\b([a-g])(#|b| sharp| flat)?\s*(major|minor)\b/.exec(t);
  if (km) {
    key = km[1].toUpperCase() + (km[2] ? (km[2].includes('sharp') || km[2] === '#' ? '#' : 'b') : '');
    if (km[3] && /^(minor|min|m)$/.test(km[3])) mode = 'minor';
  }
  if (/\bminor\b|\bdorian\b|\baeolian\b|\bphrygian\b/.test(t)) mode = 'minor';
  if (!key) { key = style === 'country' || style === 'rock' ? 'G' : style === 'jazz' ? 'F' : style === 'blues' ? 'A' : 'C'; notes.push(`no key given: ${key}${mode === 'minor' ? ' minor' : ''}`); }
  // ---- form / progression
  let progId: string | null = null;
  for (const [re, id] of PROG_WORDS) if (re.test(t)) { progId = id; break; }
  if (progId === 'blues12' && mode === 'minor') progId = 'minorblues';
  if (!style) style = progId && /blues/.test(progId) ? 'blues' : progId === 'iiVI' ? 'jazz' : 'rock';
  // ---- tempo
  let bpm = 0;
  const bm = /\b(\d{2,3})\s*(?:bpm|beats per minute)\b/.exec(t) ?? /\b(?:at|tempo:?|@)\s*(\d{2,3})\b/.exec(t);
  if (bm) bpm = Number(bm[1]);
  else if (/\b(very slow|ballad)\b/.test(t)) bpm = 66;
  else if (/\bslow\b/.test(t)) bpm = 72;
  else if (/\b(medium|mid[- ]tempo|moderate)\b/.test(t)) bpm = 100;
  else if (/\b(very fast|blazing)\b/.test(t)) bpm = 180;
  else if (/\b(fast|up[- ]?tempo|quick)\b/.test(t)) bpm = 144;
  if (!bpm) { bpm = { rock: 120, blues: 96, country: 112, jazz: 132, pop: 104 }[style]; notes.push(`no tempo given: ${bpm} bpm`); }
  bpm = Math.max(30, Math.min(300, bpm));
  // ---- time signature
  let timeSig: [number, number] = [4, 4];
  const ts = /\b(\d{1,2})\/(2|4|8|16)\b/.exec(t);
  if (ts) timeSig = [Number(ts[1]), Number(ts[2])];
  else if (/\bwaltz\b|\bin three\b|\btriple meter\b/.test(t)) timeSig = [3, 4];
  // ---- feel
  let feel: SongPlan['feel'] = style === 'blues' ? 'shuffle' : style === 'jazz' ? 'swing' : 'straight';
  if (/\bshuffle\b|\bshuffled\b/.test(t)) feel = 'shuffle';
  else if (/\bswing\b|\bswung\b/.test(t)) feel = 'swing';
  else if (/\bstraight\b|\beven eighths\b/.test(t)) feel = 'straight';
  // ---- lineup
  const players: SongPlan['players'] = [];
  const without = /\b(?:no|without)\s+(drums?|bass|guitars?|piano|keys)\b/g;
  const off = new Set<string>();
  for (let m; (m = without.exec(t));) off.add(m[1].replace(/s$/, ''));
  let rest = t.replace(/\b(?:no|without)\s+(drums?|bass|guitars?|piano|keys)\b/g, ' ');
  const found: { at: number; id: string; role: BandRole | 'chordal' | 'melodic' }[] = [];
  for (const ins of INSTR) {
    const m = ins.re.exec(rest);
    if (!m) continue;
    found.push({ at: m.index, id: typeof ins.id === 'string' ? ins.id : ins.id(style), role: ins.role });
    rest = rest.slice(0, m.index) + ' '.repeat(m[0].length) + rest.slice(m.index + m[0].length);
  }
  found.sort((a, b) => a.at - b.at);
  const take = (role: BandRole, id: string) => { if (!players.some((p) => p.role === role)) players.push({ role, instrumentId: id }); };
  for (const f of found) {
    if (f.role === 'drums' || f.role === 'bass') take(f.role, f.id);
    else if (f.role === 'lead' || f.role === 'melodic') { if (!players.some((p) => p.role === 'lead')) take('lead', f.id); else take('rhythm', f.id); }
    else if (!players.some((p) => p.role === 'rhythm')) take('rhythm', f.id);
    else take('lead', f.id);
  }
  if (!found.length) {
    for (const r of ['drums', 'bass', 'rhythm'] as BandRole[]) if (!off.has(r === 'rhythm' ? 'guitar' : r.replace(/s$/, ''))) players.push({ role: r, instrumentId: STYLES[style].instruments[r] });
    notes.push('no instruments given: drums, bass and ' + STYLES[style].instruments.rhythm.replace(/-/g, ' '));
  }
  // ---- sections
  const sections: PlanSection[] = [];
  const times = (() => {
    const m = new RegExp(`\\b${NUMBER}\\s+(choruses|times|rounds|passes|verses|repeats)\\b`).exec(t) ?? new RegExp(`\\b(twice|thrice|once)\\b`).exec(t)
      ?? new RegExp(`\\bx\\s?${NUMBER}\\b`).exec(t);
    return m ? num(m[1]) : NaN;
  })();
  const barsWanted = (() => { const m = new RegExp(`\\b${NUMBER}[- ]bars?\\b`).exec(t); return m ? num(m[1]) : NaN; })();
  if (/\baaba\b|\b32[- ]bar\b/.test(t)) {
    const a = progId ? fit(prog(progId).bars, 8) : (mode === 'minor' ? fit(prog('minorpop').bars, 8) : ['I', 'vi', 'ii', 'V', 'I', 'vi', 'ii V', 'I']);
    const b = mode === 'minor' ? ['iv', 'iv', 'i', 'i', 'bVI', 'bVI', 'V', 'V'] : ['IV', 'IV', 'I', 'I', 'II7', 'II7', 'V', 'V7'];
    const rep = Number.isFinite(times) ? times : 1;
    for (let k = 0; k < rep; k++) sections.push({ name: 'A', bars: a, repeat: 1 }, { name: 'A', bars: a, repeat: 1 }, { name: 'B', bars: b, repeat: 1 }, { name: 'A', bars: a, repeat: 1 });
    notes.push('AABA: 8-bar A and B sections');
  } else if (/\bverse[- /,]*(and )?chorus\b|\bverses? and choruses\b|\bpop song\b/.test(t) || (/\bverse\b/.test(t) && /\bchorus\b/.test(t) && !/blues/.test(progId ?? ''))) {
    const v = progId ? fit(prog(progId).bars, 8) : mode === 'minor' ? fit(prog('minorpop').bars, 8) : fit(prog('sadpop').bars, 8);
    const c = mode === 'minor' ? fit(prog('andalusian').bars, 8) : fit(prog('pop').bars, 8);
    const pairs = Number.isFinite(times) ? times : 2;
    sections.push({ name: 'Intro', bars: c.slice(0, 4), repeat: 1 });
    for (let k = 0; k < pairs; k++) sections.push({ name: 'Verse', bars: v, repeat: 1 }, { name: 'Chorus', bars: c, repeat: 1 });
    if (/\bbridge\b/.test(t)) sections.splice(sections.length - 1, 0, { name: 'Bridge', bars: mode === 'minor' ? ['bVI', 'bVII', 'bVI', 'V'] : ['IV', 'V', 'iii', 'vi'], repeat: 1 });
    sections.push({ name: 'Outro', bars: [c[0], c[0]], repeat: 1 });
    notes.push('verse/chorus form: intro, verse + chorus ×' + pairs + ', outro');
  } else {
    let bars = progId ? prog(progId).bars : mode === 'minor' ? prog('minorpop').bars : style === 'country' || style === 'rock' ? prog('threechord').bars : prog('pop').bars;
    if (!progId) notes.push('no form given: ' + PROGRESSIONS.find((p) => p.bars === bars)!.name);
    if (Number.isFinite(barsWanted) && barsWanted !== bars.length && !/blues/.test(progId ?? '')) bars = fit(bars, barsWanted);
    const rep = Number.isFinite(times) ? times : progId && /blues/.test(progId) ? 3 : 2;
    const name = /blues/.test(progId ?? '') ? 'Chorus' : 'A';
    sections.push({ name, bars, repeat: Math.max(1, Math.min(16, rep)) });
  }
  if (/\b(intro)\b/.test(t) && !sections.some((s) => s.name === 'Intro')) sections.unshift({ name: 'Intro', bars: mode === 'minor' ? ['i', 'i', 'iv', 'V'] : ['I', 'I', 'IV', 'V'], repeat: 1 });
  if (/\b(ending|outro)\b/.test(t) && !sections.some((s) => s.name === 'Outro')) sections.push({ name: 'Outro', bars: [mode === 'minor' ? 'i' : 'I'], repeat: 1 });
  // ---- title
  const tm = /\b(?:called|titled|named)\s+["“']?([^"”'.,]+)["”']?/i.exec(text);
  const title = tm ? tm[1].trim() : `${key}${mode === 'minor' ? 'm' : ''} ${progId ? prog(progId).name.replace(/ \(.*\)/, '') : STYLES[style].name.replace(/ \(.*\)/, '')}`;
  return { title, key, mode, bpm, timeSig, feel, style, players, sections, notes };
}

/** Repeat / cut a progression to n bars. */
function fit(bars: string[], n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(bars[i % bars.length]);
  return out;
}

/** Checks a plan (from the parser, the user's edits or Claude) and fixes what it can. */
export function sanitizePlan(p: Partial<SongPlan>): SongPlan {
  const style: StyleId = STYLE_IDS.includes(p.style as StyleId) ? (p.style as StyleId) : 'rock';
  const k = parseKeyName((p.key ?? 'C') + (p.mode === 'minor' ? 'm' : '')) ? (p.key ?? 'C') : 'C';
  const ts: [number, number] = Array.isArray(p.timeSig) && p.timeSig[0] >= 1 && p.timeSig[0] <= 16 && [2, 4, 8, 16].includes(p.timeSig[1]) ? [Math.round(p.timeSig[0]), p.timeSig[1]] : [4, 4];
  const roles: BandRole[] = ['drums', 'bass', 'rhythm', 'lead'];
  const players = (p.players ?? []).filter((x) => roles.includes(x.role) && typeof x.instrumentId === 'string');
  const sections = (p.sections ?? []).filter((s) => Array.isArray(s.bars) && s.bars.length).map((s) => ({
    name: String(s.name || 'A').slice(0, 30), bars: s.bars.slice(0, 64).map(String), repeat: Math.max(1, Math.min(16, Math.round(Number(s.repeat) || 1))),
  }));
  return {
    title: String(p.title || 'New song').slice(0, 80), key: k, mode: p.mode === 'minor' ? 'minor' : 'major',
    bpm: Math.max(30, Math.min(300, Math.round(Number(p.bpm) || 120))), timeSig: ts,
    feel: p.feel === 'shuffle' || p.feel === 'swing' ? p.feel : 'straight', style,
    players: players.length ? players : [{ role: 'drums', instrumentId: 'drum-kit' }, { role: 'bass', instrumentId: STYLES[style].instruments.bass }, { role: 'rhythm', instrumentId: STYLES[style].instruments.rhythm }],
    sections: sections.length ? sections : [{ name: 'A', bars: ['I', 'IV', 'V', 'I'], repeat: 2 }],
    notes: Array.isArray(p.notes) ? p.notes.map(String) : [],
  };
}

const PCN: Record<string, number> = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };

/** The plan as a chord chart (Round 4 syntax). Roman numerals become chord names in the key. */
export function planToChart(p: SongPlan): string {
  const k: Key = { tonic: PCN[p.key] ?? 0, mode: p.mode };
  const chord = (roman: string) => {
    // Already a chord name (from an edited plan or Claude)? Keep it.
    if (/^[A-G]/.test(roman)) return roman;
    try { return romanToChord(roman, k) || roman; } catch { return roman; }
  };
  const lines = [`{key: ${p.key}${p.mode === 'minor' ? 'm' : ''}} {tempo: ${p.bpm}} {${p.timeSig[0]}/${p.timeSig[1]}}`];
  for (const s of p.sections) {
    const bars = s.bars.map((b) => b.split(/\s+/).filter(Boolean).map(chord).join(' '));
    const body = bars.join(' | ');
    lines.push(`[${s.name}]`);
    lines.push(s.repeat > 1 ? `|: ${body} :|${s.repeat > 2 ? ' x' + s.repeat : ''}` : `| ${body} |`);
  }
  return lines.join('\n');
}

export function planBars(p: SongPlan): number {
  return p.sections.reduce((a, s) => a + s.bars.length * s.repeat, 0);
}

/** JSON schema for the plan (Claude's structured output). */
export const SONG_PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'key', 'mode', 'bpm', 'timeSig', 'feel', 'style', 'players', 'sections', 'notes'],
  properties: {
    title: { type: 'string' },
    key: { type: 'string', enum: ['C', 'C#', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] },
    mode: { type: 'string', enum: ['major', 'minor'] },
    bpm: { type: 'integer' },
    timeSig: { type: 'array', items: { type: 'integer' } },
    feel: { type: 'string', enum: ['straight', 'shuffle', 'swing'] },
    style: { type: 'string', enum: ['rock', 'blues', 'country', 'jazz', 'pop'] },
    players: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['role', 'instrumentId'], properties: { role: { type: 'string', enum: ['drums', 'bass', 'rhythm', 'lead'] }, instrumentId: { type: 'string' } } },
    },
    sections: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['name', 'bars', 'repeat'], properties: { name: { type: 'string' }, bars: { type: 'array', items: { type: 'string' } }, repeat: { type: 'integer' } } },
    },
    notes: { type: 'array', items: { type: 'string' } },
  },
} as const;

/** Band players + swing for a plan (used with generateBand after chartToSong). */
export function planBand(p: SongPlan, base: BandSettings): { band: BandSettings; swing: number } {
  const band: BandSettings = {
    ...base,
    style: p.style,
    players: base.players.map((pl) => {
      const want = p.players.find((x) => x.role === pl.role);
      return want ? { ...pl, on: true, instrumentId: want.instrumentId } : { ...pl, on: false };
    }),
  };
  const swing = p.feel === 'shuffle' ? 1 : p.feel === 'swing' ? 0.66 : 0;
  return { band, swing };
}
