// Drum step sequencer for the selected drum track: one bar at a time, 16/32 steps (or a triplet
// grid), a lane per kit piece, velocity per step (normal / accent / ghost); copy a bar, fill a
// section, and a pattern library (built-in + saved in settings.json).
import { useEffect, useMemo, useState } from 'react';
import {
  applyPattern, BUILTIN_PATTERNS, copyDrumBar, DEFAULT_LANES, fillSection, GM_DRUMS, patternFromBar, readDrumBar,
  sectionRanges, setDrumStep, stepsPerQuarter, VEL, type DrumRes,
} from '../../model';
import { liveSynth } from './audio/liveSynth';
import type { PlayerStatus } from './player';
import type { AppState, Store } from './store';
import { HelpButton, MoreOptions } from './HelpUi';

export function DrumGrid({ state, store, status }: { state: AppState; store: Store; status: PlayerStatus | null }) {
  const song = state.song!;
  const drumIdx = song.tracks.map((t, i) => (t.instrument.percussion ? i : -1)).filter((i) => i >= 0);
  const ti = song.tracks[state.selTrack]?.instrument.percussion ? state.selTrack : drumIdx[0] ?? -1;
  const [bar, setBar] = useState(0);
  const [res, setRes] = useState<DrumRes>(16);
  const [triplet, setTriplet] = useState(false);
  const [extra, setExtra] = useState<number[]>([]);
  const [copied, setCopied] = useState<number | null>(null);
  const [pattern, setPattern] = useState('');
  const [newName, setNewName] = useState('');

  useEffect(() => void store.loadDrumPatterns(), []);
  // Follow the cursor / the playing bar.
  useEffect(() => {
    if (state.cursor && state.cursor.track === ti) setBar(state.cursor.bar);
  }, [state.cursor?.bar]);
  useEffect(() => {
    if (status?.playing) setBar(status.currentBar);
  }, [status?.currentBar]);

  const b = Math.min(bar, song.bars.length - 1);
  const grid = useMemo(() => (ti >= 0 ? readDrumBar(song, ti, b, res, triplet) : null), [song, ti, b, res, triplet]);
  if (ti < 0 || !grid) {
    return (
      <div className="dg-empty">
        <HelpButton topic="drum-grid" /> This song has no drum track. <button className="primary" onClick={() => store.addDrumTrack()} data-testid="add-drums" title="Add an empty drum track so you can program a beat in the grid">Add a drum track</button>
      </div>
    );
  }
  const lanes = [...new Set([...DEFAULT_LANES, ...extra, ...grid.lanes.keys()])].sort((a, c) => {
    const ia = DEFAULT_LANES.indexOf(a);
    const ic = DEFAULT_LANES.indexOf(c);
    return (ia < 0 ? -1 : ia) - (ic < 0 ? -1 : ic) || a - c;
  });
  const perQ = stepsPerQuarter(res, triplet);
  const set = (pitch: number, step: number, v: number) => {
    store.tryEdit((s) => setDrumStep(s, ti, b, res, triplet, pitch, step, v), 'Drum step');
    if (v) void liveSynth.playChord([pitch], 0, true, 300, 0);
  };
  const click = (e: React.MouseEvent, pitch: number, step: number) => {
    e.preventDefault();
    const cur = grid.lanes.get(pitch)?.[step] ?? 0;
    // Click: on/off. Shift+click: accent. Right-click / Alt+click: ghost note.
    const want = e.shiftKey ? VEL.accent : e.altKey || e.button === 2 ? VEL.ghost : VEL.normal;
    set(pitch, step, cur === want || (cur && !e.shiftKey && !e.altKey && e.button !== 2) ? 0 : want);
  };
  const sec = sectionRanges(song).find((s) => b >= s.startBar && b < s.endBar);
  const all = [...BUILTIN_PATTERNS, ...state.drumPatterns];
  const range = status?.range;
  const t = song.tracks[ti];

  return (
    <div className="dg" data-testid="drum-grid">
      <div className="pr-tools">
        <HelpButton topic="drum-grid" />
        <select value={ti} onChange={(e) => store.setSelTrack(Number(e.target.value))} title="Which drum track to edit (if the song has more than one)">
          {drumIdx.map((i) => <option key={i} value={i}>{song.tracks[i].name}</option>)}
        </select>
        <button onClick={() => setBar(Math.max(0, b - 1))} disabled={b === 0} title="Show the previous bar of the drum part">◀</button>
        <span className="val" data-testid="dg-bar">Bar {b + 1} / {song.bars.length}</span>
        <button onClick={() => setBar(Math.min(song.bars.length - 1, b + 1))} disabled={b >= song.bars.length - 1} title="Show the next bar of the drum part">▶</button>
        <MoreOptions title="Finer steps, triplets and extra drums: for fast fills or swung beats">
          <label className="lbl" title="How many steps a bar has: 16ths for most beats, 32nds for very fast fills">Steps
            <select value={res} onChange={(e) => setRes(Number(e.target.value) as DrumRes)}>
              <option value={16}>16ths</option>
              <option value={32}>32nds</option>
            </select>
          </label>
          <label className="check" title="Triplet grid: three steps per beat instead of four. Use for shuffles and swung beats"><input type="checkbox" checked={triplet} onChange={(e) => setTriplet(e.target.checked)} /> Triplets</label>
          <select value="" onChange={(e) => { const p = Number(e.target.value); if (p) setExtra([...extra, p]); }} title="Add a row for another drum or percussion sound (cowbell, tambourine, more toms…)">
            <option value="">+ Kit piece…</option>
            {Object.entries(GM_DRUMS).filter(([p]) => !lanes.includes(Number(p))).map(([p, n]) => <option key={p} value={p}>{n} ({p})</option>)}
          </select>
        </MoreOptions>
        {t.generated && <span className="tag">generated: editing marks it “edited”</span>}
      </div>
      <div className="pr-tools">
        <button onClick={() => setCopied(b)} title="Copy this bar's beat, then paste it onto other bars">Copy bar</button>
        <button disabled={copied === null} data-testid="dg-paste"
          onClick={() => store.tryEdit((s) => copyDrumBar(s, ti, copied!, range ? Array.from({ length: range.endBar - range.startBar + 1 }, (_, k) => range.startBar + k) : [b]), 'Paste drum bar')}
          title="Paste the copied bar here (or onto the bars selected in the score). Quick way to repeat a beat">Paste{copied !== null ? ` bar ${copied + 1}` : ''}{range ? ` → bars ${range.startBar + 1}-${range.endBar + 1}` : ''}</button>
        <button onClick={() => store.tryEdit((s) => fillSection(s, ti, b), 'Fill section with bar ' + (b + 1))} data-testid="dg-fill"
          title="Copy this bar to every bar of its section (e.g. the whole verse). Use when one bar of beat is right for the section">Fill {sec ? `“${sec.name}”` : 'song'}</button>
        <span className="lbl">Pattern</span>
        <select value={pattern} onChange={(e) => setPattern(e.target.value)} data-testid="dg-pattern" title="Ready-made beats (rock, funk, …) and the ones you saved. Pick one, then Apply">
          <option value="">choose…</option>
          <optgroup label="Built in">{BUILTIN_PATTERNS.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}</optgroup>
          {state.drumPatterns.length > 0 && <optgroup label="Saved">{state.drumPatterns.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}</optgroup>}
        </select>
        <button disabled={!pattern} data-testid="dg-apply" title="Put the chosen pattern on this bar (or on the bars selected in the score)" onClick={() => {
          const p = all.find((x) => x.name === pattern)!;
          const bars = range ? Array.from({ length: range.endBar - range.startBar + 1 }, (_, k) => range.startBar + k) : [b];
          store.tryEdit((s) => applyPattern(s, ti, bars, p), 'Drum pattern ' + p.name);
        }}>Apply{range ? ` to bars ${range.startBar + 1}-${range.endBar + 1}` : ''}</button>
        {pattern && state.drumPatterns.some((p) => p.name === pattern) && <button onClick={() => { void store.deleteDrumPattern(pattern); setPattern(''); }} title="Delete this saved pattern from your list (the song is not changed)">Delete</button>}
        <input className="name" placeholder="Save bar as…" title="Name for this bar's beat, to reuse it in other songs from the Pattern list" value={newName} onChange={(e) => setNewName(e.target.value)} data-testid="dg-name" />
        <button disabled={!newName.trim()} data-testid="dg-save" title="Save this bar's beat as a pattern under the name typed to the left" onClick={() => { void store.saveDrumPattern(patternFromBar(song, ti, b, res, triplet, newName.trim())); setNewName(''); }}>Save</button>
      </div>
      <div className="dg-grid" onContextMenu={(e) => e.preventDefault()}>
        <table>
          <thead>
            <tr>
              <th />
              {Array.from({ length: grid.steps }, (_, i) => (
                <th key={i} className={i % perQ === 0 ? 'beat' : ''}>{i % perQ === 0 ? i / perQ + 1 : ''}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lanes.map((p) => {
              const cells = grid.lanes.get(p) ?? new Array(grid.steps).fill(0);
              return (
                <tr key={p}>
                  <th className="lane" onClick={() => void liveSynth.playChord([p], 0, true, 300, 0)} title={`${GM_DRUMS[p] ?? 'Drum'} (GM drum ${p}): click to hear it`}>{GM_DRUMS[p] ?? p}</th>
                  {cells.map((v, i) => (
                    <td key={i} data-cell={`${p}:${i}`} className={`${i % perQ === 0 ? 'beat' : ''} ${v ? (v >= VEL.accent ? 'on acc' : v <= VEL.ghost ? 'on ghost' : 'on') : ''}`}
                      title={v ? `Hit, loudness (velocity) ${v}: click to remove` : 'Click to add a hit · Shift+click: accent (louder) · right-click: ghost note (soft)'}
                      onMouseDown={(e) => click(e, p, i)} />
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="sub hint">Click a step: on/off · Shift+click: accent · right-click or Alt+click: ghost note. Select bars in the score (drag) to paste or apply a pattern to all of them.</div>
    </div>
  );
}
