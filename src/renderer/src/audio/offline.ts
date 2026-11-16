// Offline rendering (export, Rocksmith audio, checks): the same synthesizer, split per channel,
// played through the same mixer graph (effects, sends, master, automation, audio clips) in an
// OfflineAudioContext. Never reaches the speakers; runs much faster than real time.
import * as alphaTab from '@coderline/alphatab';
import { defaultSongMix, laneValueAt, lanePoints, type Effect, type Song } from '../../../model';
import { applySwing } from '../../../render/swing';
import type { ScorePlayer } from '../player';
import { engine, splitByChannel, takeChannels } from './engine';
import { MixGraph } from './graph';
import { loadMedia, startClip } from './clips';
import { loadWorklets } from './worklet';

export const SAMPLE_RATE = 44100;

export interface Stem {
  id: string;
  name: string;
  /** Interleaved stereo. */
  samples: Float32Array;
}

export interface OfflineResult {
  /** Interleaved stereo mix (master). */
  samples: Float32Array;
  sampleRate: number;
  /** Song length as the synthesizer timed it (ms). */
  synthEndMs: number;
  renderMs: number;
  stems: Stem[];
}

export interface OfflineOptions {
  /** Track ids left out (as if muted). */
  exclude?: string[];
  /** Also render stems: one per track, and/or one per send bus. */
  stems?: { tracks: boolean; buses: boolean } | null;
  /** Extra time after the song end (reverb/delay tails). */
  tailMs?: number;
  sampleRate?: number;
  /** Skip the master bus effects (limiter) for the mix. */
  noMasterFx?: boolean;
}

interface SynthRender {
  frames: number;
  chans: Map<number, Float32Array>; // interleaved per channel
  timeline: { frame: number; playTick: number }[];
  endMs: number;
  msAtPlayTick: (tick: number) => number;
}

/** Synthesise the score's MIDI per channel. */
async function synthesise(player: ScorePlayer, song: Song, sr: number): Promise<SynthRender> {
  const score = player.api.score;
  const synth = engine.synth;
  if (!score || !synth) throw new Error('The player is not ready yet.');
  const midi = new alphaTab.midi.MidiFile();
  const handler = new alphaTab.midi.AlphaSynthMidiFileHandler(midi);
  const gen = new alphaTab.midi.MidiFileGenerator(score, player.api.settings, handler);
  gen.applyTranspositionPitches = false;
  gen.generate();
  applySwing(midi as unknown as Parameters<typeof applySwing>[0], song.playback?.swing ?? 0);
  player.filterAudioTracks(midi);
  const opts = new alphaTab.synth.AudioExportOptions();
  opts.sampleRate = sr;
  opts.masterVolume = 1;
  opts.metronomeVolume = 0;
  opts.useSyncPoints = false;
  const exporter = synth.exportAudio(opts, midi, [], gen.transpositionPitches) as unknown as {
    _synth: unknown; _sequencer: { mainTickPositionToTimePosition(t: number): number };
    render(ms: number): { samples: Float32Array; currentTick: number; endTime: number } | undefined;
  };
  splitByChannel(exporter._synth);
  const parts = new Map<number, { at: number; data: Float32Array }[]>();
  const timeline: { frame: number; playTick: number }[] = [{ frame: 0, playTick: 0 }];
  let frames = 0;
  let endMs = 0;
  let lastYield = performance.now();
  // Small chunks give the automation timeline its resolution; without automation, bigger is faster.
  const chunkMs = song.tracks.some((t) => t.automation?.some((l) => l.points.length)) ? 50 : 500;
  for (;;) {
    const c = exporter.render(chunkMs);
    if (!c) break;
    const n = c.samples.length / 2;
    for (const [ch, buf] of takeChannels(exporter._synth, c.samples)) {
      let list = parts.get(ch);
      if (!list) parts.set(ch, (list = []));
      list.push({ at: frames, data: buf.slice() });
    }
    frames += n;
    timeline.push({ frame: frames, playTick: c.currentTick });
    endMs = c.endTime;
    if (performance.now() - lastYield > 200) {
      await new Promise((r) => setTimeout(r, 0));
      lastYield = performance.now();
    }
  }
  const chans = new Map<number, Float32Array>();
  for (const [ch, list] of parts) {
    const all = new Float32Array(frames * 2);
    for (const p of list) all.set(p.data, p.at * 2);
    chans.set(ch, all);
  }
  return { frames, chans, timeline, endMs, msAtPlayTick: (t) => exporter._sequencer.mainTickPositionToTimePosition(t) };
}

function toBuffer(ctx: BaseAudioContext, inter: Float32Array, frames: number): AudioBuffer {
  const b = ctx.createBuffer(2, Math.max(1, frames), ctx.sampleRate);
  const L = new Float32Array(frames);
  const R = new Float32Array(frames);
  for (let i = 0; i < frames; i++) { L[i] = inter[2 * i]; R[i] = inter[2 * i + 1]; }
  b.copyToChannel(L, 0);
  b.copyToChannel(R, 1);
  return b;
}

function interleave(buf: AudioBuffer, ch0: number, frames: number): Float32Array {
  const L = buf.getChannelData(ch0);
  const R = buf.getChannelData(ch0 + 1);
  const out = new Float32Array(frames * 2);
  for (let i = 0; i < frames; i++) { out[2 * i] = L[i]; out[2 * i + 1] = R[i]; }
  return out;
}

/** Build the graph in `ctx` and feed it the synthesised channels, clips and automation. */
async function feed(ctx: BaseAudioContext, dest: AudioNode, player: ScorePlayer, song: Song, sr: SynthRender, noMasterFx: boolean): Promise<MixGraph> {
  await loadWorklets(ctx);
  const mixSong = noMasterFx ? { ...song, mix: { ...(song.mix ?? defaultSongMix()), master: { volume: song.mix?.master.volume ?? 0.8, fx: [] } } } : song;
  const graph = new MixGraph(ctx, dest, { bpm: () => song.tempos[0]?.bpm ?? 120 });
  graph.sync(mixSong);
  // Synth channels -> the strips of the tracks that own them.
  const score = player.api.score!;
  const owner = new Map<number, string>();
  score.tracks.forEach((at, i) => {
    const t = song.tracks[i];
    if (!t || t.audio) return;
    for (const ch of [at.playbackInfo.primaryChannel, at.playbackInfo.secondaryChannel]) if (!owner.has(ch)) owner.set(ch, t.id);
  });
  for (const [ch, data] of sr.chans) {
    if (ch === 16) continue; // metronome is never exported
    const src = ctx.createBufferSource();
    src.buffer = toBuffer(ctx, data, sr.frames);
    const id = owner.get(ch);
    src.connect(id ? graph.strip(id)!.input : graph.masterIn);
    src.start(0);
  }
  const rate = ctx.sampleRate;
  // Automation: one ramp point per rendered chunk, following the playback timeline (repeats too).
  for (const t of song.tracks) {
    for (const lane of t.automation ?? []) {
      if (!lane.points.length) continue;
      const target = graph.automationTarget(t.id, lane.param);
      if (!target) continue;
      const pts = lanePoints(song, lane);
      sr.timeline.forEach((p, i) => {
        const v = laneValueAt(pts, player.modelTick(p.playTick));
        if (v !== undefined) target(v, p.frame / rate, i === 0 ? 'set' : 'ramp');
      });
    }
  }
  // Audio clips at every playback occurrence of their bar.
  for (const t of song.tracks) {
    if (!t.audio) continue;
    const strip = graph.strip(t.id);
    if (!strip) continue;
    for (const c of t.audio.clips) {
      let buf: AudioBuffer;
      try { buf = await loadMedia(engine.ctx, c.file); } catch { continue; }
      for (const occ of player.occurrences(c.bar)) startClip(ctx, buf, c, strip.input, sr.msAtPlayTick(occ + c.tick) / 1000, 0);
    }
  }
  return graph;
}

/** Render the song (and optionally stems) offline through the mixer. */
export async function renderSong(player: ScorePlayer, song: Song, opts: OfflineOptions = {}): Promise<OfflineResult> {
  const t0 = performance.now();
  const rate = opts.sampleRate ?? SAMPLE_RATE;
  const exclude = new Set(opts.exclude ?? []);
  const s: Song = exclude.size ? { ...song, tracks: song.tracks.map((t) => (exclude.has(t.id) ? { ...t, mixer: { ...t.mixer, mute: true, solo: false } } : t)) } : song;
  const sr = await synthesise(player, s, rate);
  const endFrames = Math.max(sr.frames, Math.round((sr.endMs / 1000) * rate));
  const frames = endFrames + Math.round(((opts.tailMs ?? 0) / 1000) * rate);

  const mixCtx = new OfflineAudioContext(2, Math.max(1, frames), rate);
  await feed(mixCtx, mixCtx.destination, player, s, sr, !!opts.noMasterFx);
  const mixBuf = await mixCtx.startRendering();
  const samples = interleave(mixBuf, 0, frames);

  const stems: Stem[] = [];
  if (opts.stems && (opts.stems.tracks || opts.stems.buses)) {
    const anySolo = s.tracks.some((t) => t.mixer.solo);
    const list: { id: string; name: string }[] = [];
    if (opts.stems.tracks) for (const t of s.tracks) if (!t.mixer.mute && (!anySolo || t.mixer.solo)) list.push({ id: t.id, name: t.name });
    if (opts.stems.buses) list.push({ id: 'bus:reverb', name: 'Reverb bus' }, { id: 'bus:delay', name: 'Delay bus' });
    for (let i = 0; i < list.length; i += 15) {
      const group = list.slice(i, i + 15);
      const ctx = new OfflineAudioContext(group.length * 2, Math.max(1, frames), rate);
      const sink = ctx.createGain();
      const graph = await feed(ctx, sink, player, s, sr, true);
      const merger = ctx.createChannelMerger(group.length * 2);
      group.forEach((g, k) => {
        const node = g.id === 'bus:reverb' ? graph.reverb.vol : g.id === 'bus:delay' ? graph.delay.vol : graph.strip(g.id)!.out;
        const split = ctx.createChannelSplitter(2);
        node.connect(split);
        split.connect(merger, 0, 2 * k);
        split.connect(merger, 1, 2 * k + 1);
      });
      merger.connect(ctx.destination);
      const out = await ctx.startRendering();
      group.forEach((g, k) => stems.push({ ...g, samples: interleave(out, 2 * k, frames) }));
    }
  }
  return { samples, sampleRate: rate, synthEndMs: sr.endMs, renderMs: Math.round(performance.now() - t0), stems };
}

/** Render a test signal through one effect chain (effect checks). Returns interleaved stereo. */
export async function renderThroughFx(input: Float32Array, rate: number, fx: Effect[], bpm = 120): Promise<Float32Array> {
  const frames = input.length / 2;
  const ctx = new OfflineAudioContext(2, frames, rate);
  await loadWorklets(ctx);
  const song = { tracks: [{ id: 'x', mixer: { volume: 0.8, pan: 0, mute: false, solo: false, fx } }], tempos: [{ bar: 0, tick: 0, bpm }], mix: { master: { volume: 0.8, fx: [] }, reverb: { volume: 0, mute: true, fx: { id: 'r', type: 'reverb', params: { type: 0, decay: 1, predelay: 0, mix: 1 } } }, delay: { volume: 0, mute: true, fx: { id: 'd', type: 'delay', params: { note: 1, feedback: 0, mix: 1, tone: 5000 } } } } } as unknown as Song;
  const graph = new MixGraph(ctx, ctx.destination, { bpm: () => bpm });
  graph.sync(song);
  const src = ctx.createBufferSource();
  src.buffer = toBuffer(ctx, input, frames);
  src.connect(graph.strip('x')!.input);
  src.start(0);
  const out = await ctx.startRendering();
  return interleave(out, 0, frames);
}
