# musicGenie: Project Context & Rules

A Windows desktop music studio: import or write music, assign any instrument
to any part, hear it played by a virtual band, and (later) export guitar/bass
parts as Rocksmith 2014 custom songs. Full vision and roadmap:
`Docs/VISION.md`. Current work: `TODO.md`.

## Tech Stack (decided 2026-11-16)
- **App:** Electron + TypeScript, built with Vite (electron-vite is fine).
  Plain TS + a light UI layer: **React 19** (picked in Round 1; keep it).
- **Notation / tabs / playback:** alphaTab (`@coderline/alphatab`). It draws
  standard notation and guitar tabs, plays through its built-in SoundFont
  synth, and moves a cursor along the score as it plays. Start with the
  SoundFont alphaTab ships with; let the user load another .sf2/.sf3 later.
- **Importers:** MusicXML and Guitar Pro (3-7) go through alphaTab's own
  importers. MIDI goes through `@tonejs/midi`. Every importer converts into
  OUR model (see below), never straight into the UI.
- **MIDI keyboard (later):** Web MIDI in Electron's Chromium.
- **Rocksmith (Round 3+):** a small .NET 8 helper (`helpers/rocksmith/`) using
  iminashi's Rocksmith2014.NET libraries (the same code DLC Builder uses) to
  read and write .psarc files and generate difficulty levels. Converting audio
  to .wem needs Wwise 2019/2021/2022/2023 installed on Dan's PC (DLC Builder
  documents 2019 and 2021; the library also accepts 2022 and 2023).
- **Later plug-in tools, not built ourselves:** Audiveris (reading PDF scores),
  basic-pitch (audio to notes), Demucs (splitting a recording into stems),
  OpenUtau/DiffSinger or Synthesizer V export (singing).

## Code Style & Architecture
- **One music model is the source of truth** (`src/model/`). Song -> tracks
  -> measures -> voices -> notes, plus a tempo map, time-signature changes,
  key changes, chord symbols, sections (intro/verse/chorus...) and lyrics.
  Every screen (score, tabs, later piano roll, mixer) is a view of this
  model. Editing anywhere edits the model; views redraw from it.
- **Notes carry guitar data from day one:** optional string, fret, and
  techniques (hammer-on, pull-off, slide, bend, vibrato, palm mute, harmonic,
  tap, slap/pop, accent, tie/sustain). Rocksmith export needs all of this, so
  it must not be bolted on later.
- **Instrument choice belongs to the track** (instrument + its tuning for
  guitar/bass), separate from the notes, so the same notes can be played by
  any instrument.
- alphaTab is a renderer/player: convert model -> alphaTab Score for display
  and playback. Don't let alphaTab's objects become the stored data.
- Project files: `.mgproj`, JSON, with a `schemaVersion` field. Write a
  loader that rejects unknown future versions with a clear message.
- Keep the model free of Electron/DOM imports so it can be unit-tested in
  plain Node.

## Commands
Run heavy jobs at Below Normal, e.g. `cmd /c "start /belownormal /b /wait npm run dist"`.
- Install: `npm install`, then `node node_modules/electron/install.js` (npm 11's
  allow-scripts skips Electron's binary download).
- Dev run (visible window, for Dan): `npm run dev`
- Unit tests (model, import counts, save/load, transpose, undo, chords, split, band styles): `npm test`
- Typecheck: `npm run typecheck`
- Build: `npm run build` (-> `out/`). Windows app: `npm run dist` ->
  `dist/win-unpacked/musicGenie.exe` + `dist/musicGenie-<ver>-portable.exe`.
- App checks (hidden + muted, screenshots in `test-results/`, report in
  `test-results/report.json`): `npm run e2e` (packaged exe) or `npm run e2e:dev`
  (after `npm run build`). Options: `--only=1,5`, `--no-sound-check`.
  Item 6 is the only step that unmutes (2 s); always pass `--no-sound-check`
  unless a sound check is actually needed.
- Round 2 app checks: `npm run e2e:r2` (packaged) / `npm run e2e:r2:dev`; report
  `test-results/report-round2.json`. Sound checks: item 1 (2 s) and item 7 (4 s); skip
  with `--no-sound-check`.
- From Git Bash, `cmd //c "start /belownormal ..."` hangs: run Below Normal builds from
  PowerShell (`cmd /c "start /belownormal /b /wait npm run build"`).
- Regenerate the MusicXML test piece: `node tests/fixtures/make-ode-to-joy.mjs`
- Rocksmith helper (.NET 8, needs the .NET SDK 8+ to build and the .NET 8 runtime to run):
  `git submodule update --init` once, then from PowerShell
  `cmd /c "start /belownormal /b /wait npm run helper"` -> `helpers/rocksmith/bin/MgRocksmith.exe`
  (gitignored). Build it BEFORE `npm run dist`: the exe ships it as `resources/rocksmith/`.
  One-shot use: `MgRocksmith.exe ping|findWwise|findRocksmith`, `MgRocksmith.exe read <file.psarc>`;
  JSON args go over stdin (`{"id":1,"cmd":"write","args":{...}}`, one per line).
- Round 3 app checks: `npm run e2e:r3` (packaged) / `npm run e2e:r3:dev`; report
  `test-results/report-round3.json`. No sound checks. Items 4, 5 and 8 use the private
  reference file `TestData/private/Husker-Du_...psarc` and skip without it; its unpacked
  copies and re-export are deleted at the end of the run.
- Round 4 app checks: `npm run e2e:r4` (packaged) / `npm run e2e:r4:dev`; report
  `test-results/report-round4.json`. No sound checks (nothing unmutes). Item 7 drives the
  MIDI recorder with a simulated input (`mgTest.midiSimulate`); no keyboard needed.

## Standing facts
- App flags: `--mute` (master gain 0 before any audio), `--hidden` (off-screen
  rendering, never shown or focusable, exposes `window.mgTest`),
  `--profile-dir=DIR`, `--autosave-ms=N` (default 120000), `--open=FILE`.
- Master bus (`src/renderer/src/audio/masterBus.ts`) patches
  `AudioNode.connect` so everything bound for the speakers goes pre-analyser ->
  gain -> post-analyser. `post` peak is the proof of silence; `pre` peak proves
  audio was really produced. It must stay the FIRST import in `main.tsx`.
- Hidden windows use `webPreferences.offscreen` in test mode: plain
  `show:false` windows returned stale `capturePage()` screenshots.
- alphaTab 1.9 quirks: key signatures live on `Bar`, not `MasterBar`; every bar
  of a staff needs the same voice count; string 1 = LOWEST string (our model
  uses the same; tuning arrays are lowest-first, alphaTab's highest-first);
  `clearPlaybackRangeHighlight()` leaves private `_selectionStart/_selectionEnd`
  that crash the next render, so `ScorePlayer.clearRange()` resets them.
  Rendering runs on the page thread (`core.useWorkers = false`) so errors surface.
- Model ticks: PPQ 960 (same as alphaTab). MIDI import quantises to 16ths and
  splits one two-hand piano track into treble/bass staves at middle C.
- Recovery: `userData/recovery/session.lock` + `autosave.mgproj`; a lock left by
  a crash turns the autosave into a restore offer on next start.
- Default SoundFont: GeneralUser GS 2.0.3 (S. Christian Collins), tracked in
  `src/renderer/public/sounds/` with its licence (GeneralUser GS License v2.0: free use,
  "use it in your software projects", may repackage). `public/soundfont/` and
  `public/font/` are gitignored (the alphaTab Vite plugin fills them). The user's
  SoundFont path is in `userData/settings.json` and in the project (`playback.soundFont`).
- Project format v4 (`SCHEMA_VERSION = 4`; v4 adds `tempos[].ramp` / `tempos[].rampTo` for gradual
  tempo changes and `song.chart` = the chord chart text). Older: v2 = `song.playback` (swing, soundFont),
  `song.band` (panel setup), `track.generated` (style, role, complexity, seed,
  sectionSeeds, contentHash), `track.derived` (split parts), `chordSymbols[].source`;
  v3 adds `song.backing` (recording: path, offsetMs = where bar 1 starts in it, volume,
  mute), `song.rocksmith` (last export settings), `track.rocksmith` (arrangement type,
  tone), techniques `tremolo` and `slideToFret`. Older files open unchanged.
- Frets count from the NUT, also with a capo (pitch = tuning[string-1] + fret), like
  Rocksmith. alphaTab counts from the capo: `toAlphaTab` subtracts the capo, `fromAlphaTab`
  adds it. Typing "0" on a capoed string means the capo fret.
- Note editing (`src/model/noteEdit.ts`): pure cursor edits; every voice is refitted to
  exactly one bar after an edit (rests fill, overflow drops beats from the end). Keys in
  `src/renderer/src/editor.ts`; tests drive them with `mgTest.key()` (window keydown, no
  OS focus needed).
- Rocksmith (`src/model/rocksmith.ts`, pure): the helper turns .psarc/.rs2dlc/.xml into
  JSON (times in ms, strings 0-based, raw note masks, all difficulty levels merged with
  `RemoveDD`) and back. Import: every ebeat = one quarter note at its own tempo (tempo map
  per beat, 32nd grid); stray markers closer than 1/4 beat are dropped. Export adds a
  lead-in (whole bars, >= 2 s, COUNT phrase) and a one-bar tail (END phrase + `noguitar`),
  phrases one per section, auto anchors, chord templates + handshapes; the WAV gets the same
  lead-in so chart and audio line up. Re-importing an export therefore has the lead-in bars
  in front and the tail bar at the end.
- Rocksmith helper (`helpers/rocksmith/MgRocksmith`, F#): Rocksmith2014.NET by iminashi,
  **MIT licence**, git submodule `helpers/rocksmith/Rocksmith2014.NET` pinned to tag
  **v3.5.0** (only `Rocksmith2014.XML` is on NuGet). The library pins Magick.NET 14.7.0,
  which has security advisories: the helper references the patched 14.17.2 and builds with
  `-p:NuGetAudit=false` (the audit otherwise fails the submodule's own restore). Electron
  runs it at Below Normal (`src/main/rocksmithHelper.ts`). Export stops before Wwise if it
  is missing and keeps the XML, WAV, preview, cover and a DLC Builder `.rs2dlc`.
- Wwise on Dan's PC (installed 2026-11-16): **Wwise 2023.1.19.8928**, Authoring only, at
  `C:\Audiokinetic\Wwise2023.1.19.8928` (WwiseConsole in `Authoring\x64\Release\bin`),
  through the Wwise Launcher 2026.2.0 (`C:\Program Files\Wwise Launcher\`). The Launcher
  lists only the newest Wwise (2026.x, unsupported) unless the version filter is set to All.
  The launcher sets `WWISEROOT` in the registry; processes started earlier don't see it, so
  the helper (`ensureWwiseRoot`) fills it in from the registry (User/Machine) or by searching
  `X:\Audiokinetic`, `X:\Program Files (x86)\Audiokinetic`, `X:\Program Files\Audiokinetic`
  on every fixed drive for a 2019/2021/2022/2023 folder.
- Rocksmith 2014 on Dan's PC: `E:\Rocksmith2014` (not in a Steam library folder; Steam's
  manifest still lists app 221680 under C:). The helper searches Steam libraries, then
  `X:\Rocksmith2014`, `X:\SteamLibrary\...`, `X:\Games\...` on every fixed drive. Dan's
  choice is saved as `rocksmithDlc` in `userData/settings.json`.
- Backing track: an `<audio>` element follows the player position (seek on start/jumps,
  re-seek past 120 ms drift) through the master bus, so `--mute` covers it.
- Audio export: alphaTab's `exportAudio` synthesises offline (~100x real time, never
  through the speakers; it ignores swing and stored mute/solo, so `renderMix` sets track
  volumes itself).
- Band engine (`src/model/band.ts`) is pure and seeded: same song + settings + seed = same
  notes. "Edited by hand" = staves hash differs from `generated.contentHash`.
- Swing is applied at playback only, in `api.midiLoad` (`src/render/swing.ts`).
- alphaTab ignores `playbackInfo.isMute/isSolo` when building playback, so
  `ScorePlayer` re-applies mute/solo on every `midiLoaded`.
- Never use native dialogs for questions (they would show over a hidden test window):
  `store.ask()` shows an in-app one.

## Testing on Dan's PC: STANDING RULES
Dan uses his PC while you test. Your test runs must not be heard and must not
get in his way.
1. **Always muted.** Every test launch uses a `--mute` command-line flag that
   sets the master volume to 0 before any audio starts (not a saved setting,
   not muting after start-up). **Prove it:** the check reports the measured
   output level (an analyser node on the master bus), and it must be 0.
   Sound checks: unmute only for that check, as briefly as possible, and say
   which step played sound and for how long.
2. **Never steal focus.** Test windows start hidden (`show: false`, take
   screenshots with `webContents.capturePage()`), or use Playwright's Electron
   driver without bringing a window forward. If a test truly needs a visible
   or focused window, stop and ask Dan first.
- One heavy job at a time (installs, builds), at Below Normal priority.
- Targeted testing: one check per item, in the built app, with screenshots you
  actually look at.
- Clean up build leftovers at the end of every round.

## Round process
1. Start of round: commit the repo as it is (a safety checkpoint).
2. Build the current round in `TODO.md`, item by item.
3. End of round: update `TODO.md` (per item: done / not done / deferred and
   why, plus "For Dan to check") and this file (commands, standing facts,
   "Where things stand"), then commit and push.
Short results: about 20 lines per round, one line per item plus its check.

- Piano roll / drum grid / MIDI takes edit notes as events (`src/model/pianoRoll.ts`):
  `setStaffNotes` rebuilds ONLY the bars an edit touched (plus bars a tied note crosses), so
  untouched bars keep their notation. Overlapping notes go to extra voices (`layoutVoices`;
  alphaTab draws voice 2+ grey). Fretted tracks get string/fret via `assignChord` (capo kept).
  `splitTicks` writes off-grid lengths as triplets, split at beat boundaries.
- Live notes (chord explorer, piano-roll keys, drum lanes, MIDI keyboard):
  `audio/liveSynth.ts` = a SECOND alphaTab `AlphaSynth` on the page thread with a dummy
  output; we call its internal `synthesizer` (TinySoundFont: channelNoteOn/Off, synthesize)
  from a ScriptProcessor. alphaTab's own player is in a worker and `playNote` stops the song,
  so this is the only way to play notes over the song. Goes through the master bus (--mute).
- Playback ticks vs model ticks: alphaTab plays repeats unrolled. `ScorePlayer.barStartTick`
  uses `api.tickCache.getMasterBarStart`; `status.songTick` = position folded back onto the
  model (piano-roll playhead, MIDI recording clock).
- MIDI recording clock: anchors (performance.now, songTick) from position updates once the
  count-in is over; note times are mapped at Stop (`MidiRecorder` + `quantizeNotes`), notes
  before the start bar are dropped. Quantise "none" still snaps to 1/64.
- Tempo ramps: one tempo point per beat; the first carries `rampTo`, the rest `ramp: true`
  (`src/model/songChanges.ts`). Time-signature changes refit bars (`fitVoice`) and regenerate
  the band in the same undo step if no band track was edited.
- Drum patterns saved by the user live in `userData/settings.json` (`drumPatterns`), the
  last MIDI input in `midiInput`.

## Where things stand
**Always check `TODO.md` for the current objective before starting work.**
Rounds 1-4 done: import, score/tab view, playback, mixer basics, undo,
autosave; virtual band (5 styles); tab editing, techniques, tunings,
Rocksmith .psarc import/export (in-game test still pending Dan); piano roll,
chord explorer, progression helper, drum grid, chord charts, key/time/tempo
changes, harmony, MIDI keyboard. Current round: Round 5, production (per-track
playback engine, mixer, effects, automation, audio tracks, keyboard piano,
export).
Layout: `src/model` (pure model + edits + undo + .mgproj, chords, split,
sections, band engine, noteEdit, tunings, tempo, rocksmith, pianoRoll, chordTheory,
progressions, drums, songChanges, chart, harmony, recording),
`src/import` (alphaTab + MIDI importers), `src/render/toAlphaTab.ts`,
`src/main` (Electron, settings.json, Rocksmith helper process), `src/preload`,
`src/renderer` (React UI, Band panel, dialogs, Round3.tsx edit bar/tuning/export dialog,
editor keys, player, backing + offline audio, store, test API), `helpers/rocksmith`
(.NET helper + library submodule), `tests/unit`, `tests/e2e`, `TestData` (sources in its README).
