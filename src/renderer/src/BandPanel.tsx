// Right-hand panel: chords, sections and the virtual band.
import { useState } from 'react';
import {
  findInstrument, INSTRUMENT_GROUPS, INSTRUMENTS, ROLE_NAMES, SECTION_NAMES, sectionRanges, STYLE_IDS, STYLES,
  type BandRole, type Complexity,
} from '../../model';
import type { PlayerStatus } from './player';
import type { AppState, Store } from './store';

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
        <h3>Chords</h3>
        <div className="sub">{song.chordSymbols.length ? `${song.chordSymbols.length} chord symbols. Click one in the score to change it.` : 'No chord symbols yet.'}</div>
        <div className="rowx">
          <button onClick={() => store.detectChords(replaceChords)} data-testid="detect-chords">Detect chords</button>
          <label className="check" title="Also replace chord symbols that came with the file">
            <input type="checkbox" checked={replaceChords} onChange={(e) => setReplaceChords(e.target.checked)} /> Replace file chords
          </label>
        </div>
      </section>

      <section>
        <h3>Sections</h3>
        <div className="chips">
          {song.sections.length === 0 && <span className="sub">None: the band treats the song as one section.</span>}
          {sections.filter((s) => song.sections.some((x) => x.bar === s.startBar)).map((s) => (
            <span key={s.startBar} className="chip-s">
              {s.name} <small>{s.startBar + 1}–{s.endBar}</small>
              <button title="Remove this section mark" onClick={() => store.removeSection(s.startBar)}>✕</button>
            </span>
          ))}
        </div>
        <div className="rowx">
          <select value={sectionName} onChange={(e) => setSectionName(e.target.value)}>
            {SECTION_NAMES.map((n) => <option key={n}>{n}</option>)}
          </select>
          <button disabled={!range} onClick={() => range && store.setSection(range.startBar, range.endBar, sectionName)}
            title="Drag across bars in the score to select them">
            {range ? `Name bars ${range.startBar + 1}–${range.endBar + 1}` : 'Select bars first'}
          </button>
        </div>
      </section>

      <section>
        <h3>Band</h3>
        <div className="grid2">
          <label>Style</label>
          <select value={band.style} data-testid="style" onChange={(e) => store.setStyle(e.target.value as never)}>
            {STYLE_IDS.map((s) => <option key={s} value={s}>{STYLES[s].name}</option>)}
          </select>
          <label>Play along to</label>
          <select value={band.sourceTrackId ?? sources[0]?.id} onChange={(e) => store.setBand({ sourceTrackId: e.target.value })}>
            {sources.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div className="sub">{STYLES[band.style].blurb}</div>
        <table className="lineup">
          <tbody>
            {band.players.map((p) => (
              <tr key={p.role}>
                <td>
                  <label className="check">
                    <input type="checkbox" checked={p.on} onChange={(e) => store.setPlayer(p.role, { on: e.target.checked })} /> {ROLE_NAMES[p.role]}
                  </label>
                </td>
                <td>
                  {p.role === 'drums' ? (
                    <span className="sub">GM kit</span>
                  ) : (
                    <select value={p.instrumentId} disabled={!p.on} onChange={(e) => store.setPlayer(p.role, { instrumentId: e.target.value })}>
                      {INSTRUMENT_GROUPS.filter((g) => ROLE_GROUPS[p.role].includes(g)).map((g) => (
                        <optgroup key={g} label={g}>
                          {INSTRUMENTS.filter((i) => i.group === g).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                        </optgroup>
                      ))}
                    </select>
                  )}
                </td>
                <td>
                  <select value={p.complexity} disabled={!p.on} title="Complexity" onChange={(e) => store.setPlayer(p.role, { complexity: e.target.value as Complexity })}>
                    <option value="simple">Simple</option>
                    <option value="normal">Normal</option>
                    <option value="busy">Busy</option>
                  </select>
                  {p.role === 'lead' && (
                    <select value={p.octave ?? 0} disabled={!p.on} title="Octave" onChange={(e) => store.setPlayer('lead', { octave: Number(e.target.value) })}>
                      {[-2, -1, 0, 1, 2].map((o) => <option key={o} value={o}>{o > 0 ? `+${o}` : o} oct</option>)}
                    </select>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="rowx wrap">
          <label className="check"><input type="checkbox" checked={band.bassFollowsKick} onChange={(e) => store.setBand({ bassFollowsKick: e.target.checked })} /> Bass follows kick</label>
          <label className="check"><input type="checkbox" checked={band.ending} onChange={(e) => store.setBand({ ending: e.target.checked })} /> Ending (hold last chord)</label>
        </div>
        <div className="rowx">
          <button className="primary" data-testid="generate" onClick={() => store.generate()}>Generate</button>
          <button onClick={() => store.tryAnother()} disabled={!generated.length} title="Same settings, new random choices">Try another</button>
          <span className="sub">seed {band.seed}</span>
        </div>
        <div className="rowx">
          <select value={regenSection} onChange={(e) => setRegenSection(e.target.value)} disabled={!generated.length}>
            <option value="all">Whole song</option>
            {sections.map((s) => <option key={s.startBar} value={s.startBar}>{s.name} (bars {s.startBar + 1}–{s.endBar})</option>)}
          </select>
          <select value={regenRole} onChange={(e) => setRegenRole(e.target.value)} disabled={!generated.length}>
            <option value="all">All players</option>
            {generated.map((t) => <option key={t.id} value={t.generated!.role}>{ROLE_NAMES[t.generated!.role]}</option>)}
          </select>
          <button disabled={!generated.length || (regenSection === 'all' && regenRole === 'all')}
            title="Pick a section and/or a player"
            onClick={() => store.regenerate({
              sectionStartBar: regenSection === 'all' ? undefined : Number(regenSection),
              role: regenRole === 'all' ? undefined : (regenRole as BandRole),
            })}>Regenerate</button>
        </div>
        <div className="rowx">
          <label className="speed" title="Swing feel at playback (notation stays straight)">
            Feel
            <input type="range" min={0} max={1} step={0.05} value={swing} onChange={(e) => store.setSwing(Number(e.target.value))} />
            <span className="val">{swing === 0 ? 'straight' : `swing ${Math.round(swing * 100)}%`}</span>
          </label>
        </div>
        {generated.length > 0 && (
          <div className="sub">
            Band: {generated.map((t) => `${ROLE_NAMES[t.generated!.role]} – ${findInstrument(t.instrument.id)?.name ?? t.instrument.id}`).join(' · ')}
          </div>
        )}
      </section>
    </aside>
  );
}
