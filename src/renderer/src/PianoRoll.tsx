// Piano roll: draw, move, resize and delete notes of the selected track; snap grid; velocity
// lane; zoom; follows the play cursor. Every gesture is one undoable model edit, so the score
// and the tab redraw from the same notes.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addRollNote, barStartTicks, deleteRollNotes, moveRollNotes, pitchName, PPQ, resizeRollNotes, setRollVelocity, SNAPS,
  snapTicks, songTicks, staffNotes, type RollNote,
} from '../../model';
import { liveSynth } from './audio/liveSynth';
import type { PlayerStatus } from './player';
import type { AppState, Store } from './store';

const HI = 108; // C8
const LO = 21; // A0
const ROW = 11;
const VEL_H = 64;
const KEYS_W = 46;
const BLACK = new Set([1, 3, 6, 8, 10]);

type Drag =
  | { mode: 'draw'; start: number; pitch: number; dur: number }
  | { mode: 'move'; ids: number[]; downTick: number; downPitch: number; dTick: number; dPitch: number; moved: boolean }
  | { mode: 'resize'; ids: number[]; downTick: number; dTick: number }
  | { mode: 'vel'; ids: number[]; velocity: number };

export function PianoRoll({ state, store, status }: { state: AppState; store: Store; status: PlayerStatus | null }) {
  const song = state.song!;
  const ti = Math.min(state.selTrack, song.tracks.length - 1);
  const track = song.tracks[ti];
  const [staff, setStaff] = useState(0);
  const st = Math.min(staff, track.staves.length - 1);
  const [snapId, setSnapId] = useState('16');
  const [ppq, setPpq] = useState(48);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<Drag | null>(null);
  const [lastLen, setLastLen] = useState(PPQ);
  const gridRef = useRef<HTMLDivElement>(null);
  const keysRef = useRef<HTMLDivElement>(null);
  const velRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;

  const notes = useMemo(() => staffNotes(song, ti, st), [song, ti, st]);
  const grid = snapTicks(snapId);
  const total = songTicks(song);
  const width = Math.ceil((total / PPQ) * ppq) + 40;
  const height = (HI - LO + 1) * ROW;
  const keyOf = (n: RollNote) => `${n.start}:${n.pitch}`;
  const selIds = notes.map((n, i) => (sel.has(keyOf(n)) ? i : -1)).filter((i) => i >= 0);
  const x = (tick: number) => (tick / PPQ) * ppq;
  const y = (pitch: number) => (HI - pitch) * ROW;
  const program = track.instrument.program;
  const perc = track.instrument.percussion;
  // Fretted tracks: only pitches the strings can play (capo included).
  const fretted = !!track.tuning && !perc;
  const lowP = fretted ? track.tuning![0] + (track.capo ?? 0) : LO;
  const highP = fretted ? track.tuning![track.tuning!.length - 1] + 24 : HI;

  // Scroll to the notes when the track changes.
  useEffect(() => {
    const g = gridRef.current;
    if (!g) return;
    const ps = notes.map((n) => n.pitch);
    const mid = ps.length ? (Math.min(...ps) + Math.max(...ps)) / 2 : 60;
    g.scrollTop = Math.max(0, y(mid) - g.clientHeight / 2);
    setSel(new Set());
  }, [ti, st]);

  // Follow the play cursor.
  useEffect(() => {
    const g = gridRef.current;
    if (!g || !status?.playing) return;
    const px = x(status.songTick);
    if (px < g.scrollLeft || px > g.scrollLeft + g.clientWidth - 40) g.scrollLeft = Math.max(0, px - 60);
  }, [status?.songTick, status?.playing]);

  const onScroll = () => {
    const g = gridRef.current!;
    if (keysRef.current) keysRef.current.scrollTop = g.scrollTop;
    if (velRef.current) velRef.current.scrollLeft = g.scrollLeft;
    if (rulerRef.current) rulerRef.current.scrollLeft = g.scrollLeft;
  };

  const point = (e: React.PointerEvent | PointerEvent) => {
    const r = (gridRef.current!.querySelector('svg') as SVGSVGElement).getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    return { tick: (px / ppq) * PPQ, pitch: HI - Math.floor(py / ROW), px, py };
  };
  const noteAt = (tick: number, pitch: number) => {
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i];
      if (n.pitch === pitch && tick >= n.start && tick < n.start + n.dur) return i;
    }
    return -1;
  };
  const capture = (e: React.PointerEvent) => {
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events (tests) have no active pointer */
    }
  };
  const hear = (pitch: number) => void liveSynth.playChord([pitch], program, perc, 350, 0);

  const onDown = (e: React.PointerEvent) => {
    if (e.button === 2) return;
    capture(e);
    const p = point(e);
    const i = noteAt(p.tick, p.pitch);
    if (i >= 0) {
      const n = notes[i];
      const k = keyOf(n);
      let s = sel;
      if (e.shiftKey) {
        s = new Set(sel);
        if (s.has(k)) s.delete(k);
        else s.add(k);
      } else if (!sel.has(k)) s = new Set([k]);
      setSel(s);
      const ids = notes.map((m, j) => (s.has(keyOf(m)) ? j : -1)).filter((j) => j >= 0);
      const nearEnd = x(n.start + n.dur) - p.px < 6;
      if (nearEnd) setDrag({ mode: 'resize', ids: ids.length ? ids : [i], downTick: p.tick, dTick: 0 });
      else setDrag({ mode: 'move', ids: ids.length ? ids : [i], downTick: p.tick, downPitch: p.pitch, dTick: 0, dPitch: 0, moved: false });
      hear(n.pitch);
      return;
    }
    if (p.pitch < lowP || p.pitch > highP) {
      if (fretted) store.showInfo(track.name + ' can play ' + pitchName(lowP) + ' to ' + pitchName(highP) + '.');
      return;
    }
    setSel(new Set());
    const start = Math.max(0, Math.floor(p.tick / grid) * grid);
    setDrag({ mode: 'draw', start, pitch: p.pitch, dur: Math.max(grid, Math.round(lastLen / grid) * grid) });
    hear(p.pitch);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const p = point(e);
    if (d.mode === 'draw') {
      const end = Math.max(d.start + grid, Math.ceil(p.tick / grid) * grid);
      setDrag({ ...d, dur: end - d.start });
    } else if (d.mode === 'move') {
      const dTick = Math.round((p.tick - d.downTick) / grid) * grid;
      const ps = d.ids.map((i) => notes[i].pitch);
      const dPitch = Math.max(lowP - Math.min(...ps), Math.min(highP - Math.max(...ps), p.pitch - d.downPitch));
      if (dPitch !== d.dPitch && dPitch !== 0) hear(notes[d.ids[0]].pitch + dPitch);
      setDrag({ ...d, dTick, dPitch, moved: d.moved || dTick !== 0 || dPitch !== 0 });
    } else if (d.mode === 'resize') {
      setDrag({ ...d, dTick: Math.round((p.tick - d.downTick) / grid) * grid });
    }
  };
  const onUp = () => {
    const d = dragRef.current;
    setDrag(null);
    if (!d) return;
    if (d.mode === 'draw') {
      setLastLen(d.dur);
      store.tryEdit((s) => addRollNote(s, ti, st, { start: d.start, dur: d.dur, pitch: d.pitch }), 'Draw note');
      setSel(new Set([`${d.start}:${d.pitch}`]));
    } else if (d.mode === 'move' && d.moved) {
      const minStart = Math.min(...d.ids.map((i) => notes[i].start));
      const dTick = Math.max(-minStart, d.dTick);
      store.tryEdit((s) => moveRollNotes(s, ti, st, d.ids, dTick, d.dPitch), d.ids.length > 1 ? 'Move notes' : 'Move note');
      setSel(new Set(d.ids.map((i) => `${notes[i].start + dTick}:${notes[i].pitch + d.dPitch}`)));
    } else if (d.mode === 'resize' && d.dTick) {
      store.tryEdit((s) => resizeRollNotes(s, ti, st, d.ids, (old) => Math.max(grid, old + d.dTick)), 'Note length');
      const len = Math.max(grid, notes[d.ids[0]].dur + d.dTick);
      setLastLen(len);
    }
  };
  const onDelete = (ids: number[]) => {
    if (!ids.length) return;
    store.tryEdit((s) => deleteRollNotes(s, ti, st, ids), ids.length > 1 ? 'Delete notes' : 'Delete note');
    setSel(new Set());
  };
  const onContext = (e: React.MouseEvent) => {
    e.preventDefault();
    const p = point(e as unknown as PointerEvent);
    const i = noteAt(p.tick, p.pitch);
    if (i >= 0) onDelete(sel.has(keyOf(notes[i])) ? selIds : [i]);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      e.stopPropagation();
      onDelete(selIds);
    } else if (e.key === 'a' && e.ctrlKey) {
      e.preventDefault();
      e.stopPropagation();
      setSel(new Set(notes.map(keyOf)));
    }
  };

  // Velocity lane.
  const velDown = (e: React.PointerEvent) => {
    capture(e);
    const r = (e.currentTarget as Element).getBoundingClientRect();
    const tick = ((e.clientX - r.left) / ppq) * PPQ;
    let best = -1;
    let bestD = Infinity;
    notes.forEach((n, i) => {
      const dd = Math.abs(n.start - tick);
      if (dd < bestD && dd < (8 / ppq) * PPQ) {
        best = i;
        bestD = dd;
      }
    });
    if (best < 0) return;
    const ids = sel.has(keyOf(notes[best])) ? selIds : [best];
    const v = Math.round(Math.max(1, Math.min(127, (1 - (e.clientY - r.top) / VEL_H) * 127)));
    setDrag({ mode: 'vel', ids, velocity: v });
  };
  const velMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (d?.mode !== 'vel') return;
    const r = (e.currentTarget as Element).getBoundingClientRect();
    setDrag({ ...d, velocity: Math.round(Math.max(1, Math.min(127, (1 - (e.clientY - r.top) / VEL_H) * 127))) });
  };
  const velUp = () => {
    const d = dragRef.current;
    setDrag(null);
    if (d?.mode === 'vel') store.tryEdit((s) => setRollVelocity(s, ti, st, d.ids, d.velocity), 'Velocity');
  };

  // What to draw (with the drag applied).
  const shown = notes.map((n, i) => {
    let { start, dur, pitch, velocity } = n;
    if (drag?.mode === 'move' && drag.ids.includes(i)) {
      start = Math.max(0, start + drag.dTick);
      pitch += drag.dPitch;
    } else if (drag?.mode === 'resize' && drag.ids.includes(i)) dur = Math.max(grid, dur + drag.dTick);
    else if (drag?.mode === 'vel' && drag.ids.includes(i)) velocity = drag.velocity;
    return { start, dur, pitch, velocity, sel: sel.has(keyOf(n)), i };
  });
  const starts = barStartTicks(song);
  const gridLines: React.JSX.Element[] = [];
  for (let t = 0, k = 0; t <= total && k < 4000; t += grid, k++) {
    const onBeat = Math.abs(t % PPQ) < 1;
    if (!onBeat) gridLines.push(<line key={'g' + k} x1={x(t)} x2={x(t)} y1={0} y2={height} className="pr-grid" />);
  }
  for (let t = 0, k = 0; t <= total; t += PPQ, k++) gridLines.push(<line key={'b' + k} x1={x(t)} x2={x(t)} y1={0} y2={height} className="pr-beat" />);
  starts.forEach((t, b) => gridLines.push(<line key={'m' + b} x1={x(t)} x2={x(t)} y1={0} y2={height} className="pr-bar" />));
  const rows: React.JSX.Element[] = [];
  if (fretted) {
    rows.push(<rect key="above" x={0} y={0} width={width} height={y(highP)} className="pr-out" />);
    rows.push(<rect key="below" x={0} y={y(lowP - 1)} width={width} height={height - y(lowP - 1)} className="pr-out" />);
  }
  for (let p = HI; p >= LO; p--) if (BLACK.has(p % 12)) rows.push(<rect key={p} x={0} y={y(p)} width={width} height={ROW} className="pr-black" />);
  const playX = status ? x(status.songTick) : -10;

  return (
    <div className="pr" tabIndex={0} onKeyDown={onKey} data-testid="piano-roll">
      <div className="pr-tools">
        <span className="lbl">Snap</span>
        <select value={snapId} onChange={(e) => setSnapId(e.target.value)} data-testid="roll-snap">
          {SNAPS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <span className="lbl">Zoom</span>
        <button onClick={() => setPpq(Math.max(12, Math.round(ppq / 1.4)))} title="Zoom out">−</button>
        <button onClick={() => setPpq(Math.min(240, Math.round(ppq * 1.4)))} title="Zoom in">+</button>
        {track.staves.length > 1 && (
          <select value={st} onChange={(e) => setStaff(Number(e.target.value))} title="Staff">
            {track.staves.map((_, i) => <option key={i} value={i}>Staff {i + 1}</option>)}
          </select>
        )}
        <span className="sub">{notes.length} notes{selIds.length ? ` · ${selIds.length} selected` : ''}</span>
        <button disabled={!selIds.length} onClick={() => onDelete(selIds)} title="Delete the selected notes (Delete)">Delete</button>
        <span className="sub hint">Drag on empty space to draw · drag a note to move, its right edge to resize · right-click deletes · Shift+click adds to the selection</span>
      </div>
      <div className="pr-body">
        <div className="pr-keys" ref={keysRef}>
          <div style={{ height: 18 }} />
          <svg width={KEYS_W} height={height}>
            {Array.from({ length: HI - LO + 1 }, (_, k) => HI - k).map((p) => (
              <g key={p} onPointerDown={() => hear(p)} style={{ cursor: 'pointer' }}>
                <rect x={0} y={y(p)} width={KEYS_W} height={ROW} className={BLACK.has(p % 12) ? 'pr-key-b' : 'pr-key-w'} />
                {p % 12 === 0 && <text x={KEYS_W - 3} y={y(p) + ROW - 2} className="pr-keylbl">{pitchName(p)}</text>}
              </g>
            ))}
          </svg>
        </div>
        <div className="pr-right">
          <div className="pr-ruler" ref={rulerRef}>
            <svg width={width} height={18}>
              {starts.map((t, b) => <text key={b} x={x(t) + 3} y={13} className="pr-barnum">{b + 1}</text>)}
            </svg>
          </div>
          <div className="pr-grid-wrap" ref={gridRef} onScroll={onScroll}>
            <svg width={width} height={height} data-testid="roll-grid" data-ppq={ppq} data-row={ROW} data-hi={HI}
              onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onContextMenu={onContext}
              onDoubleClick={(e) => { const p = point(e as unknown as PointerEvent); const i = noteAt(p.tick, p.pitch); if (i >= 0) onDelete([i]); }}>
              {rows}
              {gridLines}
              {shown.map((n) => (
                <rect key={n.i} x={x(n.start) + 0.5} y={y(n.pitch) + 0.5} width={Math.max(3, x(n.dur) - 1)} height={ROW - 1} rx={2}
                  className={`pr-note ${n.sel ? 'sel' : ''}`} style={{ opacity: 0.35 + (n.velocity / 127) * 0.65 }} />
              ))}
              {drag?.mode === 'draw' && <rect x={x(drag.start)} y={y(drag.pitch)} width={x(drag.dur)} height={ROW} className="pr-note ghost" />}
              <line x1={playX} x2={playX} y1={0} y2={height} className="pr-play" />
            </svg>
          </div>
          <div className="pr-vel" ref={velRef}>
            <svg width={width} height={VEL_H} onPointerDown={velDown} onPointerMove={velMove} onPointerUp={velUp} data-testid="roll-vel">
              {starts.map((t, b) => <line key={b} x1={x(t)} x2={x(t)} y1={0} y2={VEL_H} className="pr-bar" />)}
              {shown.map((n) => (
                <line key={n.i} x1={x(n.start) + 2} x2={x(n.start) + 2} y1={VEL_H} y2={VEL_H - (n.velocity / 127) * (VEL_H - 4)} className={`pr-velbar ${n.sel ? 'sel' : ''}`} />
              ))}
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
