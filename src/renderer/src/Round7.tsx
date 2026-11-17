// Round 7 UI: the Lyrics dock tab (paste, type, drag syllables; verses), singing (VoicePanel),
// the sound library and "Describe a song".
import { useEffect, useMemo, useState } from 'react';
import {
  INSTRUMENTS, librarySoundFiles, parseDescription, planBars, planToChart, ROLE_NAMES, sanitizePlan, STYLE_IDS, STYLES,
  type BandRole, type PlanSection, type SongPlan, type StyleId, MAX_LIBRARY_FILES, setTrackSound, joinSyllables, lyricSlots, moveSyllables, pasteLyrics, setSyllable, verseCount, verseSyllables, writeVerse,
  type Song, type Track,
} from '../../model';
import type { PlayerStatus } from './player';
import type { AppState, Store } from './store';
import { VoicePanel } from './singing';
import { liveSynth } from './audio/liveSynth';
import { addToLibrary, getLibrary, libraryPresets, RECOMMENDED, removeFromLibrary, type LibraryItem } from './soundLib';
import type { Sf2Preset } from '../../render/sf2';

const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const noteName = (p: number) => NAMES[p % 12] + (Math.floor(p / 12) - 1);

export function LyricsPanel({ state, store, status }: { state: AppState; store: Store; status: PlayerStatus | null }) {
  const song = state.song!;
  const track: Track | undefined = song.tracks[Math.min(state.selTrack, song.tracks.length - 1)];
  const [verse, setVerse] = useState(0);
  const [text, setText] = useState('');
  const [auto, setAuto] = useState(true);
  const [msg, setMsg] = useState('');
  const [drag, setDrag] = useState<number | null>(null);
  // A newly opened song (or another track) starts at verse 1.
  useEffect(() => { setVerse(0); setMsg(''); }, [state.loadId, track?.id]);
  const slots = useMemo(() => (track && !track.audio && !track.instrument.percussion ? lyricSlots(song, track) : []), [song, track]);
  const sylls = useMemo(() => (track ? verseSyllables(song, track, verse) : []), [song, track, verse]);
  if (!track) return <div className="lyrics-panel">No track.</div>;
  if (track.audio || track.instrument.percussion) return <div className="lyrics-panel"><div className="sub">Pick a melody track (lyrics go on notes; this is {track.audio ? 'an audio' : 'a drum'} track).</div></div>;
  const verses = Math.max(1, verseCount(track));
  const cursorSlot = (): number => {
    const c = state.cursor;
    const bar = c && song.tracks[c.track]?.id === track.id ? c.bar : (status?.range?.startBar ?? -1);
    if (bar < 0) return 0;
    const i = slots.findIndex((s) => s.bar >= bar);
    return i < 0 ? 0 : i;
  };
  const apply = (from: number) => {
    let info = '';
    store.edit((s: Song) => {
      const r = pasteLyrics(s, track.id, verse, text, from, auto);
      info = `${r.syllables} syllables on ${Math.min(r.syllables, r.slots - from)} notes` + (r.overflow ? ` · ${r.overflow} did not fit (the melody has ${r.slots} notes)` : '');
      return r.song;
    }, 'Lyrics: paste verse ' + (verse + 1));
    setMsg(info);
  };
  const current = joinSyllables(sylls);
  return (
    <div className="lyrics-panel" data-testid="lyrics-panel">
      <div className="lyr-top">
        <label>Verse <select value={verse} onChange={(e) => setVerse(Number(e.target.value))} data-testid="lyr-verse">
          {Array.from({ length: verses + 1 }, (_, i) => <option key={i} value={i}>{i < verses ? `${i + 1}` : `${i + 1} (new)`}</option>)}
        </select></label>
        <span className="sub">{slots.length} notes · {sylls.filter((x) => x && x !== '_').length} syllables in this verse</span>
        <button onClick={() => setText(current)} disabled={!current} title="Copy this verse into the text box to edit it">Edit as text</button>
        <button onClick={() => { store.edit((s) => writeVerse(s, track.id, verse, []), 'Lyrics: clear verse ' + (verse + 1)); setMsg(''); }} disabled={!current} data-testid="lyr-clear">Clear verse</button>
      </div>
      <div className="lyr-paste">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} data-testid="lyr-text"
          placeholder={'Paste or type lyrics. Words are split into syllables automatically; write "Freu-de" to split by hand, "word_" to hold a syllable over the next note, "*" to skip a note.'} />
        <div className="lyr-btns">
          <label className="check" title="Split words into syllables (otherwise only at typed hyphens)"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> split words</label>
          <button className="primary" disabled={!text.trim()} onClick={() => apply(0)} data-testid="lyr-apply">Put on notes</button>
          <button disabled={!text.trim()} onClick={() => apply(cursorSlot())} title="Start at the cursor bar (or the selected bars)">…from the cursor bar</button>
        </div>
      </div>
      {msg && <div className="sub" data-testid="lyr-msg">{msg}</div>}
      <div className="lyr-strip" data-testid="lyr-strip">
        {slots.map((s, i) => {
          const sy = sylls[i] ?? '';
          return (
            <div key={i} className={`lyr-slot ${drag !== null && drag !== i ? 'droppable' : ''}`} data-testid={'lyr-slot-' + i}
              onDragOver={(e) => { if (drag !== null) e.preventDefault(); }}
              onDrop={(e) => { e.preventDefault(); if (drag !== null && drag !== i) store.edit((x) => moveSyllables(x, track.id, verse, drag, i), 'Lyrics: move syllables'); setDrag(null); }}>
              <div className="lyr-note" title={`Bar ${s.bar + 1}`}>{s.beat === 0 || i === 0 || slots[i - 1].bar !== s.bar ? <b>{s.bar + 1}</b> : ''} {noteName(s.pitch)}</div>
              <input className={`lyr-syl ${sy === '_' ? 'held' : ''}`} draggable={!!sy} value={sy} data-testid={'lyr-syl-' + i}
                onDragStart={(e) => { setDrag(i); e.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => setDrag(null)}
                onChange={(e) => store.edit((x) => setSyllable(x, track.id, verse, i, e.target.value), 'Lyrics: type', 'lyr-type-' + i)}
                title="Type a syllable (end with - if the word goes on; _ holds the previous syllable). Drag to move this and every later syllable." />
            </div>
          );
        })}
      </div>
      <VoicePanel state={state} store={store} track={track} />
    </div>
  );
}

// ------------------------------------------------------------------ sound library (item 7)

export function SoundLibrary({ state, store }: { state: AppState; store: Store }) {
  const song = state.song!;
  const track = song.tracks[Math.min(state.selTrack, song.tracks.length - 1)];
  const [lib, setLib] = useState<LibraryItem[]>([]);
  const [presets, setPresets] = useState<Record<string, Sf2Preset[] | string>>({});
  const [busy, setBusy] = useState('');
  const refresh = async () => {
    const l = await getLibrary();
    setLib(l);
    const p: Record<string, Sf2Preset[] | string> = {};
    for (const it of l) {
      try { p[it.file] = await libraryPresets(it); } catch (e) { p[it.file] = (e as Error).message; }
    }
    setPresets(p);
  };
  useEffect(() => { void refresh(); }, []);
  const used = librarySoundFiles(song);
  const value = track?.sound ? `${track.sound.file}|${track.sound.bank}|${track.sound.program}` : '';
  const choose = (v: string) => {
    if (!track) return;
    if (!v) { store.edit((s) => setTrackSound(s, track.id, null), 'Sound: ' + track.name + ' = song SoundFont'); return; }
    const [file, bank, program] = v.split('|');
    const list = presets[file];
    const pr = Array.isArray(list) ? list.find((x) => x.bank === Number(bank) && x.program === Number(program)) : undefined;
    const it = lib.find((x) => x.file === file);
    if (!used.includes(file) && used.length >= MAX_LIBRARY_FILES) { store.showError(`One song can use up to ${MAX_LIBRARY_FILES} library files.`); return; }
    store.edit((s) => setTrackSound(s, track.id, { file, bank: Number(bank), program: Number(program), name: `${it?.name ?? ''}: ${pr?.name ?? program}` }), 'Sound: ' + track.name);
  };
  const preview = () => {
    if (!track) return;
    const base = track.tuning ? (track.tuning[0] ?? 40) + 12 : track.instrument.percussion ? 36 : 60;
    void liveSynth.playChord([base, base + 4, base + 7, base + 12], track.instrument.program, track.instrument.percussion, 1600, 180);
  };
  return (
    <div className="sound-lib" data-testid="sound-lib">
      <section>
        <h4>Library</h4>
        {!lib.length && <div className="sub">No sounds added yet. Add a SoundFont (.sf2 / .sf3) or an SFZ instrument (the folder with its samples stays where it is).</div>}
        {lib.map((it) => (
          <div key={it.file} className="lib-item">
            <b>{it.name}</b> <span className="tag">{it.kind.toUpperCase()}</span>
            <span className="sub">{typeof presets[it.file] === 'string' ? '⚠ ' + presets[it.file] : `${(presets[it.file] as Sf2Preset[] | undefined)?.length ?? '…'} sounds`}{used.includes(it.file) ? ' · used in this song' : ''}</span>
            <div className="path" title={it.file}>{it.file}</div>
            <button onClick={() => void removeFromLibrary(it.file).then(refresh)} title="Remove from the library (the file stays on disk; songs using it fall back to the main SoundFont)">Remove</button>
          </div>
        ))}
        <button className="primary" disabled={!!busy} data-testid="lib-add" onClick={() => { setBusy('Reading…'); void addToLibrary().then(refresh).catch((e) => store.showError('Could not add it: ' + (e as Error).message)).finally(() => setBusy('')); }}>Add SoundFont / SFZ…</button>
        {busy && <span className="sub">{busy}</span>}
      </section>
      <section>
        <h4>Sound of the track</h4>
        {track && !track.audio ? <>
          <div className="sub">{track.name}{track.instrument.percussion ? ' (drum tracks always use the song SoundFont)' : ''}</div>
          <select value={value} disabled={track.instrument.percussion} onChange={(e) => choose(e.target.value)} data-testid="track-sound" style={{ maxWidth: 320 }}>
            <option value="">Song SoundFont: {INSTRUMENTS.find((i) => i.id === track.instrument.id)?.name ?? 'program ' + track.instrument.program}</option>
            {lib.map((it) => Array.isArray(presets[it.file]) && (
              <optgroup key={it.file} label={it.name}>
                {(presets[it.file] as Sf2Preset[]).map((p) => <option key={`${p.bank}:${p.program}`} value={`${it.file}|${p.bank}|${p.program}`}>{p.bank ? `${p.bank}:` : ''}{p.program} {p.name}</option>)}
              </optgroup>
            ))}
          </select>
          <button onClick={preview} data-testid="sound-preview" title="Play a short chord with this track's sound">▶ Preview</button>
          <div className="sub">Each track can use a different library sound; the others keep the song SoundFont. Saved with the song (missing files fall back to the main SoundFont).</div>
        </> : <div className="sub">Pick an instrument track.</div>}
      </section>
      <section className="recommended">
        <h4>Free libraries to download</h4>
        <table><tbody>
          {RECOMMENDED.map((r) => (
            <tr key={r.name}><td><b>{r.name}</b><div className="sub">{r.note}</div></td><td>{r.format}<div className="sub">{r.size}</div></td><td>{r.licence}</td>
              <td><code className="link" title="Copy the link" onClick={() => void navigator.clipboard?.writeText(r.url)}>{r.url}</code></td></tr>
          ))}
        </tbody></table>
        <div className="sub">Click a link to copy it, download in your browser, then Add it here. Nothing is bundled with the app.</div>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ "Describe a song" (item 6)

export function DescribeDialog({ state, store }: { state: AppState; store: Store }) {
  const [text, setText] = useState('12-bar blues in E, shuffle at 110, guitar, bass, piano and drums, 3 choruses');
  const [plan, setPlan] = useState<SongPlan | null>(null);
  const [by, setBy] = useState('');
  const [claude, setClaude] = useState(false);
  const [useClaude, setUseClaude] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { if (state.describeOpen) void window.mg.describeAvailable().then(setClaude); }, [state.describeOpen]);
  if (!state.describeOpen) return null;
  const makePlan = async () => {
    setErr('');
    if (claude && useClaude) {
      setBusy(true);
      try {
        const r = await window.mg.describeClaude(text);
        setPlan(sanitizePlan(r.plan as Partial<SongPlan>));
        setBy('Claude (' + r.model + ')');
        return;
      } catch (e) {
        setErr((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') + ' Using the built-in parser.');
      } finally {
        setBusy(false);
      }
    }
    setPlan(parseDescription(text));
    setBy('built-in parser');
  };
  const up = (p: Partial<SongPlan>) => plan && setPlan({ ...plan, ...p });
  const sec = (i: number, p: Partial<PlanSection>) => plan && setPlan({ ...plan, sections: plan.sections.map((s, k) => (k === i ? { ...s, ...p } : s)) });
  const role = (r: BandRole) => plan?.players.find((x) => x.role === r);
  const setRole = (r: BandRole, id: string) => plan && setPlan({ ...plan, players: id ? [...plan.players.filter((x) => x.role !== r), { role: r, instrumentId: id }] : plan.players.filter((x) => x.role !== r) });
  return (
    <div className="modal-back" data-testid="describe-dialog">
      <div className="modal wide">
        <h3 className="mtitle">Describe a song</h3>
        <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} data-testid="describe-text" style={{ width: '100%' }}
          placeholder='e.g. "slow minor blues in A with organ, bass and drums" or "pop song in G, verse/chorus with a bridge, 96 bpm"' />
        <div className="rowx">
          <button className="primary" disabled={busy || !text.trim()} onClick={() => void makePlan()} data-testid="describe-plan">{busy ? 'Asking Claude…' : 'Make a plan'}</button>
          {claude ? <label className="check" title="Free-form descriptions go to Claude (claude-opus-5-5) using ANTHROPIC_API_KEY from the environment"><input type="checkbox" checked={useClaude} onChange={(e) => setUseClaude(e.target.checked)} /> ask Claude</label>
            : <span className="sub">Built-in parser (set ANTHROPIC_API_KEY to let Claude read free-form descriptions).</span>}
          {by && <span className="sub" data-testid="describe-by">plan by {by}</span>}
        </div>
        {err && <div className="problem">{err}</div>}
        {plan && <>
          <div className="grid2 plan" data-testid="describe-planbox">
            <span className="sub">Title</span><input value={plan.title} onChange={(e) => up({ title: e.target.value })} />
            <span className="sub">Key</span>
            <span className="rowx">
              <select value={plan.key} onChange={(e) => up({ key: e.target.value })}>{['C', 'C#', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'].map((k) => <option key={k}>{k}</option>)}</select>
              <select value={plan.mode} onChange={(e) => up({ mode: e.target.value as 'major' | 'minor' })}><option>major</option><option>minor</option></select>
              <label>Tempo <input type="number" className="num" value={plan.bpm} onChange={(e) => up({ bpm: Number(e.target.value) })} /> bpm</label>
              <label>Time <input className="num" value={plan.timeSig.join('/')} onChange={(e) => { const [a, b] = e.target.value.split('/').map(Number); if (a && b) up({ timeSig: [a, b] }); }} /></label>
              <select value={plan.feel} onChange={(e) => up({ feel: e.target.value as SongPlan['feel'] })}><option>straight</option><option>shuffle</option><option>swing</option></select>
              <select value={plan.style} onChange={(e) => up({ style: e.target.value as StyleId })}>{STYLE_IDS.map((s) => <option key={s} value={s}>{STYLES[s].name}</option>)}</select>
            </span>
            <span className="sub">Band</span>
            <span className="rowx wrap">
              {(['drums', 'bass', 'rhythm', 'lead'] as BandRole[]).map((r) => (
                <label key={r}>{ROLE_NAMES[r]} <select value={role(r)?.instrumentId ?? ''} onChange={(e) => setRole(r, e.target.value)}>
                  <option value="">off</option>
                  {INSTRUMENTS.filter((i) => (r === 'drums' ? i.percussion : !i.percussion)).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select></label>
              ))}
            </span>
            <span className="sub">Form</span>
            <div>
              {plan.sections.map((s, i) => (
                <div key={i} className="rowx">
                  <input value={s.name} style={{ width: 80 }} onChange={(e) => sec(i, { name: e.target.value })} />
                  <input value={s.bars.join(' | ')} style={{ flex: 1, minWidth: 260 }} onChange={(e) => sec(i, { bars: e.target.value.split('|').map((x) => x.trim()).filter(Boolean) })} title="Chords per bar (Roman numerals or chord names), separated by |" />
                  x<input type="number" className="num" min={1} max={16} value={s.repeat} onChange={(e) => sec(i, { repeat: Number(e.target.value) })} />
                  <button onClick={() => setPlan({ ...plan, sections: plan.sections.filter((_, k) => k !== i) })} title="Remove section">✕</button>
                </div>
              ))}
              <span className="sub">{planBars(plan)} bars</span>
            </div>
          </div>
          {plan.notes.length > 0 && <div className="sub">Assumed: {plan.notes.join('; ')}</div>}
          <pre className="chart-preview" data-testid="describe-chart">{planToChart(plan)}</pre>
        </>}
        <div className="rowx right">
          <button onClick={() => store.openDescribe(false)}>Cancel</button>
          <button className="primary" disabled={!plan} data-testid="describe-create" onClick={() => {
            const errors = store.createFromPlan(sanitizePlan(plan!));
            if (errors.length) store.showError('Chart: ' + errors.join('; '));
          }}>Create song</button>
        </div>
      </div>
    </div>
  );
}
