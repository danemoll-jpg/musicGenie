// Round 6: DSP helpers (FFT, resample, pitch), Demucs STFT/overlap-add, basic-pitch decoding,
// beats -> bars/tempo map, beat-marker edits (audio never moves), drum scoring, WAV I/O.
import { describe, expect, it } from 'vitest';
import { RealFft, resample, beatThisFeatures } from '../../src/ml/dsp';
import { separate, type DemucsConfig } from '../../src/ml/demucs';
import { bpNotes, frameTime } from '../../src/ml/basicPitch';
import { pickBeats } from '../../src/ml/beats';
import { fScore, transcribeDrums } from '../../src/ml/drums';
import { estimatePitch } from '../../src/ml/pitch';
import { readWav, writeWav16 } from '../../src/ml/wav';
import {
  addAudioTrack, addClip, beatsInRecording, clipStartMs, emptySong, fitTempos, gridFromDetection, gridFromSong, moveBeat, newSong,
  rebar, setDownbeat, songGridFromBeats, tapTempo, tempoPoints, msAtTick, barStartTicks, type AudioClip, type Song,
} from '../../src/model';

const sine = (f: number, sr: number, n: number, a = 0.5) => Float32Array.from({ length: n }, (_, i) => a * Math.sin((2 * Math.PI * f * i) / sr));

describe('DSP helpers', () => {
  it('real FFT matches a direct DFT and inverts', () => {
    const n = 64;
    const x = Float64Array.from({ length: n }, (_, i) => Math.sin(i * 0.37) + 0.3 * Math.cos(i * 1.9) + (i % 5) * 0.1);
    const fft = new RealFft(n);
    const re = new Float64Array(n / 2 + 1), im = new Float64Array(n / 2 + 1);
    fft.forward(x, re, im);
    for (let k = 0; k <= n / 2; k++) {
      let r = 0, j = 0;
      for (let t = 0; t < n; t++) { r += x[t] * Math.cos((-2 * Math.PI * k * t) / n); j += x[t] * Math.sin((-2 * Math.PI * k * t) / n); }
      expect(re[k]).toBeCloseTo(r, 8);
      expect(im[k]).toBeCloseTo(j, 8);
    }
    const back = new Float64Array(n);
    fft.inverse(re, im, back);
    for (let t = 0; t < n; t++) expect(back[t]).toBeCloseTo(x[t], 9);
  });
  it('resampling keeps the pitch; pitch estimate is accurate', () => {
    const x = sine(440, 44100, 44100);
    const y = resample(x, 44100, 22050);
    expect(y.length).toBe(22050);
    expect(estimatePitch(y.subarray(2000, 6000), 22050)).toBeCloseTo(440, 0);
    expect(estimatePitch(sine(110, 48000, 9600), 48000)).toBeCloseTo(110, 0);
    // Non-integer ratio (48 kHz -> 22.05 kHz): finite, same pitch, same level.
    const z = resample(sine(440, 48000, 48000), 48000, 22050);
    expect(z.every((v) => Number.isFinite(v))).toBe(true);
    expect(estimatePitch(z.subarray(2000, 6000), 22050)).toBeCloseTo(440, 0);
    expect(Math.max(...z.subarray(1000, 20000))).toBeCloseTo(0.5, 2);
  });
  it('Beat This! features: 50 frames per second, 128 bands', () => {
    const f = beatThisFeatures(sine(220, 22050, 22050));
    expect(f.frames).toBe(51);
    expect(f.data.length).toBe(51 * 128);
    expect(Math.max(...f.data)).toBeGreaterThan(1);
  });
  it('WAV write/read round trip', () => {
    const L = sine(300, 8000, 800), R = sine(500, 8000, 800, 0.2);
    const back = readWav(writeWav16({ sampleRate: 8000, channels: [L, R] }));
    expect(back.sampleRate).toBe(8000);
    expect(back.channels[1][123]).toBeCloseTo(R[123], 3);
  });
});

describe('Demucs host code', () => {
  it('identity network: every stem equals the mix (STFT, ISTFT and overlap-add invert exactly)', async () => {
    const cfg: DemucsConfig = { name: 't', sources: ['a', 'b'], samplerate: 8000, audio_channels: 2, segment_samples: 1000, nfft: 64, hop: 16, freq_bins: 32, frames: 63 };
    const n = 2600;
    const mix = new Float32Array(2 * n);
    for (let i = 0; i < n; i++) { mix[i] = Math.sin(i * 0.05) * 0.4 + 0.1; mix[n + i] = Math.cos(i * 0.031) * 0.3; }
    const out = await separate(cfg, async (m, mag, b) => {
      // spec: each source gets the input spectrogram at half; wav branch gives the other half.
      const item = 4 * cfg.freq_bins * cfg.frames;
      const spec = new Float32Array(b * 2 * item);
      const wav = new Float32Array(b * 2 * 2 * cfg.segment_samples);
      for (let k = 0; k < b; k++) for (let s = 0; s < 2; s++) {
        for (let i = 0; i < item; i++) spec[(k * 2 + s) * item + i] = mag[k * item + i] * 0.5;
        for (let i = 0; i < 2 * cfg.segment_samples; i++) wav[(k * 2 + s) * 2 * cfg.segment_samples + i] = m[k * 2 * cfg.segment_samples + i] * 0.5;
      }
      return { spec, wav };
    }, mix, n, 2);
    // Demucs' spectrogram drops the Nyquist bin and two edge frames, so only the interior is exact.
    let err = 0;
    for (const o of out) for (let c = 0; c < 2; c++) for (let i = 64; i < n - 64; i++) err = Math.max(err, Math.abs(o[c * n + i] - mix[c * n + i]));
    expect(err).toBeLessThan(5e-3);
  });
});

describe('basic-pitch note decoding', () => {
  it('turns onset + frame activations into notes', () => {
    const frames = 300;
    const note = new Float32Array(frames * 88), onset = new Float32Array(frames * 88);
    const put = (p: number, a: number, b: number) => {
      for (let t = a; t < b; t++) note[t * 88 + p - 21] = 0.8;
      onset[a * 88 + p - 21] = 0.9;
    };
    put(40, 10, 60);
    put(52, 80, 140);
    put(45, 100, 200);
    const ev = bpNotes({ frames, note, onset }, { onsetShiftS: 0 });
    expect(ev.map((e) => e.pitch)).toEqual([40, 52, 45]);
    expect(ev[0].startS).toBeCloseTo(frameTime(10), 6);
    // Default: onsets 25 ms earlier (basic-pitch's measured lag).
    expect(bpNotes({ frames, note, onset })[0].startS).toBeCloseTo(frameTime(10) - 0.025, 6);
    expect(ev[1].endS).toBeCloseTo(frameTime(140), 6);
    // Pitch range limit drops notes outside it.
    expect(bpNotes({ frames, note, onset }, { maxPitch: 50 }).map((e) => e.pitch)).toEqual([40, 45]);
    // A re-attack without an onset peak continues the note before it.
    const n2 = new Float32Array(note), o2 = new Float32Array(onset);
    for (let t = 210; t < 280; t++) n2[t * 88 + 60 - 21] = 0.8;
    o2[210 * 88 + 60 - 21] = 0.9;
    for (let t = 280; t < 290; t++) n2[t * 88 + 60 - 21] = 0.8; // continuous
    n2[248 * 88 + 60 - 21] = 0.25; // a one-frame wobble -> inferred onset at 249
    const ev2 = bpNotes({ frames, note: n2, onset: o2 }).filter((e) => e.pitch === 60);
    expect(ev2.length).toBe(1);
  });
  it('beat peak picking merges neighbours and snaps downbeats to beats', () => {
    const b = new Float32Array(200).fill(-5), d = new Float32Array(200).fill(-5);
    for (const f of [10, 35, 60, 85, 110]) b[f] = 3;
    b[61] = 3; // a flat-topped peak -> one beat at 60.5
    d[11] = 2;
    d[111] = 2;
    const r = pickBeats(b, d);
    expect(r.beats.map((t) => +(t * 50).toFixed(1))).toEqual([10, 35, 60.5, 85, 110]);
    expect(r.downbeats.map((t) => +(t * 50).toFixed(1))).toEqual([10, 110]);
  });
});

/** Beats every `iv` s from `t0`, with downbeats every `n` beats starting at beat `first`. */
function beatsAt(t0: number, iv: number, count: number, n = 4, first = 0) {
  const beats = Array.from({ length: count }, (_, i) => t0 + i * iv);
  return { beats, downbeats: beats.filter((_, i) => i >= first && (i - first) % n === 0) };
}

function recordingSong(lengthMs = 30000): { song: Song; clip: AudioClip } {
  const s0 = emptySong('Rec');
  s0.bars = [{ timeSignature: { numerator: 4, denominator: 4 }, key: { fifths: 0, mode: 'major' } }];
  const r = addAudioTrack(s0, 'Recording');
  const clip: AudioClip = { id: 'rec', name: 'r.wav', file: 'C:\\r.wav', bar: 0, tick: 0, startMs: 0, lengthMs, sourceMs: lengthMs, fadeInMs: 0, fadeOutMs: 0, gainDb: 0 };
  return { song: addClip(r.song, r.id, clip), clip };
}

describe('beats -> bars and tempo map', () => {
  it('steady 120 bpm with a pickup: one tempo, bars on the downbeats, recording keeps its time', () => {
    const { song, clip } = recordingSong();
    const { beats, downbeats } = beatsAt(0.75, 0.5, 40, 4, 2); // 2 pickup beats
    const out = songGridFromBeats(song, clip, beats, downbeats);
    expect(out.tempos.length).toBe(1);
    expect(out.tempos[0].bpm).toBeCloseTo(120, 2);
    expect(out.bars.every((b) => b.timeSignature.numerator === 4)).toBe(true);
    // Every detected beat is on the grid (in recording time) within 1 ms; downbeats are bar starts.
    const c = out.tracks[0].audio!.clips[0];
    const grid = beatsInRecording(out, c);
    for (const t of beats) expect(Math.min(...grid.map((g) => Math.abs(g.t - t)))).toBeLessThan(0.001);
    for (const d of downbeats) expect(grid.find((g) => Math.abs(g.t - d) < 0.001)?.beat).toBe(0);
    // The recording starts at song time >= 0 (nothing cut).
    expect(clipStartMs(out, c)).toBeGreaterThanOrEqual(0);
    expect(c.startMs).toBe(0);
  });
  it('tempo change: two tempos, beats within 10 ms', () => {
    const { song, clip } = recordingSong(60000);
    const a = beatsAt(0.2, 0.6, 32);
    const t1 = a.beats[31] + 0.6;
    const b = beatsAt(t1, 60 / 130, 32);
    const beats = [...a.beats, ...b.beats];
    const out = songGridFromBeats(song, clip, beats, beats.filter((_, i) => i % 4 === 0));
    expect(out.tempos.map((t) => Math.round(t.bpm))).toEqual([100, 130]);
    const grid = beatsInRecording(out, out.tracks[0].audio!.clips[0]);
    for (const t of beats) expect(Math.min(...grid.map((g) => Math.abs(g.t - t)))).toBeLessThan(0.01);
  });
  it('a 3/4 section becomes 3/4 bars', () => {
    const { song, clip } = recordingSong(60000);
    const beats = Array.from({ length: 4 * 4 + 3 * 4 + 4 * 4 }, (_, i) => i * 0.5);
    const downbeats = [0, 4, 8, 12, 16, 19, 22, 25, 28, 32, 36, 40].map((i) => beats[i]);
    const out = songGridFromBeats(song, clip, beats, downbeats);
    expect(out.bars.map((b) => b.timeSignature.numerator)).toEqual([4, 4, 4, 4, 3, 3, 3, 3, 4, 4, 4, 4]);
  });
  it('fits one tempo to slightly jittery beats', () => {
    const beats = Array.from({ length: 50 }, (_, i) => 1000 + i * 500 + (i % 3) * 3 - 3);
    expect(fitTempos(beats, 8).length).toBe(1);
  });
  it('downbeat detection that is missing everywhere: forced numerator', () => {
    const g = gridFromDetection(beatsAt(0, 0.5, 13).beats, [], { numerator: 3 });
    expect(g.numerator).toBe(3);
    expect(g.barStarts.slice(0, 3)).toEqual([0, 3, 6]);
  });
});

describe('beat-marker edits (audio clips never move)', () => {
  const made = () => {
    const { song, clip } = recordingSong(40000);
    const { beats, downbeats } = beatsAt(0.5, 0.5, 48);
    const s = songGridFromBeats(song, clip, beats, downbeats);
    // A note track with a note on bar 3 beat 1.
    const t = newSong('bass', s.bars.length).tracks[0];
    t.id = 'bass';
    s.tracks.push(t);
    return s;
  };
  const clipMs = (s: Song) => clipStartMs(s, s.tracks[0].audio!.clips[0]) - s.tracks[0].audio!.clips[0].startMs;
  it('drag a beat: tempo changes around it, the recording stays put', () => {
    const s = made();
    const before = clipMs(s);
    const g = gridFromSong(s);
    const k = g.barStarts[3] + 2;
    const s2 = moveBeat(s, 3, 2, g.beats[k] + 60);
    expect(gridFromSong(s2).beats[k]).toBeCloseTo(g.beats[k] + 60, 0);
    expect(gridFromSong(s2).beats[g.barStarts[4]]).toBeCloseTo(g.beats[g.barStarts[4]], 0);
    expect(clipMs(s2)).toBeCloseTo(before, 0);
    expect(s2.bars.length).toBe(s.bars.length);
  });
  it('set the downbeat: the bar is cut short, the recording stays put', () => {
    const s = made();
    const before = clipMs(s);
    const s2 = setDownbeat(s, 2, 1);
    expect(s2.bars[2].timeSignature.numerator).toBe(1);
    expect(clipMs(s2)).toBeCloseTo(before, 0);
  });
  it('tap tempo over a section sets its beat length', () => {
    const s = made();
    const g = gridFromSong(s);
    const at = g.beats[g.barStarts[2]];
    const taps = [0, 1, 2, 3, 4, 5].map((i) => at + 3 + i * 480);
    const s2 = tapTempo(s, 2, 4, taps);
    const g2 = gridFromSong(s2);
    expect(g2.beats[g2.barStarts[2] + 1] - g2.beats[g2.barStarts[2]]).toBeCloseTo(480, 0);
    expect(clipMs(s2)).toBeCloseTo(clipMs(s), 0);
  });
  it('re-bar in 3/4 keeps beat times', () => {
    const s = made();
    const g = gridFromSong(s);
    const s2 = rebar(s, 2, 3, 6);
    const g2 = gridFromSong(s2);
    expect(s2.bars[2].timeSignature.numerator).toBe(3);
    expect(g2.beats[g.barStarts[2] + 5]).toBeCloseTo(g.beats[g.barStarts[2] + 5], 0);
    const pts = tempoPoints(s2);
    expect(msAtTick(pts, barStartTicks(s2)[1])).toBeGreaterThan(0);
  });
});

describe('drums', () => {
  it('F-score matching with a tolerance', () => {
    const ref = [{ t: 1 }, { t: 2 }, { t: 3 }];
    const est = [{ t: 1.02 }, { t: 2.2 }, { t: 3 }];
    const r = fScore(ref, est, 0.05);
    expect(r.tp).toBe(2);
    expect(r.f).toBeCloseTo(2 / 3, 6);
  });
  it('a synthetic kick (low thump) and hi-hat (high noise) are told apart', () => {
    const sr = 44100;
    const x = new Float32Array(sr * 3);
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    const kickAt = [0.25, 1.25, 2.25], hatAt = [0.75, 1.75, 2.75];
    for (const t of kickAt) for (let i = 0; i < sr * 0.45; i++) {
      const f = 50 + 30 * Math.exp(-i / (sr * 0.01));
      x[Math.floor(t * sr) + i] += 0.9 * Math.exp(-i / (sr * 0.08)) * Math.sin((2 * Math.PI * f * i) / sr);
    }
    // High-passed noise for the hat.
    for (const t of hatAt) {
      let p1 = 0, p2 = 0;
      for (let i = 0; i < sr * 0.08; i++) {
        const n = rnd();
        x[Math.floor(t * sr) + i] += 0.3 * Math.exp(-i / (sr * 0.012)) * (n - 2 * p1 + p2);
        p2 = p1;
        p1 = n;
      }
    }
    const dbg = { onsets: [], thr: [] } as unknown as import('../../src/ml/drums').DrumDebug;
    const hits = transcribeDrums(x, sr, dbg);
    if (process.env.DRUMDBG) console.log(JSON.stringify({ hits, dbg }));
    const kicks = hits.filter((h) => h.piece === 'kick').map((h) => h.t);
    const hats = hits.filter((h) => h.piece === 'hhClosed' || h.piece === 'hhOpen').map((h) => h.t);
    expect(fScore(kickAt.map((t) => ({ t })), kicks.map((t) => ({ t })), 0.05).f).toBe(1);
    expect(fScore(hatAt.map((t) => ({ t })), hats.map((t) => ({ t })), 0.05).f).toBe(1);
  });
});
