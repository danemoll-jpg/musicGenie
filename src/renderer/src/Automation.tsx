// Round 5: automation lanes under the selected track. Click to add a point, drag to move it,
// right-click to delete. Points sit on bars (they move with the music when the tempo changes).
import { useRef, useState } from 'react';
import { barStartTicks, barTicks, FX_DEFS, laneRange, type AutoLane, type AutoPoint, type Song, type Track } from '../../model';
import type { PlayerStatus } from './player';
import type { AppState, Store } from './store';

const BAR_PX = 90;
const H = 72;
const SNAP = 240; // 1/16 note

export function laneParams(t: Track): { param: string; name: string }[] {
  const out = [{ param: 'volume', name: 'Volume' }, { param: 'pan', name: 'Pan' }];
  for (const f of t.mixer.fx ?? []) {
    for (const p of FX_DEFS[f.type].params) if (!p.options) out.push({ param: 'fx:' + f.id + ':' + p.key, name: FX_DEFS[f.type].name + ': ' + p.name });
  }
  return out;
}

function xOf(song: Song, bar: number, tick: number): number {
  return (bar + tick / barTicks(song.bars[bar] ?? song.bars[0])) * BAR_PX;
}
function posAt(song: Song, x: number): { bar: number; tick: number } {
  const bar = Math.max(0, Math.min(song.bars.length - 1, Math.floor(x / BAR_PX)));
  const len = barTicks(song.bars[bar]);
  const tick = Math.max(0, Math.min(len, Math.round((((x - bar * BAR_PX) / BAR_PX) * len) / SNAP) * SNAP));
  return tick >= len && bar < song.bars.length - 1 ? { bar: bar + 1, tick: 0 } : { bar, tick };
}

function Lane({ song, track, lane, li, store, playX }: { song: Song; track: Track; lane: AutoLane; li: number; store: Store; playX: number | null }) {
  const r = laneRange(track, lane.param);
  const W = song.bars.length * BAR_PX;
  const yOf = (v: number) => H - 6 - ((v - r.min) / (r.max - r.min)) * (H - 12);
  const vAt = (y: number) => Math.max(r.min, Math.min(r.max, r.min + ((H - 6 - y) / (H - 12)) * (r.max - r.min)));
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const sorted = lane.points.map((p, i) => ({ ...p, i, x: xOf(song, p.bar, p.tick) })).sort((a, b) => a.x - b.x);
  const setPoints = (fn: (pts: AutoPoint[]) => AutoPoint[], label: string, merge?: string) =>
    store.setAutomation(track.id, (lanes) => lanes.map((l, k) => (k === li ? { ...l, points: fn(l.points) } : l)), label, merge);
  const local = (e: React.PointerEvent) => {
    const b = svg.current!.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  };
  const line = sorted.length
    ? [`M0,${yOf(sorted[0].value)}`, ...sorted.map((p) => `L${p.x},${yOf(p.value)}`), `L${W},${yOf(sorted[sorted.length - 1].value)}`].join(' ')
    : '';
  return (
    <div className="lane" data-lane={lane.param}>
      <div className="lane-head">
        <b>{r.name}</b>
        <span className="hint">{lane.points.length} points · click = add, drag = move, right-click = delete</span>
        <button onClick={() => setPoints(() => [], 'Clear automation')} disabled={!lane.points.length}>Clear</button>
        <button onClick={() => store.setAutomation(track.id, (lanes) => lanes.filter((_, k) => k !== li), 'Remove automation lane')}>Remove lane</button>
      </div>
      <svg ref={svg} width={W} height={H} data-testid={'lane-' + lane.param}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          const { x, y } = local(e);
          const hit = sorted.find((p) => Math.abs(p.x - x) < 6 && Math.abs(yOf(p.value) - y) < 6);
          (e.target as Element).setPointerCapture?.(e.pointerId);
          if (hit) { setDrag(hit.i); return; }
          const pos = posAt(song, x);
          const n = lane.points.length;
          setPoints((pts) => [...pts, { ...pos, value: vAt(y) }], 'Add automation point');
          setDrag(n);
        }}
        onPointerMove={(e) => {
          if (drag === null) return;
          const { x, y } = local(e);
          const pos = posAt(song, x);
          setPoints((pts) => pts.map((p, k) => (k === drag ? { ...pos, value: vAt(y) } : p)), 'Move automation point', 'auto:' + track.id + ':' + li + ':' + drag);
        }}
        onPointerUp={() => setDrag(null)}
        onContextMenu={(e) => {
          e.preventDefault();
          const b = svg.current!.getBoundingClientRect();
          const x = e.clientX - b.left;
          const y = e.clientY - b.top;
          const hit = sorted.find((p) => Math.abs(p.x - x) < 7 && Math.abs(yOf(p.value) - y) < 7);
          if (hit) setPoints((pts) => pts.filter((_, k) => k !== hit.i), 'Delete automation point');
        }}>
        {song.bars.map((_, i) => (
          <g key={i}>
            <line x1={i * BAR_PX} x2={i * BAR_PX} y1={0} y2={H} stroke="#e3e1dc" />
            <text x={i * BAR_PX + 3} y={11} fontSize={9} fill="#999">{i + 1}</text>
          </g>
        ))}
        {line && <path d={line} fill="none" stroke="#3b5bdb" strokeWidth={2} />}
        {sorted.map((p) => <circle key={p.i} cx={p.x} cy={yOf(p.value)} r={4.5} fill="#fff" stroke="#3b5bdb" strokeWidth={2} />)}
        {playX !== null && <line x1={playX} x2={playX} y1={0} y2={H} stroke="#e8590c" strokeWidth={1.5} />}
      </svg>
    </div>
  );
}

export function AutomationPanel({ state, store, status }: { state: AppState; store: Store; status: PlayerStatus | null }) {
  const song = state.song!;
  const ti = Math.min(state.selTrack, song.tracks.length - 1);
  const t = song.tracks[ti];
  const lanes = t.automation ?? [];
  const options = laneParams(t).filter((o) => !lanes.some((l) => l.param === o.param));
  let playX: number | null = null;
  if (status) {
    const starts = barStartTicks(song);
    let b = 0;
    while (b + 1 < starts.length && starts[b + 1] <= status.songTick) b++;
    playX = xOf(song, b, status.songTick - starts[b]);
  }
  return (
    <div className="auto-panel" data-testid="automation">
      <div className="pr-tools">
        <span className="lbl">Automation of <b>{t.name}</b></span>
        <select value="" onChange={(e) => e.target.value && store.setAutomation(t.id, (l) => [...l, { param: e.target.value, points: [] }], 'Add automation lane')} data-testid="auto-add">
          <option value="">+ Lane…</option>
          {options.map((o) => <option key={o.param} value={o.param}>{o.name}</option>)}
        </select>
        <span className="hint">An automated knob follows its lane while playing and in exports.</span>
      </div>
      <div className="lanes">
        {lanes.map((l, i) => <Lane key={l.param} song={song} track={t} lane={l} li={i} store={store} playX={playX} />)}
        {!lanes.length && <div className="hint" style={{ padding: 10 }}>No lanes yet: pick a parameter in “+ Lane…”.</div>}
      </div>
    </div>
  );
}
