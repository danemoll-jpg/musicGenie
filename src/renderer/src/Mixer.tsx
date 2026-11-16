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
    <div className="meter" title={m ? `L ${m.peakL.toFixed(3)}  R ${m.peakR.toFixed(3)}` : ''} data-testid={testId}
      onClick={() => engine.graph.resetClips()}>
      <div className={`clip ${m?.clip ? 'on' : ''}`} title="Clip (click to reset)" />
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
        onDoubleClick={() => onChange(0.8)} title="Volume (double-click = 0 dB)" data-testid={testId} />
      <span className="val">{fmtDb(value)}</span>
    </div>
  );
}

export function FxParams({ fx, onSet }: { fx: Effect; onSet: (key: string, v: number) => void }) {
  return (
    <div className="fx-params">
      {FX_DEFS[fx.type].params.map((p) => (
        <label key={p.key} title={p.name}>
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
            {!single && <button className={`pw ${f.bypass ? '' : 'on'}`} title={f.bypass ? 'Turn on' : 'Bypass'} onClick={() => store.bypassFx(target, f.id, !f.bypass)}>⏻</button>}
            <span className="nm" onClick={() => setOpen(open === f.id ? null : f.id)} title="Settings">{FX_DEFS[f.type].name}</span>
            {!single && <>
              <button disabled={i === 0} onClick={() => store.moveFx(target, f.id, -1)} title="Move up">▲</button>
              <button disabled={i === fx.length - 1} onClick={() => store.moveFx(target, f.id, 1)} title="Move down">▼</button>
              <button onClick={() => store.removeFx(target, f.id)} title="Remove">✕</button>
            </>}
          </div>
          {(open === f.id || single) && <FxParams fx={f} onSet={(k, v) => store.setFxParam(target, f.id, k, v)} />}
        </div>
      ))}
      {!single && (
        <select value="" onChange={(e) => e.target.value && store.addFx(target, e.target.value as FxType)} data-testid={'fx-add-' + target}>
          <option value="">+ Effect…</option>
          {FX_TYPES.map((t) => <option key={t} value={t}>{FX_DEFS[t].name}</option>)}
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
        <button className={`ms ${t.mixer.mute ? 'on mute' : ''}`} onClick={() => store.setMixer(t.id, { mute: !t.mixer.mute })}>M</button>
        <button className={`ms ${t.mixer.solo ? 'on solo' : ''}`} onClick={() => store.setMixer(t.id, { solo: !t.mixer.solo })}>S</button>
        {auto.size > 0 && <span className="tag" title={'Automated: ' + [...auto].join(', ')}>auto</span>}
      </div>
      <label className="pan" title={auto.has('pan') ? 'Pan (automated)' : 'Pan'}>Pan
        <input type="range" min={-1} max={1} step={0.05} value={t.mixer.pan} disabled={auto.has('pan')} onChange={(e) => store.setMixer(t.id, { pan: Number(e.target.value) })} onDoubleClick={() => store.setMixer(t.id, { pan: 0 })} />
      </label>
      <div className="sends">
        <label title="Send to the Reverb bus">Rev
          <input type="range" min={0} max={1} step={0.01} value={t.mixer.sends?.reverb ?? 0} onChange={(e) => store.setSends(t.id, { reverb: Number(e.target.value) })} data-testid={'send-r-' + t.id} />
        </label>
        <label title="Send to the Delay bus">Dly
          <input type="range" min={0} max={1} step={0.01} value={t.mixer.sends?.delay ?? 0} onChange={(e) => store.setSends(t.id, { delay: Number(e.target.value) })} data-testid={'send-d-' + t.id} />
        </label>
      </div>
      <select className="preset" value="" onChange={(e) => {
        const p = presets.find((x) => x.name === e.target.value);
        if (p) store.applyPreset(t.id, p);
      }} data-testid={'preset-' + t.id}>
        <option value="">Preset…</option>
        {presets.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
      </select>
      <FxChain target={t.id} fx={t.mixer.fx ?? []} store={store} />
      <SavePreset onSave={(n) => void store.saveFxPreset(t.id, n)} />
      <div className="snum">{i + 1}</div>
    </div>
  );
}

function SavePreset({ onSave }: { onSave: (name: string) => void }) {
  const [name, setName] = useState('');
  return (
    <div className="save-preset">
      <input placeholder="preset name" value={name} onChange={(e) => setName(e.target.value)} />
      <button disabled={!name.trim()} onClick={() => { onSave(name); setName(''); }} title="Save this chain + sends as a preset">Save</button>
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
      <div className="strips" ref={scroll}>
        {song.tracks.map((t, i) => <TrackStrip key={t.id} t={t} i={i} store={store} state={state} meter={meters?.tracks[t.id]} />)}
        {(['reverb', 'delay'] as const).map((b) => (
          <div key={b} className="strip bus" data-strip={'__' + b}>
            <div className="sname">{b === 'reverb' ? 'Reverb bus' : 'Delay bus'}</div>
            <div className="ms-row">
              <button className={`ms ${mix[b].mute ? 'on mute' : ''}`} onClick={() => store.setSongMix((m) => ({ ...m, [b]: { ...m[b], mute: !m[b].mute } }), b === 'reverb' ? 'Mute reverb bus' : 'Mute delay bus')}>M</button>
            </div>
            <div className="fader-row">
              <MeterBar m={meters?.[b]} testId={'meter-__' + b} />
              <Fader value={mix[b].volume} onChange={(v) => store.setSongMix((m) => ({ ...m, [b]: { ...m[b], volume: v } }), 'Bus volume', 'bus:' + b)} />
            </div>
            <FxChain target={'__' + b} fx={[mix[b].fx]} store={store} single />
          </div>
        ))}
        <div className="strip master" data-strip="__master">
          <div className="sname">Master</div>
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
