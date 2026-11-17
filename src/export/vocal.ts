// Round 7: a melody + lyrics for outside singing synthesizers: OpenUtau (.ustx) and Synthesizer V
// (.svp). Both start at bar 1 = time 0, so a WAV rendered from them lines up when imported back at bar 1.
import { barStartTicks, lyricEvents, PPQ, type Song, type Track } from '../model';

const yq = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** OpenUtau project (YAML, 480 ticks per quarter), one voice part with every syllable as a note. */
export function exportUstx(song: Song, track: Track, verse = 0): string {
  const k = 480 / PPQ;
  const starts = barStartTicks(song);
  const tempoTick = (bar: number, tick: number) => Math.round(((starts[bar] ?? 0) + tick) * k);
  const ev = lyricEvents(song, track, verse);
  const notes: string[] = [];
  for (const e of ev) {
    e.notes.forEach((n, i) => {
      const lyric = i === 0 ? e.text : '+~'; // "+~" = hold the previous syllable (OpenUtau melisma)
      notes.push([
        `  - position: ${Math.round(n.tick * k)}`,
        `    duration: ${Math.max(1, Math.round(n.dur * k))}`,
        `    tone: ${n.pitch}`,
        `    lyric: ${yq(lyric)}`,
        '    pitch: {data: [{x: -25, y: 0, shape: io}, {x: 25, y: 0, shape: io}], snap_first: true}',
        '    vibrato: {length: 0, period: 175, depth: 25, in: 10, out: 10, shift: 0, drift: 0}',
      ].join('\n'));
    });
  }
  const end = ev.length ? Math.round((ev[ev.length - 1].tick + ev[ev.length - 1].dur) * k) : 1920;
  const sigs: string[] = [];
  song.bars.forEach((b, i) => {
    const p = song.bars[i - 1];
    if (i === 0 || p.timeSignature.numerator !== b.timeSignature.numerator || p.timeSignature.denominator !== b.timeSignature.denominator) {
      sigs.push(`- {bar_position: ${i}, beat_per_bar: ${b.timeSignature.numerator}, beat_unit: ${b.timeSignature.denominator}}`);
    }
  });
  return [
    `name: ${yq(song.title || 'Song')}`,
    'ustx_version: "0.10"',
    'resolution: 480',
    'bpm: ' + (song.tempos[0]?.bpm ?? 120),
    'beat_per_bar: ' + (song.bars[0]?.timeSignature.numerator ?? 4),
    'beat_unit: ' + (song.bars[0]?.timeSignature.denominator ?? 4),
    'time_signatures:',
    ...sigs,
    'tempos:',
    ...song.tempos.map((t) => `- {position: ${tempoTick(t.bar, t.tick)}, bpm: ${t.bpm}}`),
    'tracks:',
    '- phonemizer: OpenUtau.Core.DiffSinger.DiffSingerEnglishPhonemizer',
    '  renderer_settings: {renderer: DIFFSINGER}',
    `  track_name: ${yq(track.name)}`,
    'voice_parts:',
    `- name: ${yq(track.name)}`,
    '  track_no: 0',
    '  position: 0',
    `  duration: ${end}`,
    '  notes:',
    ...notes,
    'wave_parts: []',
    '',
  ].join('\n');
}

/** Synthesizer V Studio project (JSON; 705 600 000 blicks per quarter note), one track. */
export function exportSvp(song: Song, track: Track, verse = 0): string {
  const BLICK = 705600000;
  const starts = barStartTicks(song);
  const b = (tick: number) => Math.round((tick / PPQ) * BLICK);
  const notes = lyricEvents(song, track, verse).flatMap((e) => e.notes.map((n, i) => ({
    onset: b(n.tick), duration: b(n.dur), lyrics: i === 0 ? e.text : '-', phonemes: '', pitch: n.pitch,
    detune: 0, attributes: {},
  })));
  const meter: { index: number; numerator: number; denominator: number }[] = [];
  song.bars.forEach((bar, i) => {
    const p = song.bars[i - 1];
    if (i === 0 || p.timeSignature.numerator !== bar.timeSignature.numerator || p.timeSignature.denominator !== bar.timeSignature.denominator) {
      meter.push({ index: i, numerator: bar.timeSignature.numerator, denominator: bar.timeSignature.denominator });
    }
  });
  const group = 'a0000000-0000-4000-8000-000000000001';
  return JSON.stringify({
    version: 153,
    time: { meter, tempo: song.tempos.map((t) => ({ position: b((starts[t.bar] ?? 0) + t.tick), bpm: t.bpm })) },
    library: [],
    tracks: [{
      name: track.name, dispColor: 'ff7db235', dispOrder: 0, renderEnabled: false,
      mixer: { gainDecibel: 0, pan: 0, mute: false, solo: false, display: true },
      mainGroup: { name: 'main', uuid: group, parameters: {}, vocalModes: {}, notes },
      mainRef: { groupID: group, blickOffset: 0, pitchOffset: 0, isInstrumental: false, database: { name: '', language: 'english', phoneset: 'arpabet' }, dictionary: '', voice: {} },
      groups: [],
    }],
    renderConfig: { destination: '', filename: track.name, numChannels: 1, aspirationFormat: 'noAspiration', bitDepth: 16, sampleRate: 44100, exportMixDown: true },
  }, null, 1);
}
