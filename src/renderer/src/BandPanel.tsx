// Right-hand panel (Arrange workspace): chords, sections and the virtual band. Expert knobs
// (complexity, octave, seed, redo one part) sit behind More options.
import { useState } from 'react';
import {
  findInstrument, INSTRUMENT_GROUPS, INSTRUMENTS, ROLE_NAMES, SECTION_NAMES, sectionRanges, STYLE_IDS, STYLES,
  type BandRole, type Complexity,
} from '../../model';
import type { PlayerStatus } from './player';
import type { AppState, Store } from './store';
import { HelpButton, MoreOptions } from './HelpUi';

const ROLE_GROUPS: Record<BandRole, string[]> = {
  drums: ['Drums'],
  bass: ['Basses', 'Strings', 'Brass', 'Synths', 'Keys'],
  rhythm: ['Guitars', 'Keys', 'Strings', 'Brass', 'Synths'],
  lead: ['Guitars', 'Keys', 'Strings', 'Brass', 'Winds', 'Synths'],
};

export function BandPanel({ state, store, status }: { state: AppState; store: Store; status: PlayerStatus | null }) {
  const song = state.song;
  const band = state.band;
  const [replaceChords, setReplaceChords] = useState(false);
  const [sectionName, setSectionName] = useState('Verse');
  const [regenSection, setRegenSection] = useState<string>('all');
  const [regenRole, setRegenRole] = useState<string>('all');
  if (!song || !band) return null;
  const sections = sectionRanges(song);
  const generated = song.tracks.filter((t) => t.generated);
  const sources = song.tracks.filter((t) => !t.generated && !t.instrument.percussion);
  const range = status?.range;
  const swing = song.playback?.swing ?? 0;

  return (
    <aside className="band" data-testid="band-panel">
      <section>
        <h3 title="Chord symbols (like C, Am, G7) above the music: the band plays along to them">Chords <HelpButton topic="band" label="band panel" /></h3>
        <div className="sub">{song.chordSymbols.length ? `${song.chordSymbols.length} chord symbols. Click one in the score to change it.` : 'No chord symbols yet.'}</div>
        <div className="rowx">
          <button onClick={() => store.detectChords(replaceChords)} data-testid="detect-chords"
            title="Work out the chords from the notes and write them above the music, e.g. before generating a band for a melody">Find the chords</button>
          <label className="check" title="Also overwrite the chord symbols that came with the file, e.g. if they look wrong">
            <input type="checkbox" checked={replaceChords} onChange={(e) => setReplaceChords(e.target.checked)} /> Also replace the file's chords
          </label>
        </div>
      </section>

      <section>
        <h3 title="Parts of the song (intro, verse, chorus…): the band plays each part a little differently">Sections</h3>
        <div className="chips">
          {song.sections.length === 0 && <span className="sub">None: the band treats the song as one section.</span>}
          {sections.filter((s) => song.sections.some((x) => x.bar === s.startBar)).map((s) => (
            <span key={s.startBar} className="chip-s">
              {s.name} <small>{s.startBar + 1}–{s.endBar}</small>
              <button title="Remove this section name (the music stays), e.g. if it was put on the wrong bars" onClick={() => store.removeSection(s.startBar)}>✕</button>
            </span>
          ))}
        </div>
        <div className="rowx">
          <select value={sectionName} onChange={(e) => setSectionName(e.target.value)} title="The name to give the selected bars (verse, chorus…), so the band changes with the song">
            {SECTION_NAMES.map((n) => <option key={n}>{n}</option>)}
          </select>
          <button disabled={!range} onClick={() => range && store.setSection(range.startBar, range.endBar, sectionName)}
            title="Give the bars you selected this section name; select bars first by dragging across them in the score">
            {range ? `Name bars ${range.startBar + 1}–${range.endBar + 1}` : 'Select bars first'}
          </button>
        </div>
      </section>

      <section>
        <h3 title="A virtual band (drums, bass, rhythm, lead) that plays along to the song's chords">Band</h3>
        <div className="grid2">
          <label title="The kind of music the band plays (rock, jazz, folk…)">Style</label>
          <select value={band.style} data-testid="style" onChange={(e) => store.setStyle(e.target.value as never)}
            title="The kind of music the band plays (rock, jazz, folk…): pick one that suits your song, then Generate">
            {STYLE_IDS.map((s) => <option key={s} value={s}>{STYLES[s].name}</option>)}
          </select>
          <label title="The track the band follows (its chords and length)">Play along to</label>
          <select value={band.sourceTrackId ?? sources[0]?.id} onChange={(e) => store.setBand({ sourceTrackId: e.target.value })}
            title="Which of your tracks the band follows (its chords and length), e.g. the melody or the piano">
            {sources.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div className="sub">{STYLES[band.style].blurb}</div>
        <table className="lineup">
          <tbody>
            {band.players.map((p) => (
              <tr key={p.role}>
                <td>
                  <label className="check" title={`Include a ${ROLE_NAMES[p.role].toLowerCase()} player in the band; untick to leave that part out`}>
                    <input type="checkbox" checked={p.on} onChange={(e) => store.setPlayer(p.role, { on: e.target.checked })} /> {ROLE_NAMES[p.role]}
                  </label>
                </td>
                <td>
                  {p.role === 'drums' ? (
                    <span className="sub" title="A standard drum kit (General MIDI)">Standard drum kit</span>
                  ) : (
                    <select value={p.instrumentId} disabled={!p.on} onChange={(e) => store.setPlayer(p.role, { instrumentId: e.target.value })}
                      title={`The instrument the ${ROLE_NAMES[p.role].toLowerCase()} player uses: change it any time, the notes stay the same`}>
                      {INSTRUMENT_GROUPS.filter((g) => ROLE_GROUPS[p.role].includes(g)).map((g) => (
                        <optgroup key={g} label={g}>
                          {INSTRUMENTS.filter((i) => i.group === g).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                        </optgroup>
                      ))}
                    </select>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="rowx wrap">
          <label className="check" title="The bass plays together with the kick drum for a tighter groove; untick for a looser bass line">
            <input type="checkbox" checked={band.bassFollowsKick} onChange={(e) => store.setBand({ bassFollowsKick: e.target.checked })} /> Bass plays with the kick drum
          </label>
          <label className="check" title="End the song by holding the last chord instead of just stopping">
            <input type="checkbox" checked={band.ending} onChange={(e) => store.setBand({ ending: e.target.checked })} /> Ending (hold last chord)
          </label>
        </div>
        <div className="rowx">
          <button className="primary" data-testid="generate" onClick={() => store.generate()}
            title="Write the band's parts for the whole song with these settings; press Play to hear them (you can undo)">Generate</button>
          <button onClick={() => store.tryAnother()} disabled={!generated.length}
            title="Same settings, new random choices: use it if you don't like what the band played">Try another</button>
        </div>
        <div className="rowx">
          <label className="speed" title="Swing feel: makes the rhythm bounce like jazz or blues when played (the written notes stay straight)">
            Feel
            <input type="range" min={0} max={1} step={0.05} value={swing} onChange={(e) => store.setSwing(Number(e.target.value))} />
            <span className="val">{swing === 0 ? 'straight' : `swing ${Math.round(swing * 100)}%`}</span>
          </label>
        </div>
        <MoreOptions title="How busy each player is, the lead's octave, the random seed, and redoing one part only">
          <table className="lineup">
            <tbody>
              {band.players.map((p) => (
                <tr key={p.role}>
                  <td>{ROLE_NAMES[p.role]}</td>
                  <td>
                    <select value={p.complexity} disabled={!p.on} onChange={(e) => store.setPlayer(p.role, { complexity: e.target.value as Complexity })}
                      title={`How many notes the ${ROLE_NAMES[p.role].toLowerCase()} player plays (complexity): Simple for calm songs, Busy for lively ones`}>
                      <option value="simple">Simple</option>
                      <option value="normal">Normal</option>
                      <option value="busy">Busy</option>
                    </select>
                    {p.role === 'lead' && (
                      <select value={p.octave ?? 0} disabled={!p.on} onChange={(e) => store.setPlayer('lead', { octave: Number(e.target.value) })}
                        title="Move the lead part up or down by octaves, e.g. if it clashes with the melody">
                        {[-2, -1, 0, 1, 2].map((o) => <option key={o} value={o}>{o > 0 ? `+${o}` : o} oct</option>)}
                      </select>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="sub" title="The random number behind the band's choices: the same seed and settings always give the same parts">seed {band.seed}</div>
          <div className="rowx">
            <select value={regenSection} onChange={(e) => setRegenSection(e.target.value)} disabled={!generated.length}
              title="Which part of the song to redo: pick a section to change only those bars">
              <option value="all">Whole song</option>
              {sections.map((s) => <option key={s.startBar} value={s.startBar}>{s.name} (bars {s.startBar + 1}–{s.endBar})</option>)}
            </select>
            <select value={regenRole} onChange={(e) => setRegenRole(e.target.value)} disabled={!generated.length}
              title="Which player to redo: pick one to change only that part">
              <option value="all">All players</option>
              {generated.map((t) => <option key={t.id} value={t.generated!.role}>{ROLE_NAMES[t.generated!.role]}</option>)}
            </select>
            <button disabled={!generated.length || (regenSection === 'all' && regenRole === 'all')}
              title="Redo only the chosen section and/or player, keeping the rest; pick a section or a player first"
              onClick={() => store.regenerate({
                sectionStartBar: regenSection === 'all' ? undefined : Number(regenSection),
                role: regenRole === 'all' ? undefined : (regenRole as BandRole),
              })}>Redo just this part</button>
          </div>
        </MoreOptions>
        {generated.length > 0 && (
          <div className="sub">
            Band: {generated.map((t) => `${ROLE_NAMES[t.generated!.role]} – ${findInstrument(t.instrument.id)?.name ?? t.instrument.id}`).join(' · ')}
          </div>
        )}
      </section>
    </aside>
  );
}
