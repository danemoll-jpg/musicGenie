// Round 6, item 6: review and fix view. The score goes to one long row; above it, the recording
// (or a stem) as a waveform or spectrogram, drawn bar by bar from the score's own bar positions
// so they line up. Beat lines can be dragged (moveBeat), double-clicked (make it beat 1),
// tapped (tap tempo over the selected bars) or re-barred. A/B: original / stem / transcription /
// stem + transcription; speed 25-100 % keeps the pitch (the audio element time-stretches).
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  barStartTicks, clipStartMs, gridFromSong, moveBeat, msAtTick, posToMs, rebar, setDownbeat, tapTempo, tempoPoints, PPQ, type AudioClip, type Song, type Track,
} from '../../model';
import { downmix, magSpectrogram, resample } from '../../ml/dsp';
import { BackingPlayer } from './audio/backing';
import { engine } from './audio/engine';
import { loadMedia } from './audio/clips';
import type { ScorePlayer, PlayerStatus } from './player';
import type { AppState, Store } from './store';

export type ReviewSource = 'original' | 'stem' | 'tx' | 'stemtx';
export interface ReviewState {
  on: boolean;
  source: ReviewSource;
  stemId: string | null;
  txId: string | null;
  spectrogram: boolean;
}

class ReviewCtl {
  state: ReviewState = { on: false, source: 'original', stemId: null, txId: null, spectrogram: false };
  audio: BackingPlayer | null = null;
  private ls = new Set<() => void>();
  on(f: () => void) {
    this.ls.add(f);
    return () => this.ls.delete(f);
  }
  set(p: Partial<ReviewState>) {
    this.state = { ...this.state, ...p };
    this.ls.forEach((f) => f());
  }
}
export const reviewCtl = new ReviewCtl();
export function useReview() {
  return useSyncExternalStore((f) => reviewCtl.on(f), () => reviewCtl.state);
}

const clipOf = (t: Track | undefined): AudioClip | null => t?.audio?.clips[0] ?? null;

/** Which audio file plays, and which tracks are heard, for a source choice. */
export function reviewRouting(song: Song, r: ReviewState): { file: AudioClip | null; listen: string[] } {
  const rec = song.recording ? song.tracks.find((t) => t.id === song.recording!.trackId) : song.tracks.find((t) => t.audio && !t.analysis);
  const stem = song.tracks.find((t) => t.id === r.stemId);
  const tx = song.tracks.find((t) => t.id === r.txId);
  switch (r.source) {
    case 'original': return { file: clipOf(rec), listen: [] };
    case 'stem': return { file: clipOf(stem), listen: [] };
    case 'tx': return { file: null, listen: tx ? [tx.id] : [] };
    case 'stemtx': return { file: clipOf(stem), listen: tx ? [tx.id] : [] };
  }
}

interface BarBox { x: number; w: number; ms0: number; ms1: number }

/** Bar boxes (score pixels) from alphaTab's layout. */
function barBoxes(player: ScorePlayer, song: Song): BarBox[] {
  const lookup = player.api.boundsLookup;
  if (!lookup) return [];
  const out: BarBox[] = [];
  for (let b = 0; b < song.bars.length; b++) {
    const mb = lookup.findMasterBarByIndex(b);
    if (!mb) continue;
    const r = mb.realBounds;
    out.push({ x: r.x, w: r.w, ms0: posToMs(song, b, 0), ms1: b + 1 < song.bars.length ? posToMs(song, b + 1, 0) : posToMs(song, b, barStartTicks(song)[1] ?? PPQ * 4) });
  }
  return out;
}

const H = 110;

export function ReviewView({ state, store, player, status }: { state: AppState; store: Store; player: ScorePlayer | null; status: PlayerStatus | null }) {
  const r = useReview();
  const song = state.song;
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const wrap = useRef<HTMLDivElement | null>(null);
  const [boxes, setBoxes] = useState<BarBox[]>([]);
  const [buf, setBuf] = useState<AudioBuffer | null>(null);
  const [taps, setTaps] = useState<number[]>([]);
  const [drag, setDrag] = useState<{ bar: number; beat: number; x: number } | null>(null);
  const [perBar, setPerBar] = useState(3);
  const routing = useMemo(() => (song ? reviewRouting(song, r) : { file: null, listen: [] }), [song, r]);
  const shown = routing.file ?? (song ? reviewRouting(song, { ...r, source: 'original' }).file : null);

  // Layout + listening while on.
  useEffect(() => {
    if (!player) return;
    player.setHorizontal(r.on);
    // A click on a note plays a short snippet from there, against the chosen audio.
    player.clickPlayMs = r.on ? 2500 : null;
    if (!r.on) {
      engine.setListenOnly(null);
      void reviewCtl.audio?.setTrack(song, null);
    }
  }, [r.on, player]);
  useEffect(() => {
    if (!player || !song || !r.on) return;
    reviewCtl.audio ??= new BackingPlayer(player);
    engine.setListenOnly(routing.listen);
    const f = routing.file;
    const C = f ? clipStartMs(song, f) : 0;
    void reviewCtl.audio.setTrack(song, f ? { name: f.name, path: f.file, offsetMs: f.startMs - C, volume: 1, mute: false } : null);
    reviewCtl.audio.setSpeed(state.practice.speed);
  }, [r.on, song, routing, player]);
  useEffect(() => reviewCtl.audio?.setSpeed(state.practice.speed), [state.practice.speed]);

  // Decode the shown audio.
  useEffect(() => {
    if (!r.on || !shown) { setBuf(null); return; }
    let live = true;
    void loadMedia(engine.ctx, shown.file).then((b) => live && setBuf(b)).catch(() => live && setBuf(null));
    return () => { live = false; };
  }, [r.on, shown?.file]);

  // Bar positions after every render.
  useEffect(() => {
    if (!player || !song || !r.on) return;
    setBoxes(barBoxes(player, song));
  }, [player, song, r.on, status?.renderCount]);

  // Keep the strip scrolled with the score.
  useEffect(() => {
    const sc = document.querySelector('.score') as HTMLElement | null;
    if (!sc || !r.on) return;
    const f = () => { if (wrap.current) wrap.current.scrollLeft = sc.scrollLeft; };
    sc.addEventListener('scroll', f);
    f();
    return () => sc.removeEventListener('scroll', f);
  }, [r.on]);

  const spec = useMemo(() => {
    if (!buf || !r.spectrogram) return null;
    const ch = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
    const x = resample(downmix(ch), buf.sampleRate, 11025);
    return { ...magSpectrogram(x, 512, 64), rate: 11025 / 64 };
  }, [buf, r.spectrogram]);

  const grid = useMemo(() => (song ? gridFromSong(song) : null), [song]);

  // Draw.
  useEffect(() => {
    const cv = canvas.current;
    if (!cv || !song || !r.on) return;
    const width = Math.max(1, Math.ceil(boxes.length ? boxes[boxes.length - 1].x + boxes[boxes.length - 1].w + 40 : 800));
    cv.width = width;
    cv.height = H;
    const g = cv.getContext('2d')!;
    g.fillStyle = '#fbfaf7';
    g.fillRect(0, 0, width, H);
    const clip = shown;
    const C = clip ? clipStartMs(song, clip) : 0;
    const recSec = (ms: number) => (clip ? (ms - C + clip.startMs) / 1000 : 0);
    if (buf && clip) {
      const ch = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
      const sr = buf.sampleRate;
      let peak = 1e-6;
      for (const c of ch) for (let i = 0; i < c.length; i += 7) peak = Math.max(peak, Math.abs(c[i]));
      const gain = (H / 2 - 4) / peak;
      // Spectrogram rows: log frequency 40 Hz .. 5.5 kHz.
      const rowBin = (y: number) => {
        const hz = 40 * Math.pow(5500 / 40, (H - 1 - y) / (H - 1));
        return spec ? Math.min(spec.bins - 1, Math.round((hz / 5512.5) * (spec.bins - 1))) : 0;
      };
      let specMax = 1e-9;
      if (spec) for (let i = 0; i < spec.data.length; i += 3) specMax = Math.max(specMax, spec.data[i]);
      for (const b of boxes) {
        for (let px = 0; px < b.w; px++) {
          const ms0 = b.ms0 + ((b.ms1 - b.ms0) * px) / b.w;
          const ms1 = b.ms0 + ((b.ms1 - b.ms0) * (px + 1)) / b.w;
          const s0 = recSec(ms0), s1 = recSec(ms1);
          if (s1 < clip.startMs / 1000 || s0 > (clip.startMs + clip.lengthMs) / 1000) continue;
          const x = Math.round(b.x + px);
          if (spec) {
            const f = Math.floor(((s0 + s1) / 2) * spec.rate);
            if (f < 0 || f >= spec.frames) continue;
            for (let y = 0; y < H; y++) {
              const v = Math.max(0, 1 + Math.log10(spec.data[f * spec.bins + rowBin(y)] / specMax + 1e-9) / 3.5); // 70 dB range
              const c = Math.max(0, Math.min(255, Math.round(255 * v)));
              g.fillStyle = `rgb(${c},${Math.round(c * 0.75)},${Math.round(80 + c * 0.3)})`;
              g.fillRect(x, y, 1, 1);
            }
          } else {
            const i0 = Math.max(0, Math.floor(s0 * sr)), i1 = Math.min(ch[0].length, Math.ceil(s1 * sr));
            let mn = 0, mx = 0;
            for (let i = i0; i < i1; i++) for (const c of ch) { const v = c[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
            g.fillStyle = '#5b7bd5';
            g.fillRect(x, H / 2 - mx * gain, 1, Math.max(1, (mx - mn) * gain));
          }
        }
      }
    } else {
      g.fillStyle = '#999';
      g.font = '12px sans-serif';
      g.fillText(clip ? 'Loading audio…' : 'No audio for this choice (transcription only).', 10, H / 2);
    }
    // Beat lines (bar lines darker); the beat being dragged follows the mouse.
    if (grid) {
      grid.barStarts.forEach((s, bar) => {
        const b = boxes[bar];
        if (!b) return;
        const n = (grid.barStarts[bar + 1] ?? grid.beats.length) - s;
        for (let k = 0; k < n; k++) {
          const ms = grid.beats[s + k];
          let x = b.x + ((ms - b.ms0) / Math.max(1, b.ms1 - b.ms0)) * b.w;
          if (drag && drag.bar === bar && drag.beat === k) x = drag.x;
          g.fillStyle = k === 0 ? 'rgba(200,40,40,0.9)' : 'rgba(200,120,40,0.6)';
          g.fillRect(Math.round(x), 0, k === 0 ? 2 : 1, H);
        }
      });
    }
  }, [boxes, buf, spec, grid, song, r.on, shown, drag]);

  if (!r.on || !song) return null;

  const xToMs = (x: number): number => {
    const b = boxes.find((bb) => x >= bb.x && x < bb.x + bb.w) ?? (x < (boxes[0]?.x ?? 0) ? boxes[0] : boxes[boxes.length - 1]);
    if (!b) return 0;
    return b.ms0 + ((x - b.x) / b.w) * (b.ms1 - b.ms0);
  };
  const nearestBeat = (x: number): { bar: number; beat: number; dx: number } | null => {
    if (!grid) return null;
    let best: { bar: number; beat: number; dx: number } | null = null;
    grid.barStarts.forEach((s, bar) => {
      const b = boxes[bar];
      if (!b) return;
      const n = (grid.barStarts[bar + 1] ?? grid.beats.length) - s;
      for (let k = 0; k < n; k++) {
        const bx = b.x + ((grid.beats[s + k] - b.ms0) / Math.max(1, b.ms1 - b.ms0)) * b.w;
        const dx = Math.abs(bx - x);
        if (!best || dx < best.dx) best = { bar, beat: k, dx };
      }
    });
    return best;
  };
  const localX = (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    return e.clientX - rect.left;
  };
  const stems = song.tracks.filter((t) => t.analysis?.kind === 'stem' || (t.audio && !t.analysis && t.id !== song.recording?.trackId));
  const txs = song.tracks.filter((t) => !t.audio);
  const sel = status?.range;

  return (
    <div className="review" data-testid="review">
      <div className="review-bar">
        <b>Review</b>
        <span className="seg" role="group" title="What you hear">
          {([['original', 'Original'], ['stem', 'Stem'], ['tx', 'Transcription'], ['stemtx', 'Stem + transcription']] as [ReviewSource, string][]).map(([k, l]) => (
            <button key={k} className={r.source === k ? 'chip' : ''} data-testid={'ab-' + k} onClick={() => reviewCtl.set({ source: k })}>{l}</button>
          ))}
        </span>
        <label>Stem
          <select value={r.stemId ?? ''} onChange={(e) => reviewCtl.set({ stemId: e.target.value || null })}>
            <option value="">—</option>
            {stems.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label>Transcription
          <select value={r.txId ?? ''} onChange={(e) => reviewCtl.set({ txId: e.target.value || null })}>
            <option value="">—</option>
            {txs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className={`toggle ${r.spectrogram ? 'on' : ''}`}><input type="checkbox" checked={r.spectrogram} onChange={(e) => reviewCtl.set({ spectrogram: e.target.checked })} /> Spectrogram</label>
        <label className="speed" title="Slow down (pitch stays the same)">Speed
          <input type="range" min={25} max={100} step={5} value={Math.min(100, state.practice.speed)} onChange={(e) => store.setPractice({ speed: Number(e.target.value) })} data-testid="review-speed" />
          <span className="val">{state.practice.speed}%</span>
        </label>
        <label className={`toggle ${state.practice.loop ? 'on' : ''}`} title="Loop the selected bars (drag over the score)"><input type="checkbox" checked={state.practice.loop} onChange={(e) => store.setPractice({ loop: e.target.checked })} /> Loop</label>
        <span className="sep" />
        <button disabled={!sel || !status?.playing} title="While playing, click on every beat (4+ times) of the selected bars; Apply sets their tempo"
          onClick={() => setTaps([...taps, msAtTick(tempoPoints(song), player!.modelTick(player!.api.tickPosition))])}>Tap ({taps.length})</button>
        <button disabled={!sel || taps.length < 4} onClick={() => {
          try {
            store.edit((s) => tapTempo(s, sel!.startBar, sel!.endBar + 1, taps), 'Tap tempo');
          } catch (e) { store.showError((e as Error).message); }
          setTaps([]);
        }}>Apply taps</button>
        <label title="Beats per bar from the first selected bar (to the end of the selection)">Beats/bar
          <input type="number" min={1} max={12} value={perBar} onChange={(e) => setPerBar(Number(e.target.value))} style={{ width: 40 }} />
        </label>
        <button disabled={!sel} onClick={() => store.edit((s) => rebar(s, sel!.startBar, perBar, sel!.endBar + 1), 'Beats per bar')}>Re-bar</button>
        <span className="small">Drag a beat line to move it · double-click one to make it beat 1 of a bar</span>
        <button className="close" onClick={() => reviewCtl.set({ on: false })}>✕</button>
      </div>
      <div className="review-strip" ref={wrap}>
        <canvas ref={canvas} data-testid="review-canvas"
          onMouseDown={(e) => {
            const x = localX(e);
            const nb = nearestBeat(x);
            if (nb && nb.dx < 6) setDrag({ bar: nb.bar, beat: nb.beat, x });
          }}
          onMouseMove={(e) => { if (drag) setDrag({ ...drag, x: localX(e) }); }}
          onMouseUp={() => {
            if (!drag) return;
            const d = drag;
            setDrag(null);
            store.edit((s) => moveBeat(s, d.bar, d.beat, xToMs(d.x)), 'Move beat');
          }}
          onDoubleClick={(e) => {
            const nb = nearestBeat(localX(e));
            if (nb && nb.dx < 6 && nb.beat > 0) store.edit((s) => setDownbeat(s, nb.bar, nb.beat), 'Set downbeat');
          }} />
      </div>
    </div>
  );
}

/** Test/automation helpers for the review view. */
export const reviewTest = {
  /** Measure the pitch the review audio is producing (its own output, before the master bus). */
  async measurePitch(ms = 600): Promise<{ hz: number; peak: number }> {
    const tap = reviewCtl.audio?.tap;
    if (!tap) return { hz: 0, peak: 0 };
    await new Promise((r) => setTimeout(r, ms));
    const d = new Float32Array(tap.fftSize);
    tap.getFloatTimeDomainData(d);
    let peak = 0;
    for (const v of d) peak = Math.max(peak, Math.abs(v));
    const { estimatePitch } = await import('../../ml/pitch');
    return { hz: estimatePitch(d, tap.context.sampleRate, 60, 2000), peak };
  },
  probe: () => reviewCtl.audio?.probe() ?? null,
};
