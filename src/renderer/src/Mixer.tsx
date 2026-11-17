// Round 5: the mixer (a dock tab). A strip per track plus Reverb, Delay and Master: fader, pan,
// mute/solo, meter with clip light, effects chain (add / remove / reorder / bypass / settings),
// presets, and send levels to the two shared buses.
import { useEffect, useRef, useState } from 'react';
import {
  faderDb, FX_DEFS, FX_PRESETS, FX_TYPES, songMix,
  type Effect, type FxPreset, type FxType, type Track,
} from '../../model';
import { engine } from './audio/engine';
import type { Meter } from './audio/graph';
import type { AppState, Store } from './store';
import { HelpButton, MoreOptions } from './HelpUi';

/** Shown names: plain words first (the model keeps its own names). */
const fxLabel = (t: FxType) => (t === 'delay' ? 'Echo (delay)' : FX_DEFS[t].name);
/** What each effect does, in plain words (tooltips). */
const FX_HELP: Record<FxType, string> = {
  eq3: 'EQ (equaliser): turn the bass, middle and treble of this sound up or down, e.g. less boom or more sparkle',
  peq: 'EQ (parametric): cut or boost exact pitches and trim the very low or very high end; for fine tone fixes',
  comp: 'Compressor: evens out loud and quiet moments so the part sits steady in the mix; good on vocals, bass and drums',
  gate: 'Gate: silences the track while it is very quiet, to cut hiss or hum between notes',
  drive: 'Overdrive / distortion: makes the sound gritty or fuzzy, like a guitar pedal',
  amp: 'Guitar amp: sounds like playing through a guitar amplifier and speaker cabinet',
  bassamp: 'Bass amp: sounds like playing through a bass amplifier and speaker cabinet',
  chorus: 'Chorus: makes one instrument sound wider and thicker, like several playing together',
  flanger: 'Flanger: a sweeping "jet plane" swoosh',
  phaser: 'Phaser: a gentle swirling, sweeping sound',
  tremolo: 'Tremolo: makes the volume pulse up and down quickly',
  delay: 'Echo (delay): repeats the sound in time with the song',
  reverb: 'Reverb: adds the sound of a room or hall around the instrument',
  limiter: 'Limiter: stops the loudest peaks going over a set level so the song never distorts; best as the last effect on Master',
};
const PARAM_HELP: Record<string, string> = {
  low: 'how much bass to add or remove', lowFreq: 'where "bass" ends', mid: 'how much middle to add or remove', midFreq: 'which middle pitch to change',
  high: 'how much treble to add or remove', highFreq: 'where "treble" starts', lowCut: 'removes everything below this pitch (rumble)', highCut: 'removes everything above this pitch (hiss)',
  freq: 'which pitch to change', freq2: 'which pitch the second band changes', gain: 'how much to boost, cut or drive it', gain2: 'how much the second band boosts or cuts',
  q: 'how narrow the change is (higher = narrower)', q2: 'how narrow the second band is', threshold: 'the level where the effect starts working', ratio: 'how strongly loud moments are turned down',
  attack: 'how fast it reacts', release: 'how fast it lets go', knee: 'how gently it starts working', makeup: 'turns the result back up after evening it out',
  hold: 'how long it stays open after a note', drive: 'how much grit', tone: 'darker (left) or brighter (right)', mode: 'which kind of sound', level: 'output volume of the effect',
  bass: 'low end', treble: 'high end', presence: 'extra bite at the top', cab: 'which speaker cabinet it sounds like', blend: 'mix of the clean (direct) and amp sound',
  rate: 'how fast it moves', depth: 'how strong it is', mix: 'how much effect vs. the plain sound', feedback: 'how many repeats / how intense',
  note: 'how far apart the echoes are, in note lengths', type: 'which kind of space', decay: 'how long the reverb rings', predelay: 'a short gap before the reverb starts',
  ceiling: 'the highest level allowed',
};
const paramTitle = (fx: FxType, key: string, name: string) => `${fxLabel(fx)}: ${name} - ${PARAM_HELP[key] ?? 'adjust this setting'}`;

const fmtDb = (pos: number) => {
  const db = faderDb(pos);
  return db === -Infinity ? '-∞' : (db > 0 ? '+' : '') + db.toFixed(1);
};

/** Live meter readings, ~25 times a second while the mixer is open. */
function useMeters(): ReturnType<typeof engine.meters> | null {
  const [m, setM] = useState<ReturnType<typeof engine.meters> | null>(null);
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      if (t - last > 40) { last = t; setM(engine.meters()); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return m;
}

function MeterBar({ m, testId }: { m?: Meter; testId?: string }) {
  const h = (p: number) => {
    const db = p > 0 ? 20 * Math.log10(p) : -90;
    return Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
  };
  return (
    <div className="meter" title={`Level meter: how loud it is right now${m ? ` (left ${m.peakL.toFixed(3)}, right ${m.peakR.toFixed(3)})` : ''}; click to reset the red light`} data-testid={testId}
      onClick={() => engine.graph.resetClips()}>
      <div className={`clip ${m?.clip ? 'on' : ''}`} title="Red = it got too loud and distorted (clipped): turn it down, then click to reset" />
      <div className="bars">
        <div className="bar"><div style={{ height: h(m?.peakL ?? 0) + '%' }} /></div>
        <div className="bar"><div style={{ height: h(m?.peakR ?? 0) + '%' }} /></div>
      </div>
    </div>
  );
}

function Fader({ value, onChange, testId }: { value: number; onChange: (v: number) => void; testId?: string }) {
  return (
    <div className="fader">
      <input type="range" min={0} max={1} step={0.005} value={value} onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(0.8)} title="Volume in the mix: drag to balance this against the other parts (double-click = back to normal, 0 dB)" data-testid={testId} />
      <span className="val">{fmtDb(value)}</span>
    </div>
  );
}

export function FxParams({ fx, onSet }: { fx: Effect; onSet: (key: string, v: number) => void }) {
  return (
    <div className="fx-params">
      {FX_DEFS[fx.type].params.map((p) => (
        <label key={p.key} title={paramTitle(fx.type, p.key, p.name)}>
          <span>{p.name}</span>
          {p.options ? (
            <select value={Math.round(fx.params[p.key] ?? p.def)} onChange={(e) => onSet(p.key, Number(e.target.value))}>
              {p.options.map((o, i) => <option key={o} value={i}>{o}</option>)}
            </select>
          ) : (
            <>
              <input type="range" min={p.min} max={p.max} step={p.step} value={fx.params[p.key] ?? p.def}
                onChange={(e) => onSet(p.key, Number(e.target.value))} data-testid={'fxp-' + fx.id + '-' + p.key} />
              <em>{(fx.params[p.key] ?? p.def).toFixed(p.step < 0.1 ? 2 : p.step < 1 ? 1 : 0)}{p.unit ? ' ' + p.unit : ''}</em>
            </>
          )}
        </label>
      ))}
    </div>
  );
}

function FxChain({ target, fx, store, single }: { target: string; fx: Effect[]; store: Store; single?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="fx-chain" data-testid={'fx-chain-' + target}>
      {fx.map((f, i) => (
        <div key={f.id} className={`fx ${f.bypass ? 'off' : ''}`} data-fx={f.type}>
          <div className="fx-head">
            {!single && <button className={`pw ${f.bypass ? '' : 'on'}`} title={f.bypass ? 'Turn this effect back on' : 'Off (bypass): switch this effect off for now, to hear the difference'} onClick={() => store.bypassFx(target, f.id, !f.bypass)}>⏻</button>}
            <span className="nm" onClick={() => setOpen(open === f.id ? null : f.id)} title={FX_HELP[f.type] + '. Click to show or hide its settings'}>{fxLabel(f.type)}</span>
            {!single && <>
              <button disabled={i === 0} onClick={() => store.moveFx(target, f.id, -1)} title="Move this effect earlier (effects work top to bottom)">▲</button>
              <button disabled={i === fx.length - 1} onClick={() => store.moveFx(target, f.id, 1)} title="Move this effect later (effects work top to bottom)">▼</button>
              <button onClick={() => store.removeFx(target, f.id)} title="Remove this effect">✕</button>
            </>}
          </div>
          {(open === f.id || single) && <FxParams fx={f} onSet={(k, v) => store.setFxParam(target, f.id, k, v)} />}
        </div>
      ))}
      {!single && (
        <select value="" onChange={(e) => e.target.value && store.addFx(target, e.target.value as FxType)} data-testid={'fx-add-' + target}
          title="Add an effect (echo, reverb, amp, EQ...) to change how this sounds">
          <option value="">+ Effect…</option>
          {FX_TYPES.map((t) => <option key={t} value={t} title={FX_HELP[t]}>{fxLabel(t)}</option>)}
        </select>
      )}
    </div>
  );
}

function presetFamily(t: Track): FxPreset['family'] {
  if (t.instrument.percussion) return 'drums';
  if (t.tuning) return t.tuning.length <= 5 && t.tuning[0] < 36 ? 'bass' : 'guitar';
  if (t.audio) return 'vocal';
  return 'keys';
}

function TrackStrip({ t, i, store, state, meter }: { t: Track; i: number; store: Store; state: AppState; meter?: Meter }) {
  const fam = presetFamily(t);
  const presets = [...FX_PRESETS.filter((p) => p.family === fam), ...FX_PRESETS.filter((p) => p.family !== fam), ...state.fxPresets];
  const auto = new Set((t.automation ?? []).filter((l) => l.points.length).map((l) => l.param));
  return (
    <div className={`strip ${i === state.selTrack ? 'sel' : ''}`} data-strip={t.id} onMouseDown={() => store.setSelTrack(i)}>
      <div className="sname" title={t.name}>{t.audio ? '🎙 ' : ''}{t.name}</div>
      <div className="fader-row">
        <MeterBar m={meter} testId={'meter-' + t.id} />
        <Fader value={t.mixer.volume} onChange={(v) => store.setMixer(t.id, { volume: v })} testId={'fader-' + t.id} />
      </div>
      <div className="ms-row">
        <button className={`ms ${t.mixer.mute ? 'on mute' : ''}`} onClick={() => store.setMixer(t.id, { mute: !t.mixer.mute })} title="Mute: silence this part (click again to hear it)">M</button>
        <button className={`ms ${t.mixer.solo ? 'on solo' : ''}`} onClick={() => store.setMixer(t.id, { solo: !t.mixer.solo })} title="Solo: hear only this part (and any other soloed ones), to check it on its own">S</button>
        {auto.size > 0 && <span className="tag" title={'Changes over time (automation) set for: ' + [...auto].join(', ') + '. Edit them in the Changes over time tab'}>changes</span>}
      </div>
      <label className="pan" title={auto.has('pan') ? 'Pan: left/right position, set by Changes over time (so the knob is locked)' : 'Pan: place this part more in the left or right speaker (double-click = centre)'}>Pan
        <input type="range" min={-1} max={1} step={0.05} value={t.mixer.pan} disabled={auto.has('pan')} onChange={(e) => store.setMixer(t.id, { pan: Number(e.target.value) })} onDoubleClick={() => store.setMixer(t.id, { pan: 0 })} />
      </label>
      <div className="sends">
        <label title="Reverb amount: how much of this part goes to the shared Reverb (a send), for a sense of space">Reverb
          <input type="range" min={0} max={1} step={0.01} value={t.mixer.sends?.reverb ?? 0} onChange={(e) => store.setSends(t.id, { reverb: Number(e.target.value) })} data-testid={'send-r-' + t.id} />
        </label>
        <label title="Echo amount: how much of this part goes to the shared Echo (delay send)">Echo
          <input type="range" min={0} max={1} step={0.01} value={t.mixer.sends?.delay ?? 0} onChange={(e) => store.setSends(t.id, { delay: Number(e.target.value) })} data-testid={'send-d-' + t.id} />
        </label>
      </div>
      <select className="preset" value="" onChange={(e) => {
        const p = presets.find((x) => x.name === e.target.value);
        if (p) store.applyPreset(t.id, p);
      }} data-testid={'preset-' + t.id} title="Ready-made sound (preset): replaces this part's effects with a set made for guitar, bass, drums, keys or voice">
        <option value="">Ready-made sound…</option>
        {presets.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
      </select>
      <FxChain target={t.id} fx={t.mixer.fx ?? []} store={store} />
      <MoreOptions label="Save as preset" title="Save this part's effects to reuse them on other tracks and songs"><SavePreset onSave={(n) => void store.saveFxPreset(t.id, n)} /></MoreOptions>
      <div className="snum">{i + 1}</div>
    </div>
  );
}

function SavePreset({ onSave }: { onSave: (name: string) => void }) {
  const [name, setName] = useState('');
  return (
    <div className="save-preset">
      <input placeholder="preset name" value={name} onChange={(e) => setName(e.target.value)} title="A name for your own preset (it then appears in the Ready-made sound list)" />
      <button disabled={!name.trim()} onClick={() => { onSave(name); setName(''); }} title="Save these effects and Reverb/Echo amounts as your own preset, to reuse on other tracks">Save</button>
    </div>
  );
}

export function MixerView({ state, store }: { state: AppState; store: Store }) {
  const song = state.song!;
  const meters = useMeters();
  const mix = songMix(song);
  useEffect(() => void store.loadFxPresets(), []);
  const scroll = useRef<HTMLDivElement>(null);
  return (
    <div className="mixer" data-testid="mixer">
      <div className="pr-tools" style={{ height: 30, boxSizing: 'border-box' }}>
        <HelpButton topic="mixer" label="mixer" /><span className="lbl">Mixer</span>
        <HelpButton topic="effects" label="effects chain" />
        <span className="hint">Balance the parts: volume, left/right, Reverb and Echo amounts, effects.</span>
      </div>
      <div className="strips" ref={scroll} style={{ height: 'calc(100% - 30px)' }}>
        {song.tracks.map((t, i) => <TrackStrip key={t.id} t={t} i={i} store={store} state={state} meter={meters?.tracks[t.id]} />)}
        {(['reverb', 'delay'] as const).map((b) => (
          <div key={b} className="strip bus" data-strip={'__' + b}>
            <div className="sname" title={b === 'reverb' ? 'The shared Reverb (bus): every part\'s Reverb amount ends up here' : 'The shared Echo (delay bus): every part\'s Echo amount ends up here'}>{b === 'reverb' ? 'Reverb' : 'Echo (delay)'}</div>
            <div className="ms-row">
              <button className={`ms ${mix[b].mute ? 'on mute' : ''}`} onClick={() => store.setSongMix((m) => ({ ...m, [b]: { ...m[b], mute: !m[b].mute } }), b === 'reverb' ? 'Mute reverb bus' : 'Mute delay bus')}
                title={b === 'reverb' ? 'Mute the shared Reverb, to hear the song without it' : 'Mute the shared Echo, to hear the song without it'}>M</button>
            </div>
            <div className="fader-row">
              <MeterBar m={meters?.[b]} testId={'meter-__' + b} />
              <Fader value={mix[b].volume} onChange={(v) => store.setSongMix((m) => ({ ...m, [b]: { ...m[b], volume: v } }), 'Bus volume', 'bus:' + b)} />
            </div>
            <FxChain target={'__' + b} fx={[mix[b].fx]} store={store} single />
          </div>
        ))}
        <div className="strip master" data-strip="__master">
          <div className="sname" title="Master: the whole song after all parts are mixed; its volume and effects change everything">Master</div>
          <div className="fader-row">
            <MeterBar m={meters?.master} testId="meter-__master" />
            <Fader value={mix.master.volume} onChange={(v) => store.setSongMix((m) => ({ ...m, master: { ...m.master, volume: v } }), 'Master volume', 'master')} testId="fader-__master" />
          </div>
          <FxChain target="__master" fx={mix.master.fx} store={store} />
        </div>
      </div>
    </div>
  );
}
