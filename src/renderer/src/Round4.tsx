// Round 4 UI: the MIDI panel, the keyboard piano toggle, the chord chart dialog, the key / time / tempo changes dialog, and the harmony menu.
import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  keyChanges, keyName, parseKeyName, QUANTIZE, STYLE_IDS, STYLES, tempoAt, tempoChanges, timeSigChanges,
  type HarmonyDirection, type HarmonyInterval, type Quantize, type StyleId, type Track,
} from '../../model';
import type { MidiController, MidiState } from './midi';
import type { KeyboardPiano } from './kbdPiano';
import type { PlayerStatus } from './player';
import type { AppState, Store } from './store';
import { HelpButton, MoreOptions } from './HelpUi';

function useMidi(midi: MidiController): MidiState {
  return useSyncExternalStore((f) => midi.on(f), () => midi.state);
}

export const kbdCtl: { current: KeyboardPiano | null } = { current: null };

/** Keyboard piano on/off with its octave and velocity. */
export function KbdPianoToggle({ state, store }: { state: AppState; store: Store }) {
  const k = useSyncExternalStore((f) => kbdCtl.current?.on(f) ?? (() => {}), () => kbdCtl.current?.state ?? null);
  return (
    <label className={`toggle ${state.kbdPiano ? 'on kbd-on' : ''}`} data-testid="kbd-piano"
      title="Play notes with the computer keyboard when you have no MIDI keyboard: A S D F G H J K L = white keys, W E T Y U O P = black keys, Z/X octave, C/V loudness (velocity). While on, those keys are the piano's.">
      <input type="checkbox" checked={state.kbdPiano} onChange={(e) => { store.setKbdPiano(e.target.checked); if (!e.target.checked) kbdCtl.current?.allOff(); }} />
      ⌨ Keyboard piano{state.kbdPiano && k ? ` (C${k.octave}, loudness ${k.velocity})` : ''}
    </label>
  );
}

const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function MidiPanel({ state, store, midi }: { state: AppState; store: Store; midi: MidiController }) {
  const m = useMidi(midi);
  useEffect(() => void midi.init(), []);
  const t = state.song!.tracks[state.selTrack];
  return (
    <div className="midi" data-testid="midi-panel">
      <div className="pr-tools">
        <HelpButton topic="midi-keyboard" />
        <span className="lbl">MIDI keyboard</span>
        <select value={m.inputId ?? ''} onChange={(e) => midi.select(e.target.value || null)} data-testid="midi-input" title="Which plugged-in MIDI keyboard to listen to. Plug it in, then press ↻ if it is not listed">
          <option value="">{m.inputs.length ? 'none' : m.supported ? 'no MIDI keyboard found' : 'MIDI not supported'}</option>
          {m.inputs.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
        <button onClick={() => void midi.init()} title="Look for MIDI keyboards again (after plugging one in)">↻</button>
        <KbdPianoToggle state={state} store={store} />
        <label className="check" title="Hear what you play with the selected track's instrument (monitor). Turn off if your keyboard makes its own sound"><input type="checkbox" checked={m.monitor} onChange={(e) => midi.setOptions({ monitor: e.target.checked })} /> Play through “{t?.name}”</label>
        <label className="check" title="One note at a time (step entry): each key (or chord) you press is written at the edit cursor, which then moves on. No timing needed: good for writing slowly. Turns on ✎ Write notes">
          <input type="checkbox" checked={m.step} onChange={(e) => { midi.setOptions({ step: e.target.checked }); if (e.target.checked && !state.editMode) store.setEditMode(true); }} /> One note at a time (step entry)
        </label>
        <span className="sub" title="The keys you are holding down right now">Keys: {m.held.length ? m.held.map((p) => NOTE[p % 12] + (Math.floor(p / 12) - 1)).join(' ') : '–'}</span>
      </div>
      <div className="pr-tools">
        <span className="lbl">Record into “{t?.name}”</span>
        <label className="check" title="Count-in: one bar of clicks before recording starts, so you can come in on time"><input type="checkbox" checked={m.countIn} onChange={(e) => midi.setOptions({ countIn: e.target.checked })} /> Count-in (clicks before playing)</label>
        <label className="check" title="Click on every beat while recording, to help you keep time"><input type="checkbox" checked={m.metronome} onChange={(e) => midi.setOptions({ metronome: e.target.checked })} /> Metronome</label>
        {m.recording
          ? <button className="primary rec on" onClick={() => midi.stopRecording()} data-testid="midi-stop" title="Stop recording and write what you played into the track">■ Stop ({m.recording.notes} notes)</button>
          : <button className="primary rec" disabled={!t} onClick={() => midi.startRecording()} data-testid="midi-record" title="Record what you play on the keyboard into the selected track, starting at the edit cursor's bar">● Record from bar {(state.cursor?.track === state.selTrack ? state.cursor.bar : 0) + 1}</button>}
        <MoreOptions title="Snap to grid and whether a take adds to or replaces the notes already there">
          <label className="lbl" title="Snap to grid (quantise): moves the notes you played onto the nearest step so they line up neatly. Pick a finer step for fast playing, none to keep your exact timing">Snap to grid
            <select value={m.quantize} onChange={(e) => midi.setOptions({ quantize: e.target.value as Quantize })} data-testid="midi-quantize">
              {QUANTIZE.map((q) => <option key={q.id} value={q.id}>{q.label}</option>)}
            </select>
          </label>
          <select value={m.mode} onChange={(e) => midi.setOptions({ mode: e.target.value as 'merge' | 'replace' })} title="Keep the notes already there and add the take (merge), or replace them with the take">
            <option value="merge">add to the notes there</option>
            <option value="replace">replace the notes there</option>
          </select>
        </MoreOptions>
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
        <h3 className="mtitle">{editing ? 'Edit chord chart' : 'Start from chords'} <HelpButton topic="chord-chart" label="dialog" /></h3>
        <div className="grid2">
          {!editing && <><span>Title</span><input value={title} onChange={(e) => setTitle(e.target.value)} data-testid="chart-title" title="The song's name" /></>}
          <span>Tempo</span><span><input type="number" min={30} max={300} value={bpm} onChange={(e) => setBpm(Number(e.target.value))} data-testid="chart-bpm" title="Speed in beats per minute (bpm): 60 = slow, 120 = medium, 160+ = fast" /> bpm</span>
          {!editing && <><span>Style</span>
            <select value={style} onChange={(e) => setStyle(e.target.value as StyleId)} data-testid="chart-style" title="The kind of band that plays your chords (rock, pop, jazz …). You can change it later in the Band panel">
              {STYLE_IDS.map((s) => <option key={s} value={s}>{STYLES[s].name}</option>)}
            </select></>}
        </div>
        <textarea className="chart" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} data-testid="chart-text" rows={12}
          title="Type the chords bar by bar between | signs, e.g. | C | Am | F G |. See the examples below" />
        <div className="sub">
          Bars: <code>| C | Am | F G | % |</code> (% = same as the last bar; <code>C / / G</code> = C for 3 beats, G for 1).
          Repeats <code>|: … :|</code> or <code>:| x3</code>. Sections <code>[Verse]</code>. From the next bar on:
          <code>{'{key: Em}'}</code> <code>{'{3/4}'}</code> <code>{'{tempo: 90}'}</code> <code>{'{accel 140 4}'}</code> <code>{'{rit 70 2}'}</code> (to 140 / 70 bpm over 4 / 2 bars).
        </div>
        {errors.map((e, i) => <div key={i} className="problem">{e}</div>)}
        <div className="rowx right">
          <button onClick={() => store.openChart(false)} title="Close without changing anything">Cancel</button>
          <button className="primary" onClick={go} data-testid="chart-create" title={editing ? 'Rebuild the song from the edited chords (the band is regenerated)' : 'Make the song from these chords and let the band play them'}>{editing ? 'Rebuild song' : 'Create and generate the band'}</button>
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
        <h3 className="mtitle">Key, time signature and tempo <HelpButton topic="song-changes" label="dialog" /></h3>
        <div className="rowx"><span>At bar</span><input type="number" min={1} max={song.bars.length} value={bar} onChange={(e) => setBar(Number(e.target.value))} data-testid="chg-bar" title="The bar where the change starts" /></div>
        <section className="chg">
          <b>Key</b>
          <select value={key} onChange={(e) => setKey(e.target.value)} data-testid="chg-key" title="The key (home note and scale). Changes the key signature and the chords the tools suggest; notes stay as they are">
            {KEYS.map((k) => <option key={k} value={k}>{k.endsWith('m') ? k.slice(0, -1) + ' minor' : k + ' major'}</option>)}
          </select>
          <button data-testid="chg-key-set" title="Change the key from this bar until the next key change" onClick={() => { const k = parseKeyName(key); if (k) store.setKeyChange(b, k.fifths, k.mode); }}>Set from bar {b + 1}</button>
          <span className="sub">Until the next key change. Notes are not moved (use Transpose for that).</span>
          <div className="chips">{keyChanges(song).map((c) => {
            const tonic = ((c.key.fifths * 7) % 12 + 12) % 12;
            return (
              <span key={c.bar} className="chip-s">bar {c.bar + 1}: {keyName(c.key.mode === 'minor' ? { tonic: (tonic + 9) % 12, mode: 'minor' } : { tonic, mode: 'major' })}
                {c.bar > 0 && <button onClick={() => store.removeKeyChange(c.bar)} title="Remove this key change (the previous key carries on)">✕</button>}</span>
            );
          })}</div>
        </section>
        <section className="chg">
          <b>Time signature</b>
          <input type="number" min={1} max={32} value={num} onChange={(e) => setNum(Number(e.target.value))} data-testid="chg-num" title="Beats per bar (the top number): 4 for most pop/rock, 3 for a waltz" /> /
          <select value={den} onChange={(e) => setDen(Number(e.target.value))} data-testid="chg-den" title="Which note counts as one beat (the bottom number): 4 = quarter note, 8 = eighth note (6/8 feels like two big beats)">
            {[2, 4, 8, 16].map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <label className="check" title="Change only this one bar, then go back to the time signature before it"><input type="checkbox" checked={onlyOne} onChange={(e) => setOnlyOne(e.target.checked)} /> this bar only</label>
          <button data-testid="chg-ts-set" title="Change the time signature from this bar on (or for this bar only)" onClick={() => store.setTimeSig(b, num, den, onlyOne ? 1 : undefined)}>Set at bar {b + 1}</button>
          <span className="sub">Bars are refitted (rests fill, notes past the new end are dropped); the band is regenerated if nobody edited it.</span>
          <div className="chips">{timeSigChanges(song).map((c) => <span key={c.bar} className="chip-s">bar {c.bar + 1}: {c.ts.numerator}/{c.ts.denominator}</span>)}</div>
        </section>
        <section className="chg">
          <b>Tempo</b>
          <input type="number" min={20} max={400} value={bpm} onChange={(e) => setBpm(Number(e.target.value))} data-testid="chg-bpm" title="Speed in beats per minute (bpm) from this bar on" /> bpm
          <label className="check" title="Speed up or slow down smoothly over several bars (accelerando / ritardando) instead of jumping"><input type="checkbox" checked={gradual} onChange={(e) => setGradual(e.target.checked)} data-testid="chg-gradual" /> gradually to</label>
          {gradual && <>
            <input type="number" min={20} max={400} value={toBpm} onChange={(e) => setToBpm(Number(e.target.value))} data-testid="chg-tobpm" title="The speed to reach at the end of the gradual change" /> bpm by bar
            <input type="number" min={b + 2} max={song.bars.length + 1} value={toBar} onChange={(e) => setToBar(Number(e.target.value))} data-testid="chg-tobar" title="The bar where the gradual change has reached the new speed" />
          </>}
          <button data-testid="chg-tempo-set" title="Change the speed from this bar on (or ramp to the new speed)" onClick={() => store.setTempoChange(b, bpm, gradual ? { toBar: Math.max(b + 1, toBar - 1), toBpm } : undefined)}>
            Set at bar {b + 1}
          </button>
          <div className="chips">{tempoChanges(song).map((c) => (
            <span key={c.bar} className="chip-s">bar {c.bar + 1}: {c.bpm}{c.rampTo ? ` → ${c.rampTo.bpm} by bar ${c.rampTo.bar + 1} (${c.rampTo.bpm > c.bpm ? 'accel.' : 'rit.'})` : ''} bpm
              {c.bar > 0 && <button onClick={() => store.removeTempoChange(c.bar)} title="Remove this tempo change (the previous speed carries on)">✕</button>}</span>
          ))}</div>
        </section>
        <div className="rowx right"><button className="primary" onClick={() => store.openChanges(null)} title="Close this dialog (changes are already made; Ctrl+Z undoes them)">Done</button></div>
      </div>
    </div>
  );
}

export function HarmonyMenu({ track, store }: { track: Track; store: Store }) {
  if (track.instrument.percussion) return null;
  return (
    <select className="harm" value="" title="Add a harmony part: a new track that follows this one a 3rd, 6th or octave higher or lower. Use it to make a melody sound fuller" data-testid="harmony-menu"
      onChange={(e) => {
        const [i, d] = e.target.value.split(':') as [HarmonyInterval, HarmonyDirection];
        if (i) store.addHarmony(track.id, i, d);
      }}>
      <option value="">Add a harmony part…</option>
      <option value="third:above">3rd above</option>
      <option value="third:below">3rd below</option>
      <option value="sixth:above">6th above</option>
      <option value="sixth:below">6th below</option>
      <option value="octave:above">Octave above</option>
      <option value="octave:below">Octave below</option>
    </select>
  );
}
