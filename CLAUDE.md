# musicGenie: Project Context & Rules

A Windows desktop music studio: import or write music, assign any instrument
to any part, hear it played by a virtual band, and (later) export guitar/bass
parts as Rocksmith 2014 custom songs. Full vision and roadmap:
`Docs/VISION.md`. Current work: `TODO.md`.

## Tech Stack (decided 2026-11-16)
- **App:** Electron + TypeScript, built with Vite (electron-vite is fine).
  Plain TS + a light UI layer (React or Svelte, Code's pick; say which in the
  Round 1 report and keep it).
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
<!-- Code fills these in during Round 1: install, dev run, build exe, tests. -->

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
New, empty repo. Round 1 (app shell, music model, import, score + tab view,
instrument assignment, playback) is the current round.
