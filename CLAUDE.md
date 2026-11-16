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
  to .wem needs Wwise 2019 or 2021 installed on Dan's PC.
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
- Project format v2 (`SCHEMA_VERSION = 2`): `song.playback` (swing, soundFont),
  `song.band` (panel setup), `track.generated` (style, role, complexity, seed,
  sectionSeeds, contentHash), `track.derived` (split parts), `chordSymbols[].source`.
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

## Where things stand
**Always check `TODO.md` for the current objective before starting work.**
Rounds 1-2 done: import (MusicXML, Guitar Pro, MIDI), score + tab view,
playback, instruments, mixer, speed, transpose, undo, autosave; virtual band
(chord detection, part split, sections, 5 styles, band panel, GeneralUser GS).
Current round: Round 3, note/tab editing, techniques, tunings, and Rocksmith
.psarc import + export through the .NET helper.
Layout: `src/model` (pure model + edits + undo + .mgproj, chords, split,
sections, band engine),
`src/import` (alphaTab + MIDI importers), `src/render/toAlphaTab.ts`,
`src/main` (Electron, settings.json), `src/preload`, `src/renderer` (React UI,
Band panel, dialogs, player, store, test API), `tests/unit`, `tests/e2e`, `TestData` (sources in its README).
