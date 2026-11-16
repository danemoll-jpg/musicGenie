// Round 4 UI: the composer dock (piano roll, drum grid, chord explorer, progressions, MIDI),
// the chord chart dialog, the key / time / tempo changes dialog, and the harmony menu.
import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  keyChanges, keyName, parseKeyName, QUANTIZE, STYLE_IDS, STYLES, tempoAt, tempoChanges, timeSigChanges,
  type HarmonyDirection, type HarmonyInterval, type Quantize, type StyleId, type Track,
} from '../../model';
import { ChordExplorer } from './ChordExplorer';
import { DrumGrid } from './DrumGrid';
import type { MidiController, MidiState } from './midi';
import { PianoRoll } from './PianoRoll';
import type { PlayerStatus } from './player';
import { Progressions } from './Progressions';
import type { AppState, DockTab, Store } from './store';

const TABS: { id: DockTab; label: string; title: string }[] = [
  { id: 'roll', label: '🎹 Piano roll', title: 'Draw, move and resize notes of the selected track' },
  { id: 'drums', label: '🥁 Drum grid', title: 'Step sequencer for a drum track' },
  { id: 'chords', label: '♯ Chords', title: 'Every way to play a chord; hear it, insert it' },
  { id: 'prog', label: '⇢ Progressions', title: 'What could come next, substitutions, common progressions' },
  { id: 'midi', label: '🎛 MIDI', title: 'MIDI keyboard: play, step entry, record' },
];

export function Dock({ state, store, status, midi }: { state: AppState; store: Store; status: PlayerStatus | null; midi: MidiController }) {
  const song = state.song;
  if (!song || !state.dock) return null;
  const ti = Math.min(state.selTrack, song.tracks.length - 1);
  return (
    <div className="dock" data-testid="dock">
      <div className="dock-tabs">
        {TABS.map((t) => (
          <button key={t.id} className={state.dock === t.id ? 'chip' : ''} title={t.title} onClick={() => store.openDock(t.id)} data-testid={'dock-' + t.id}>{t.label}</button>
        ))}
        <span className="lbl" style={{ marginLeft: 12 }}>Track</span>
        <select value={ti} onChange={(e) => store.setSelTrack(Number(e.target.value))} data-testid="dock-track">
          {song.tracks.map((t, i) => <option key={t.id} value={i}>{t.name}</option>)}
        </select>
        <button className="close" onClick={() => store.openDock(null)} title="Close">✕</button>
      </div>
      <div className="dock-body">
        {state.dock === 'roll' && song.tracks.length > 0 && <PianoRoll state={state} store={store} status={status} />}
        {state.dock === 'drums' && <DrumGrid state={state} store={store} status={status} />}
        {state.dock === 'chords' && song.tracks.length > 0 && <ChordExplorer state={state} store={store} currentBar={status?.currentBar ?? 0} />}
        {state.dock === 'prog' && <Progressions state={state} store={store} status={status} />}
        {state.dock === 'midi' && <MidiPanel state={state} store={store} midi={midi} />}
      </div>
    </div>
  );
}

function useMidi(midi: MidiController): MidiState {
  return useSyncExternalStore((f) => midi.on(f), () => midi.state);
}

const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function MidiPanel({ state, store, midi }: { state: AppState; store: Store; midi: MidiController }) {
  const m = useMidi(midi);
  useEffect(() => void midi.init(), []);
  const t = state.song!.tracks[state.selTrack];
  return (
    <div className="midi" data-testid="midi-panel">
      <div className="pr-tools">
        <span className="lbl">Input</span>
        <select value={m.inputId ?? ''} onChange={(e) => midi.select(e.target.value || null)} data-testid="midi-input">
          <option value="">{m.inputs.length ? 'none' : m.supported ? 'no MIDI keyboard found' : 'MIDI not supported'}</option>
          {m.inputs.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
        <button onClick={() => void midi.init()} title="Look for keyboards again">↻</button>
        <label className="check"><input type="checkbox" checked={m.monitor} onChange={(e) => midi.setOptions({ monitor: e.target.checked })} /> Play through “{t?.name}”</label>
        <label className="check" title="With ✎ Edit on: each key (or chord) is entered at the cursor, which then moves on">
          <input type="checkbox" checked={m.step} onChange={(e) => { midi.setOptions({ step: e.target.checked }); if (e.target.checked && !state.editMode) store.setEditMode(true); }} /> Step entry
        </label>
        <span className="sub">Keys: {m.held.length ? m.held.map((p) => NOTE[p % 12] + (Math.floor(p / 12) - 1)).join(' ') : '–'}</span>
      </div>
      <div className="pr-tools">
        <span className="lbl">Record into “{t?.name}”</span>
        <label className="check"><input type="checkbox" checked={m.countIn} onChange={(e) => midi.setOptions({ countIn: e.target.checked })} /> Count-in</label>
        <label className="check"><input type="checkbox" checked={m.metronome} onChange={(e) => midi.setOptions({ metronome: e.target.checked })} /> Metronome</label>
        <span className="lbl">Quantise</span>
        <select value={m.quantize} onChange={(e) => midi.setOptions({ quantize: e.target.value as Quantize })} data-testid="midi-quantize">
          {QUANTIZE.map((q) => <option key={q.id} value={q.id}>{q.label}</option>)}
        </select>
        <select value={m.mode} onChange={(e) => midi.setOptions({ mode: e.target.value as 'merge' | 'replace' })} title="Keep the notes already there, or replace them">
          <option value="merge">add to the notes there</option>
          <option value="replace">replace the notes there</option>
        </select>
        {m.recording
          ? <button className="primary rec on" onClick={() => midi.stopRecording()} data-testid="midi-stop">■ Stop ({m.recording.notes} notes)</button>
          : <button className="primary rec" disabled={!t} onClick={() => midi.startRecording()} data-testid="midi-record">● Record from bar {(state.cursor?.track === state.selTrack ? state.cursor.bar : 0) + 1}</button>}
        {m.lastTake && <span className="sub" data-testid="midi-last">Last take: {m.lastTake.notes} notes, bars {m.lastTake.fromBar + 1}-{m.lastTake.toBar + 1} (Ctrl+Z undoes it)</span>}
      </div>
      {m.error && <div className="problem">{m.error}</div>}
      <div className="sub hint">Recording starts at the edit cursor's bar (or bar 1), plays the song with the count-in and metronome, and writes what you play when you press Stop.</div>
    </div>
  );
}

const DEFAULT_CHART = `{key: G}
[Verse]
|: G | Em | C | D :|
[Chorus]
| C | D | G / Em | C D |
| C | D | G | % |`;

export function ChartDialog({ state, store }: { state: AppState; store: Store }) {
  const editing = state.chart.editing && !!state.song?.chart;
  const [text, setText] = useState(DEFAULT_CHART);
  const [title, setTitle] = useState('New song');
  const [bpm, setBpm] = useState(110);
  const [style, setStyle] = useState<StyleId>('rock');
  const [errors, setErrors] = useState<string[]>([]);
  useEffect(() => {
    if (!state.chart.open) return;
    setErrors([]);
    if (editing) {
      setText(state.song!.chart!.text);
      setTitle(state.song!.title);
      setBpm(state.song!.tempos[0]?.bpm ?? 120);
    }
  }, [state.chart.open]);
  if (!state.chart.open) return null;
  const go = () => {
    try {
      const errs = editing ? store.rebuildChart(text, bpm) : store.createChart(text, { title, bpm, style });
      if (errs.length) store.showInfo('Chart notes: ' + errs.join('; '));
    } catch (e) {
      setErrors([(e as Error).message]);
    }
  };
  return (
    <div className="modal-back" onKeyDown={(e) => e.stopPropagation()}>
      <div className="modal wide" data-testid="chart-dialog">
        <h3 className="mtitle">{editing ? 'Edit chord chart' : 'New song from a chord chart'}</h3>
        <div className="grid2">
          {!editing && <><span>Title</span><input value={title} onChange={(e) => setTitle(e.target.value)} data-testid="chart-title" /></>}
          <span>Tempo</span><span><input type="number" min={30} max={300} value={bpm} onChange={(e) => setBpm(Number(e.target.value))} data-testid="chart-bpm" /> bpm</span>
          {!editing && <><span>Style</span>
            <select value={style} onChange={(e) => setStyle(e.target.value as StyleId)} data-testid="chart-style">
              {STYLE_IDS.map((s) => <option key={s} value={s}>{STYLES[s].name}</option>)}
            </select></>}
        </div>
        <textarea className="chart" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} data-testid="chart-text" rows={12} />
        <div className="sub">
          Bars: <code>| C | Am | F G | % |</code> (% = same as the last bar; <code>C / / G</code> = C for 3 beats, G for 1).
          Repeats <code>|: … :|</code> or <code>:| x3</code>. Sections <code>[Verse]</code>. From the next bar on:
          <code>{'{key: Em}'}</code> <code>{'{3/4}'}</code> <code>{'{tempo: 90}'}</code> <code>{'{accel 140 4}'}</code> <code>{'{rit 70 2}'}</code> (to 140 / 70 bpm over 4 / 2 bars).
        </div>
        {errors.map((e, i) => <div key={i} className="problem">{e}</div>)}
        <div className="rowx right">
          <button onClick={() => store.openChart(false)}>Cancel</button>
          <button className="primary" onClick={go} data-testid="chart-create">{editing ? 'Rebuild song' : 'Create and generate the band'}</button>
        </div>
      </div>
    </div>
  );
}

const KEYS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb',
  'Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'D#m', 'A#m', 'Dm', 'Gm', 'Cm', 'Fm', 'Bbm', 'Ebm', 'Abm'];

export function ChangesDialog({ state, store }: { state: AppState; store: Store }) {
  const song = state.song;
  const bar0 = state.changesBar;
  const [bar, setBar] = useState(1);
  const [key, setKey] = useState('C');
  const [num, setNum] = useState(4);
  const [den, setDen] = useState(4);
  const [onlyOne, setOnlyOne] = useState(false);
  const [bpm, setBpm] = useState(120);
  const [gradual, setGradual] = useState(false);
  const [toBar, setToBar] = useState(5);
  const [toBpm, setToBpm] = useState(90);
  useEffect(() => {
    if (bar0 === null || !song) return;
    const b = Math.min(bar0, song.bars.length - 1);
    setBar(b + 1);
    const h = song.bars[b];
    const tonic = ((h.key.fifths * 7) % 12 + 12) % 12;
    const k = keyName(h.key.mode === 'minor' ? { tonic: (tonic + 9) % 12, mode: 'minor' } : { tonic, mode: 'major' });
    setKey(k.replace(' major', '').replace(' minor', 'm'));
    setNum(h.timeSignature.numerator);
    setDen(h.timeSignature.denominator);
    setBpm(Math.round(tempoAt(song, b)));
    setToBar(Math.min(song.bars.length, b + 5));
    setToBpm(Math.round(tempoAt(song, b) * 0.75));
  }, [bar0]);
  if (bar0 === null || !song) return null;
  const b = Math.max(0, Math.min(song.bars.length - 1, bar - 1));
  return (
    <div className="modal-back" onKeyDown={(e) => e.stopPropagation()}>
      <div className="modal wide" data-testid="changes-dialog">
        <h3 className="mtitle">Key, time signature and tempo</h3>
        <div className="rowx"><span>At bar</span><input type="number" min={1} max={song.bars.length} value={bar} onChange={(e) => setBar(Number(e.target.value))} data-testid="chg-bar" /></div>
        <section className="chg">
          <b>Key</b>
          <select value={key} onChange={(e) => setKey(e.target.value)} data-testid="chg-key">
            {KEYS.map((k) => <option key={k} value={k}>{k.endsWith('m') ? k.slice(0, -1) + ' minor' : k + ' major'}</option>)}
          </select>
          <button data-testid="chg-key-set" onClick={() => { const k = parseKeyName(key); if (k) store.setKeyChange(b, k.fifths, k.mode); }}>Set from bar {b + 1}</button>
          <span className="sub">Until the next key change. Notes are not moved (use Transpose for that).</span>
          <div className="chips">{keyChanges(song).map((c) => {
            const tonic = ((c.key.fifths * 7) % 12 + 12) % 12;
            return (
              <span key={c.bar} className="chip-s">bar {c.bar + 1}: {keyName(c.key.mode === 'minor' ? { tonic: (tonic + 9) % 12, mode: 'minor' } : { tonic, mode: 'major' })}
                {c.bar > 0 && <button onClick={() => store.removeKeyChange(c.bar)} title="Remove">✕</button>}</span>
            );
          })}</div>
        </section>
        <section className="chg">
          <b>Time signature</b>
          <input type="number" min={1} max={32} value={num} onChange={(e) => setNum(Number(e.target.value))} data-testid="chg-num" /> /
          <select value={den} onChange={(e) => setDen(Number(e.target.value))} data-testid="chg-den">
            {[2, 4, 8, 16].map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <label className="check"><input type="checkbox" checked={onlyOne} onChange={(e) => setOnlyOne(e.target.checked)} /> this bar only</label>
          <button data-testid="chg-ts-set" onClick={() => store.setTimeSig(b, num, den, onlyOne ? 1 : undefined)}>Set at bar {b + 1}</button>
          <span className="sub">Bars are refitted (rests fill, notes past the new end are dropped); the band is regenerated if nobody edited it.</span>
          <div className="chips">{timeSigChanges(song).map((c) => <span key={c.bar} className="chip-s">bar {c.bar + 1}: {c.ts.numerator}/{c.ts.denominator}</span>)}</div>
        </section>
        <section className="chg">
          <b>Tempo</b>
          <input type="number" min={20} max={400} value={bpm} onChange={(e) => setBpm(Number(e.target.value))} data-testid="chg-bpm" /> bpm
          <label className="check"><input type="checkbox" checked={gradual} onChange={(e) => setGradual(e.target.checked)} data-testid="chg-gradual" /> gradually to</label>
          {gradual && <>
            <input type="number" min={20} max={400} value={toBpm} onChange={(e) => setToBpm(Number(e.target.value))} data-testid="chg-tobpm" /> bpm by bar
            <input type="number" min={b + 2} max={song.bars.length + 1} value={toBar} onChange={(e) => setToBar(Number(e.target.value))} data-testid="chg-tobar" />
          </>}
          <button data-testid="chg-tempo-set" onClick={() => store.setTempoChange(b, bpm, gradual ? { toBar: Math.max(b + 1, toBar - 1), toBpm } : undefined)}>
            Set at bar {b + 1}
          </button>
          <div className="chips">{tempoChanges(song).map((c) => (
            <span key={c.bar} className="chip-s">bar {c.bar + 1}: {c.bpm}{c.rampTo ? ` → ${c.rampTo.bpm} by bar ${c.rampTo.bar + 1} (${c.rampTo.bpm > c.bpm ? 'accel.' : 'rit.'})` : ''} bpm
              {c.bar > 0 && <button onClick={() => store.removeTempoChange(c.bar)} title="Remove">✕</button>}</span>
          ))}</div>
        </section>
        <div className="rowx right"><button className="primary" onClick={() => store.openChanges(null)}>Done</button></div>
      </div>
    </div>
  );
}

export function HarmonyMenu({ track, store }: { track: Track; store: Store }) {
  if (track.instrument.percussion) return null;
  return (
    <select className="harm" value="" title="Add a harmony line as a new track" data-testid="harmony-menu"
      onChange={(e) => {
        const [i, d] = e.target.value.split(':') as [HarmonyInterval, HarmonyDirection];
        if (i) store.addHarmony(track.id, i, d);
      }}>
      <option value="">Harmony…</option>
      <option value="third:above">3rd above</option>
      <option value="third:below">3rd below</option>
      <option value="sixth:above">6th above</option>
      <option value="sixth:below">6th below</option>
      <option value="octave:above">Octave above</option>
      <option value="octave:below">Octave below</option>
    </select>
  );
}
