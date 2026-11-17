// Chord progression helper: the key at the selected bar, its diatonic chords, what could come
// next, substitutions for the chord there, and a library of progressions that insert as chord
// symbols over the selected bars (transposed to the key).
import { useState } from 'react';
import {
  chordBefore, diatonicChords, insertChordBars, keyName, keyOfBar, parseChordSpec, PROGRESSIONS, progressionChords,
  substitutions, suggestNext, type Suggestion,
} from '../../model';
import { liveSynth } from './audio/liveSynth';
import type { PlayerStatus } from './player';
import type { AppState, Store } from './store';
import { HelpButton } from './HelpUi';

const KIND: Record<Suggestion['kind'], string> = {
  next: 'Next', substitute: 'Swap in', secondary: 'Leads into the next chord (secondary dominant)', tritone: 'Jazzy swap (tritone sub)', borrowed: 'Borrowed from the other mode (major/minor)', relative: 'Relative (shares most notes)',
};

function hearChord(name: string, program: number) {
  const c = parseChordSpec(name);
  if (!c) return;
  const ps: number[] = [];
  let p = 48 + c.bass;
  ps.push(p);
  const ivs = [0, c.triad === 'min' || c.triad === 'dim' ? 3 : c.triad === 'sus2' ? 2 : c.triad === 'sus4' ? 5 : 4, c.triad === 'dim' ? 6 : c.triad === 'aug' ? 8 : 7];
  for (const i of ivs) {
    p = 60 + ((c.root + i) % 12);
    ps.push(p);
  }
  void liveSynth.playChord(ps, program, false, 900, 0);
}

export function Progressions({ state, store, status }: { state: AppState; store: Store; status: PlayerStatus | null }) {
  const song = state.song!;
  const range = status?.range;
  const from = range?.startBar ?? state.cursor?.bar ?? status?.currentBar ?? 0;
  const [pid, setPid] = useState(PROGRESSIONS[0].id);
  const key = keyOfBar(song, from);
  const cur = chordBefore(song, from);
  const prev = from > 0 ? chordBefore(song, from - 1) : null;
  const p = PROGRESSIONS.find((x) => x.id === pid)!;
  const chords = progressionChords(p, key);
  const to = range ? range.endBar : Math.min(song.bars.length - 1, from + p.bars.length - 1);
  const t = song.tracks[state.selTrack];
  const program = t && !t.instrument.percussion ? t.instrument.program : 0;
  const setBar = (name: string) => store.tryEdit((s) => insertChordBars(s, from, from, [[name]]), 'Chord ' + name + ' at bar ' + (from + 1));
  const chip = (s: { name: string; roman: string; why?: string }, k: string) => (
    <span key={k} className="pchip" title={s.why}>
      <button className="pname" onClick={() => hearChord(s.name, program)} title={'Hear ' + s.name + (s.why ? ': ' + s.why : '')}>{s.name}</button>
      <small>{s.roman}</small>
      <button onClick={() => setBar(s.name)} title={`Put ${s.name} as the chord of bar ${from + 1} (the band will play it)`} data-testid={'pg-set-' + s.name}>⤓</button>
    </span>
  );
  const next = suggestNext(prev ?? cur, key);
  const subs = cur ? substitutions(cur, key) : [];

  return (
    <div className="pg" data-testid="progressions">
      <div className="pr-tools">
        <HelpButton topic="progressions" />
        <b title="The key (home note and scale) at this bar: the chords below fit it">{keyName(key)}</b>
        <span className="sub">at bar {from + 1}{range ? ` (selected bars ${range.startBar + 1}-${range.endBar + 1})` : ''} · chord here: {cur ?? 'none'}</span>
        <button onClick={() => store.openChanges(from)} title="Change the key from this bar on (Song menu > Key, time and tempo). Use when the song moves to a new home note">Key change…</button>
      </div>
      <div className="pg-row"><span className="lbl" title="Chords built from the notes of the key: they always fit">In the key</span>{diatonicChords(key).map((c, i) => chip(c, 'd' + i))}</div>
      <div className="pg-row"><span className="lbl">After {prev ?? 'the start'}</span>{next.filter((x) => x.kind === 'next').map((s, i) => chip(s, 'n' + i))}</div>
      <div className="pg-row"><span className="lbl" title="Less obvious chords that still work: add surprise or colour">Surprise / colour</span>{next.filter((x) => x.kind !== 'next').map((s, i) => chip({ ...s, why: KIND[s.kind] + ': ' + s.why }, 'c' + i))}</div>
      {cur && <div className="pg-row"><span className="lbl">Instead of {cur}</span>{subs.map((s, i) => chip({ ...s, why: KIND[s.kind] + ': ' + s.why }, 's' + i))}</div>}
      <div className="pr-tools">
        <span className="lbl">Common progressions</span>
        <select value={pid} onChange={(e) => setPid(e.target.value)} data-testid="pg-lib" title="Well-known chord sequences (pop, blues, jazz …), moved into this song's key">
          {PROGRESSIONS.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <span className="pg-preview" data-testid="pg-preview">{chords.map((b) => b.join(' ')).join(' | ')}</span>
        <button className="primary" data-testid="pg-insert" title="Write this progression as the chords of these bars (it repeats to fill a selection). Quick start for a song's harmony" onClick={() => store.tryEdit((s) => insertChordBars(s, from, to, chords), p.name + ' at bars ' + (from + 1) + '-' + (to + 1))}>
          Insert over bars {from + 1}-{to + 1}
        </button>
      </div>
      <div className="sub hint">Click a chord to hear it, ⤓ to put it at bar {from + 1}. Drag over bars in the score to choose where a progression goes (it repeats to fill them).</div>
    </div>
  );
}
