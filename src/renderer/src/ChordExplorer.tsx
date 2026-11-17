// Chord explorer: pick root / type / extensions / alterations / bass (or click a chord symbol in
// the score). Shows every practical voicing for the selected track's tuning and capo as chord
// diagrams, plus bass shapes and piano voicings. Click one to hear it; Insert writes it at the
// edit cursor (or bar 1) of the selected track, optionally setting the chord symbol too.
import { useEffect, useState } from 'react';
import {
  ALTERATIONS, durationTicks, EXTENSIONS, FLAT_NAMES, fretVoicings, GUITAR_STANDARD, isFretted, parseChordSpec,
  pianoVoicings, pitchName, setBeatPitches, setChordSymbol, SHARP_NAMES, specName, TRIADS,
  type Alteration, type ChordSpec, type Cursor, type Extension, type FretVoicing, type Song, type Triad,
} from '../../model';
import { liveSynth } from './audio/liveSynth';
import type { AppState, Store } from './store';
import { HelpButton, MoreOptions } from './HelpUi';

const KIND_LABEL: Record<string, string> = {
  open: 'Open shapes', barre: 'Barre shapes up the neck', shape: 'Other shapes', power: 'Power chords', triad: 'Triads on string sets',
  bass: 'Bass shapes', close: 'Piano', inversion: 'Piano', openPiano: 'Piano', drop2: 'Piano',
};

export function ChordDiagram({ v, tuning, capo, onClick, selected, testId }: {
  v: FretVoicing; tuning: number[]; capo: number; onClick?: () => void; selected?: boolean; testId?: string;
}) {
  const n = tuning.length;
  const fretted = v.frets.filter((f): f is number => f !== null && f > capo);
  const min = fretted.length ? Math.min(...fretted) : capo + 1;
  const max = fretted.length ? Math.max(...fretted) : capo + 1;
  const top = max <= capo + 5 ? capo + 1 : min; // first fret row shown
  const rows = Math.max(4, max - top + 1);
  const W = 16 * (n - 1);
  const H = 18 * rows;
  const sx = (s: number) => 12 + s * 16;
  const sy = (f: number) => 22 + (f - top + 0.5) * 18;
  return (
    <svg className={`diagram ${selected ? 'sel' : ''}`} width={W + 30} height={H + 40} onClick={onClick} data-testid={testId}>
      <title>{v.label + ': click to hear it and pick it for Insert'}</title>
      {top === capo + 1 ? <rect x={12} y={18} width={W} height={4} className="nut" /> : <text x={W + 16} y={34} className="fretnum">{top}</text>}
      {Array.from({ length: rows + 1 }, (_, i) => <line key={'f' + i} x1={12} x2={12 + W} y1={22 + i * 18} y2={22 + i * 18} className="fretline" />)}
      {tuning.map((_, s) => <line key={'s' + s} x1={sx(s)} x2={sx(s)} y1={22} y2={22 + H} className="stringline" />)}
      {v.barre && <rect x={sx(v.barre.fromString - 1) - 6} y={sy(v.barre.fret) - 6} width={sx(v.barre.toString - 1) - sx(v.barre.fromString - 1) + 12} height={12} rx={6} className="barre" />}
      {v.frets.map((f, s) => (
        f === null ? <text key={s} x={sx(s)} y={14} className="mark">×</text>
          : f <= capo ? <circle key={s} cx={sx(s)} cy={10} r={4} className="open" />
            : (
              <g key={s}>
                <circle cx={sx(s)} cy={sy(f)} r={6.5} className="dot" />
                {v.fingers[s] ? <text x={sx(s)} y={sy(f) + 3.5} className="finger">{v.fingers[s]}</text> : null}
              </g>
            )
      ))}
      <text x={(W + 24) / 2} y={H + 36} className="notes">{v.pitches.map((p) => pitchName(p).replace(/-?\d+$/, '')).join(' ')}</text>
    </svg>
  );
}

function PianoKeys({ pitches }: { pitches: number[] }) {
  const lo = Math.floor(Math.min(...pitches) / 12) * 12;
  const hi = Math.ceil((Math.max(...pitches) + 1) / 12) * 12;
  const whites: number[] = [];
  for (let p = lo; p < hi; p++) if (![1, 3, 6, 8, 10].includes(p % 12)) whites.push(p);
  const wx = (p: number) => whites.indexOf(p) * 9;
  return (
    <svg width={whites.length * 9 + 1} height={40} className="keys">
      {whites.map((p) => <rect key={p} x={wx(p)} y={0} width={9} height={38} className={pitches.includes(p) ? 'w on' : 'w'} />)}
      {Array.from({ length: hi - lo }, (_, k) => lo + k).filter((p) => [1, 3, 6, 8, 10].includes(p % 12)).map((p) => (
        <rect key={p} x={wx(p - 1) + 6} y={0} width={6} height={24} className={pitches.includes(p) ? 'b on' : 'b'} />
      ))}
    </svg>
  );
}

/** Where Insert writes: the edit cursor if on this track, else the first beat of the bar shown in the player. */
function insertCursor(state: AppState, ti: number, bar: number): Cursor {
  const c = state.cursor;
  if (c && c.track === ti) return c;
  return { track: ti, staff: 0, bar, voice: 0, beat: 0, string: 1 };
}

function beatTick(song: Song, c: Cursor): number {
  const beats = song.tracks[c.track].staves[c.staff].measures[c.bar].voices[c.voice]?.beats ?? [];
  let t = 0;
  for (let i = 0; i < c.beat && i < beats.length; i++) if (!beats[i].grace) t += durationTicks(beats[i].duration);
  return t;
}

export function ChordExplorer({ state, store, currentBar }: { state: AppState; store: Store; currentBar: number }) {
  const song = state.song!;
  const ti = Math.min(state.selTrack, song.tracks.length - 1);
  const t = song.tracks[ti];
  const flats = (song.bars[0]?.key.fifths ?? 0) < 0;
  const names = flats ? FLAT_NAMES : SHARP_NAMES;
  const [spec, setSpec] = useState<ChordSpec>(() => parseChordSpec(state.explore ?? 'C')!);
  const [text, setText] = useState(state.explore ?? 'C');
  const [selKey, setSelKey] = useState<string | null>(null);
  const [setSymbol, setSetSymbol] = useState(true);
  useEffect(() => {
    if (state.explore) {
      const c = parseChordSpec(state.explore);
      if (c) {
        setSpec(c);
        setText(state.explore);
      }
    }
  }, [state.explore]);
  const name = specName(spec, flats);
  const upd = (p: Partial<ChordSpec>) => {
    const next = { ...spec, ...p };
    if (p.root !== undefined && spec.bass === spec.root) next.bass = p.root;
    setSpec(next);
    setText(specName(next, flats));
    setSelKey(null);
  };
  const fretted = isFretted(t);
  const tuning = fretted ? t.tuning! : GUITAR_STANDARD;
  const capo = fretted ? t.capo ?? 0 : 0;
  const fv = t.instrument.percussion ? [] : fretVoicings(spec, tuning, capo);
  const pv = pianoVoicings(spec);
  const groups = new Map<string, FretVoicing[]>();
  for (const v of fv) groups.set(KIND_LABEL[v.kind], [...(groups.get(KIND_LABEL[v.kind]) ?? []), v]);
  const program = t.instrument.percussion ? 0 : t.instrument.program;
  const hear = (pitches: number[], key: string) => {
    setSelKey(key);
    void liveSynth.playChord(pitches, program, false);
  };
  const selected = selKey?.startsWith('f') ? fv[Number(selKey.slice(1))] : null;
  const selectedPiano = selKey?.startsWith('p') ? pv[Number(selKey.slice(1))] : null;
  const bar = state.cursor?.track === ti ? state.cursor.bar : currentBar;
  const insert = () => {
    const c = insertCursor(state, ti, bar);
    let pitches: number[] = [];
    let pos: { string: number; fret: number }[] | undefined;
    if (selected && fretted) {
      pitches = selected.frets.map((f, s) => (f === null ? null : tuning[s] + f)).filter((p): p is number => p !== null);
      pos = selected.frets.map((f, s) => (f === null ? null : { string: s + 1, fret: f })).filter((x): x is { string: number; fret: number } => !!x);
    } else if (selectedPiano) pitches = selectedPiano.pitches;
    else if (selected) pitches = selected.pitches;
    if (!pitches.length) return;
    store.tryEdit((s) => {
      let n = setBeatPitches(s, c, pitches, 96, pos);
      if (setSymbol) n = setChordSymbol(n, c.bar, beatTick(s, c), name);
      return n;
    }, 'Insert ' + name);
  };
  const insertWhere = state.cursor?.track === ti ? `bar ${state.cursor.bar + 1}, beat ${state.cursor.beat + 1}` : `bar ${bar + 1}, beat 1`;

  return (
    <div className="ce" data-testid="chord-explorer">
      <div className="pr-tools">
        <HelpButton topic="chord-explorer" />
        <input className="name" value={text} data-testid="ce-name" title="Type a chord name (e.g. C, Am, G7, D/F#) and press Enter to see every way to play it"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { const c = parseChordSpec(text); if (c) { setSpec(c); setSelKey(null); } } e.stopPropagation(); }}
          onBlur={() => { const c = parseChordSpec(text); if (c) setSpec(c); }} />
        <select value={spec.root} onChange={(e) => upd({ root: Number(e.target.value) })} title="Root: the note the chord is named after (the C in C major)">
          {names.map((n, i) => <option key={n} value={i}>{n}</option>)}
        </select>
        <select value={spec.triad} onChange={(e) => upd({ triad: e.target.value as Triad })} title="Chord type: major sounds bright, minor sounds sad; sus, dim and aug are more colourful">
          {TRIADS.map((q) => <option key={q.id} value={q.id}>{q.label}</option>)}
        </select>
        <select value={spec.ext} onChange={(e) => upd({ ext: e.target.value as Extension })} title="Add a 7th, 9th, … for a richer, jazzier sound (no extension = plain chord)">
          {EXTENSIONS.map((x) => <option key={x.id} value={x.id}>{x.id ? x.label : 'no extension'}</option>)}
        </select>
        <MoreOptions title="Altered notes (b5, #9, …) and a different bass note (slash chords like D/F#)">
          {ALTERATIONS.map((a) => (
            <label key={a} className="check" title={`Alteration ${a}: raise or lower that note of the chord for a tenser, jazzier sound`}><input type="checkbox" checked={spec.alt.includes(a)}
              onChange={(e) => upd({ alt: e.target.checked ? [...spec.alt, a] : spec.alt.filter((x: Alteration) => x !== a) })} />{a}</label>
          ))}
          <select value={spec.bass} onChange={(e) => upd({ bass: Number(e.target.value) })} title="Bass note (slash chord, e.g. C/G = C chord with G in the bass). Use for smooth bass lines">
            {names.map((n, i) => <option key={n} value={i}>{i === spec.root ? 'bass = root' : '/' + n}</option>)}
          </select>
        </MoreOptions>
        <b className="ce-title" data-testid="ce-title">{name}</b>
      </div>
      <div className="pr-tools">
        <span className="sub">
          {fretted ? `${t.name}: ${tuning.map((p) => pitchName(p).replace(/-?\d+$/, '')).join(' ')}${capo ? `, capo ${capo}` : ''}` : t.instrument.percussion ? 'Drum track: pick a pitched track' : `${t.name} (shapes shown for a guitar in standard tuning)`}
          {' · '}{fv.length} shapes, {pv.length} piano voicings
        </span>
        <label className="check" title="Also write the chord name above the score here, so the band and chord charts follow it"><input type="checkbox" checked={setSymbol} onChange={(e) => setSetSymbol(e.target.checked)} /> also set the chord symbol</label>
        <button className="primary" disabled={!selKey || t.instrument.percussion} onClick={insert} data-testid="ce-insert"
          title="Write the chord shape you clicked into the selected track at this spot (click a diagram first to choose one)">Insert at {insertWhere}</button>
        <button onClick={() => store.tryEdit((s) => setChordSymbol(s, bar, 0, name), 'Chord ' + name)} title="Only write the chord name above this bar (no notes). The band plays chords from these names">Set symbol at bar {bar + 1}</button>
      </div>
      <div className="ce-body">
        {[...groups.entries()].map(([label, list]) => (
          <div key={label} className="ce-group">
            <div className="ce-glabel">{label}</div>
            <div className="ce-row">
              {list.map((v) => {
                const k = 'f' + fv.indexOf(v);
                return <ChordDiagram key={k} v={v} tuning={tuning} capo={capo} selected={selKey === k} onClick={() => hear(v.pitches, k)} testId={'ce-' + k} />;
              })}
            </div>
          </div>
        ))}
        <div className="ce-group">
          <div className="ce-glabel">Piano voicings</div>
          <div className="ce-row">
            {pv.map((v, i) => (
              <div key={i} className={`pv ${selKey === 'p' + i ? 'sel' : ''}`} onClick={() => hear(v.pitches, 'p' + i)} data-testid={'ce-p' + i} title={`${v.label}: click to hear it and pick it for Insert`}>
                <PianoKeys pitches={v.pitches} />
                <div className="sub">{v.label}</div>
                <div className="notes">{v.pitches.map((p) => pitchName(p)).join(' ')}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
