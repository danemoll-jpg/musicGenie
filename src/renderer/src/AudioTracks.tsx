// Round 5: the Audio dock tab. Audio tracks with their clips on a bar timeline (drag to move,
// drag an edge to trim, split at the playhead, fades and clip gain), import, and recording from an
// audio input with count-in, metronome, input meter, monitoring and a latency setting.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  barStartTicks, barTicks, clipStartMs, msToPos, posToMs, removeClip, splitClipAtMs, trimClipEnd, trimClipStart, updateClip,
  type AudioClip, type Song,
} from '../../model';
import { recorder, type RecorderState } from './audio/recorder';
import type { AudioTracks } from './audioTracksCtl';
import type { PlayerStatus } from './player';
import type { AppState, Store } from './store';
import { HelpButton, MoreOptions } from './HelpUi';

const BAR_PX = 90;
const ROW_H = 56;
const SNAP = 240;

export const audioCtl: { current: AudioTracks | null } = { current: null };

function useRecorder(): RecorderState {
  return useSyncExternalStore((f) => recorder.on(f), () => recorder.state);
}

const xAtMs = (song: Song, ms: number) => {
  const p = msToPos(song, ms);
  return (p.bar + p.tick / barTicks(song.bars[p.bar])) * BAR_PX;
};
const msAtX = (song: Song, x: number) => {
  const bar = Math.max(0, Math.min(song.bars.length - 1, Math.floor(x / BAR_PX)));
  const tick = ((x - bar * BAR_PX) / BAR_PX) * barTicks(song.bars[bar]);
  return posToMs(song, bar, Math.round(tick / SNAP) * SNAP);
};

function ClipRow({ song, trackId, clips, store, sel, setSel }: { song: Song; trackId: string; clips: AudioClip[]; store: Store; sel: string | null; setSel: (id: string | null) => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ id: string; mode: 'move' | 'start' | 'end'; dx: number } | null>(null);
  const W = song.bars.length * BAR_PX;
  const local = (e: React.PointerEvent) => e.clientX - svg.current!.getBoundingClientRect().left;
  return (
    <svg ref={svg} width={W} height={ROW_H} data-testid={'clips-' + trackId}
      onPointerDown={(e) => { if (e.target === svg.current) setSel(null); }}
      onPointerMove={(e) => {
        if (!drag) return;
        const c = clips.find((x) => x.id === drag.id);
        if (!c) return;
        const x = local(e);
        if (drag.mode === 'move') {
          const pos = msToPos(song, msAtX(song, x - drag.dx), SNAP);
          store.edit((s) => updateClip(s, trackId, c.id, pos), 'Move clip', 'clip-move:' + c.id);
        } else if (drag.mode === 'start') {
          store.edit((s) => updateClip(s, trackId, c.id, trimClipStart(s, c, msAtX(s, x))), 'Trim clip', 'clip-trim:' + c.id);
        } else {
          store.edit((s) => updateClip(s, trackId, c.id, trimClipEnd(s, c, msAtX(s, x))), 'Trim clip', 'clip-trim:' + c.id);
        }
      }}
      onPointerUp={() => setDrag(null)}>
      {song.bars.map((_, i) => (
        <g key={i}>
          <line x1={i * BAR_PX} x2={i * BAR_PX} y1={0} y2={ROW_H} stroke="#e3e1dc" />
          <text x={i * BAR_PX + 3} y={10} fontSize={9} fill="#aaa">{i + 1}</text>
        </g>
      ))}
      {clips.map((c) => {
        const s0 = clipStartMs(song, c);
        const x0 = xAtMs(song, s0);
        const x1 = xAtMs(song, s0 + c.lengthMs);
        const w = Math.max(6, x1 - x0);
        const fi = c.fadeInMs ? xAtMs(song, s0 + c.fadeInMs) - x0 : 0;
        const fo = c.fadeOutMs ? x1 - xAtMs(song, s0 + c.lengthMs - c.fadeOutMs) : 0;
        return (
          <g key={c.id} data-clip={c.id}>
            <rect className={`clip-box ${sel === c.id ? 'sel' : ''}`} x={x0} y={12} width={w} height={ROW_H - 16} rx={4}
              onPointerDown={(e) => {
                e.stopPropagation();
                (e.target as Element).setPointerCapture?.(e.pointerId);
                setSel(c.id);
                const x = local(e);
                const mode = x - x0 < 6 ? 'start' : x1 - x < 6 ? 'end' : 'move';
                setDrag({ id: c.id, mode, dx: x - x0 });
              }} style={{ cursor: 'grab' }} />
            {fi > 0 && <path d={`M${x0},${ROW_H - 4} L${x0 + fi},12`} stroke="#1864ab" fill="none" pointerEvents="none" />}
            {fo > 0 && <path d={`M${x1 - fo},12 L${x1},${ROW_H - 4}`} stroke="#1864ab" fill="none" pointerEvents="none" />}
            <text x={x0 + 4} y={26} fontSize={10} fill="#1864ab" pointerEvents="none">{c.name}</text>
          </g>
        );
      })}
    </svg>
  );
}

function ClipInspector({ song, trackId, clip, store, playMs }: { song: Song; trackId: string; clip: AudioClip; store: Store; playMs: number }) {
  const num = (label: string, key: 'fadeInMs' | 'fadeOutMs' | 'gainDb', min: number, max: number, step: number, title: string) => (
    <label title={title}>{label}
      <input type="number" min={min} max={max} step={step} value={Math.round(clip[key] * 10) / 10} style={{ width: 70 }}
        onChange={(e) => store.edit((s) => updateClip(s, trackId, clip.id, { [key]: Math.max(min, Math.min(max, Number(e.target.value))) }), 'Clip ' + label.toLowerCase(), 'clip-' + key + clip.id)}
        data-testid={'clip-' + key} />
    </label>
  );
  return (
    <div className="rec-row" data-testid="clip-inspector">
      <b>{clip.name}</b>
      <span className="hint">bar {clip.bar + 1}, {(clip.lengthMs / 1000).toFixed(2)} s</span>
      {num('Fade in (ms)', 'fadeInMs', 0, clip.lengthMs, 10, 'Fade in: the clip starts silent and gets louder over this many milliseconds, to avoid a sudden start or click')}
      {num('Fade out (ms)', 'fadeOutMs', 0, clip.lengthMs, 10, 'Fade out: the clip gets quieter over this many milliseconds at its end, for a smooth finish')}
      {num('Volume (dB)', 'gainDb', -48, 24, 0.5, 'Clip volume (gain) in dB: make just this clip louder (+) or quieter (-) when it is too loud or too soft')}
      <button onClick={() => store.edit((s) => splitClipAtMs(s, trackId, clip.id, playMs), 'Split clip')} title="Cut the clip in two where the play position is, e.g. to move or delete one part">Split at playhead</button>
      <button onClick={() => store.edit((s) => removeClip(s, trackId, clip.id), 'Delete clip')} title="Delete this clip from the track (Undo brings it back; the audio file stays on disk)">Delete</button>
      <span className="hint">{song.title}</span>
    </div>
  );
}

export function AudioPanel({ state, store, status }: { state: AppState; store: Store; status: PlayerStatus | null }) {
  const song = state.song!;
  const rec = useRecorder();
  const ctl = audioCtl.current;
  const [sel, setSel] = useState<string | null>(null);
  const [countIn, setCountIn] = useState(true);
  const [metro, setMetro] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    void recorder.refreshDevices();
    void window.mg.settingsGet().then((s) => { if (typeof s.latencyMs === 'number') recorder.setLatency(s.latencyMs); });
  }, []);
  const audioTracks = song.tracks.filter((t) => t.audio);
  const starts = barStartTicks(song);
  const curBar = status?.currentBar ?? 0;
  const playMs = status ? posToMs(song, 0, status.songTick) : 0;
  void starts;
  const selTrack = song.tracks[state.selTrack];
  const armedId = selTrack?.audio ? selTrack.id : audioTracks[0]?.id ?? null;
  const selClip = audioTracks.flatMap((t) => t.audio!.clips.map((c) => ({ t, c }))).find((x) => x.c.id === sel);
  return (
    <div className="audio-panel" data-testid="audio-panel">
      <div className="rec-row">
        <HelpButton topic="audio-tracks" label="panel" />
        <button onClick={() => ctl?.addTrack()} data-testid="add-audio-track" title="Add a track for real sound (a recording or an audio file) next to the written parts, e.g. your own voice or guitar">+ Audio track</button>
        <button onClick={() => void ctl?.importFile(null, armedId, curBar)} title="Put an audio file (WAV, MP3, OGG or FLAC) on the audio track at the current bar, e.g. a drum loop or a recorded part">Import audio…</button>
        <span className="lbl" style={{ marginLeft: 10 }}>Input</span>
        <select title="Which microphone or audio interface to record from (none = recording off)" value={rec.deviceId ?? ''} onChange={(e) => {
          const id = e.target.value;
          if (id === '') recorder.close();
          else void recorder.openDevice(id === 'default' ? null : id).then(() => window.mg.settingsSet({ audioInput: id }));
        }} data-testid="audio-input">
          <option value="">none</option>
          {rec.simulated && <option value="simulated">simulated (test)</option>}
          <option value="default">System default</option>
          {rec.devices.filter((d) => d.id !== 'default').map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <button onClick={() => void recorder.refreshDevices()} title="Look for microphones and interfaces again, e.g. after plugging one in">↻</button>
        <span className="in-meter" title="Input level: how loud the microphone/input is; red = too loud, turn the input down"><div style={{ width: Math.min(100, rec.level * 100) + '%', background: rec.level > 0.98 ? '#e03131' : undefined }} /></span>
        <label className={`toggle ${rec.monitor ? 'on' : ''}`} title="Hear yourself: play the input through the track's speakers while recording (monitor; off by default, use headphones)">
          <input type="checkbox" checked={rec.monitor} onChange={(e) => recorder.setMonitor(e.target.checked, armedId)} /> Hear input
        </label>
        <label className={`toggle ${countIn ? 'on' : ''}`} title="Count-in: one bar of clicks before recording starts, so you can come in on time"><input type="checkbox" checked={countIn} onChange={(e) => setCountIn(e.target.checked)} /> Count-in (clicks before playing)</label>
        <label className={`toggle ${metro ? 'on' : ''}`} title="Metronome: a click on every beat while you record, to keep in time"><input type="checkbox" checked={metro} onChange={(e) => setMetro(e.target.checked)} /> Metronome</label>
        <MoreOptions title="Timing correction for your audio interface; only needed if recordings come out late">
          <label title="Delay correction (round-trip latency): recordings are moved earlier by this many milliseconds; fix it here if recordings sound late">Delay correction
            <input type="number" min={0} max={1000} step={0.5} value={rec.latencyMs} style={{ width: 64 }}
              onChange={(e) => { recorder.setLatency(Number(e.target.value)); void window.mg.settingsSet({ latencyMs: Number(e.target.value) }); }} data-testid="latency" /> ms
          </label>
          <button disabled={!rec.open || !!busy} title="Measure the delay correction: connect the interface's output to its input with a cable, then press this"
            onClick={async () => {
              setBusy('Measuring…');
              try {
                const ms = await recorder.measureLatency();
                if (ms === null) store.showError('No click came back: connect the output to the input with a cable (and turn the volume up).');
                else void window.mg.settingsSet({ latencyMs: ms });
              } finally { setBusy(null); }
            }}>Measure it</button>
        </MoreOptions>
        {!ctl?.recording ? (
          <button className="primary" disabled={!rec.open || !!busy} data-testid="audio-record" title="Record from the input onto the audio track, starting at the current bar (pick an Input first)"
            onClick={() => void ctl?.startRecording({ trackId: armedId, startBar: curBar, countIn, metronome: metro }).then(() => setBusy('Recording…')).catch((e) => store.showError((e as Error).message))}>● Record</button>
        ) : (
          <button className="primary" data-testid="audio-stop" title="Stop recording and keep what was recorded as a clip" onClick={() => void ctl.stopRecording().finally(() => setBusy(null))}>■ Stop</button>
        )}
        {busy && <span className={ctl?.recording ? 'recording' : 'hint'}>{busy}</span>}
        {rec.error && <span className="hint" style={{ color: '#c92a2a' }}>{rec.error}</span>}
      </div>
      {selClip && <ClipInspector song={song} trackId={selClip.t.id} clip={selClip.c} store={store} playMs={playMs} />}
      <div className="lanes">
        {audioTracks.map((t) => (
          <div key={t.id} className="lane">
            <div className="lane-head"><b>🎙 {t.name}</b>{t.id === armedId && <span className="tag">armed</span>}
              <span className="hint">{t.audio!.clips.length} clips · drag to move (1/16 grid), drag an edge to trim</span></div>
            <ClipRow song={song} trackId={t.id} clips={t.audio!.clips} store={store} sel={sel} setSel={setSel} />
          </div>
        ))}
        {!audioTracks.length && <div className="hint" style={{ padding: 10 }}>No audio tracks yet: “+ Audio track”, then import a file or record.</div>}
      </div>
    </div>
  );
}
