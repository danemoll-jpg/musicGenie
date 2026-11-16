# musicGenie: Active Development Plan

## Standing rules
- Read `CLAUDE.md` first. Its testing rules (always muted with proof, never
  steal focus) apply to every check.
- Report per item: done / not done / deferred, and why. Never skip an item
  silently.
- One check per item, done in the built app, with screenshots you look at.

## Completed Tasks
### Round 1, "import it, see it, hear it with other instruments" (2026-11-16): DONE
All checks ran in the built app, hidden (off-screen, never shown/focusable) and
`--mute`; speaker level (post-gain analyser) measured 0 on every playing step.
Unit tests: 24/24 pass (`npm test`). Screenshots: `test-results/*.png`.
1. Project setup: **done.** Electron 45 + TS + electron-vite (Vite 8) + React 19,
   Vitest, `.gitignore`, `npm run dist` -> portable exe + `win-unpacked`, `--mute`,
   Playwright harness (`tests/e2e`). Check: packaged exe hidden + focused=false,
   playing: pre-gain peak 0.61, speaker peak **0**.
2. Model + .mgproj: **done.** Song/bars/tempo map/sections/chords/lyrics,
   tracks (instrument, tuning, capo, mixer, display), staves/measures/voices/beats/
   notes with string, fret and all listed techniques. Check: save -> reopen is
   deep-equal for all 4 test songs; schemaVersion 99 rejected with a clear message.
3. Import: **done.** Counts match the source: MusicXML 1/16/108 (tracks/measures/
   notes, independent XML count), GP7 11/96/4422, GP5 1/2/20, GP3 1/1/28,
   MIDI 2/35/549 (vs @tonejs/midi). Sources in `TestData/README.md`.
4. Score view: **done.** Per-track show/hide and notation/tab/both. Check:
   piano notation (both hands) and GP acoustic guitar as notation + tab screenshots.
5. Playback: **done.** Play/pause/stop, cursor + note highlight, click a beat to
   play from there, drag-select bars + Loop, metronome, count-in. Check: cursor in
   bar 3 at screenshot; pause holds; seek -> bar 9; loop stayed in bars 5-6.
6. Tracks panel: **done.** Grouped instrument picker (8 groups), M/S, volume, pan,
   per-track transpose. Check: piano -> electric guitar leaves notes identical
   (unit + app). **Sound check: item 6 step, unmuted 2.06 s** (speaker peak 0.32,
   0 after). A first 3 s attempt also played; its "after" reading failed on
   analyser lag, harness fixed.
7. Speed + transpose: **done.** Speed 25-150% (practice only). Check: 50% plays at
   0.50x tick rate, song unchanged; +2 raises all 108 pitches by 2, C -> D major,
   chord C -> D; frets re-placed to playable positions (unit tests).
8. Undo/redo + autosave: **done.** Every edit undoable (Ctrl+Z / Ctrl+Y), autosave
   every 2 min, restore banner after a crash. Check: unit + app undo/redo exact;
   killed the app after autosave, relaunch showed the restore offer, restore worked.

### For Dan to check
- Run `dist\musicGenie-0.1.0-portable.exe` (or `npm run dev`). Open
  `TestData\ode-to-joy-piano.musicxml`, press Play: does it sound right and does
  the cursor follow? Then switch Piano to Electric Guitar and to a guitar view.
- Open `TestDataull-song.gp`: hide tracks, switch a guitar to Tab/Both.
- Drag across bars, tick Loop; try Speed 50%; Transpose +2; Undo.
- Known limits: MIDI import quantises to 16ths (no triplets yet) and holds only
  one voice per staff; the default sonivox SoundFont sounds basic; app has the
  default Electron icon; exe is unsigned (SmartScreen may warn).

## Current Objective
Round 1 is finished and waiting for Dan's check. Do not start Round 2 until Dan
says so.

## Next Steps (Do Not Start Yet)
- **Round 2: virtual band v1.** Split a piano part into melody / bass /
  chords; recognise chords into chord symbols; style templates (rock, blues,
  country, jazz, pop) that write drums, bass and rhythm guitar/keys from the
  chords; regenerate per section; "simplify / busier" control per player.
- **Round 3: tab editing + Rocksmith.** Edit notes and techniques on the tab;
  import a .psarc (chart into the model, its audio as a backing track);
  export guitar/bass parts as a .psarc via the .NET helper (backing audio
  from the band mix or a loaded recording, difficulty levels generated).
  Needs Wwise 2019/2021 on Dan's PC; ask him before this round starts.
- **Round 4: composition.** Note entry on the staff, piano roll, chord
  explorer (every way to play a chord, hear it, insert it), drum step
  sequencer.
- **Round 5: production.** Effects (reverb, delay, distortion, EQ,
  compression), recorded audio tracks, export WAV/MP3/MIDI/MusicXML/PDF.
- **Later, unordered:** MIDI keyboard recording (could move earlier), better
  sound libraries / VST3 instruments, singing, "describe it" assisted
  composition, PDF score reading (Audiveris), audio to notes (basic-pitch),
  stem splitting (Demucs). Plug these in from existing tools, don't build them.

## Technical Notes / Blockers
- Reference Rocksmith file examined 2026-11-16 (Hüsker Dü, "Could You Be The
  One", bass): the .psarc holds the arrangement XML (song version 7: notes
  with time/string/fret/techniques, phrases, sections, 7 difficulty levels),
  .sng, Wwise .bnk/.wem audio + preview, DDS album art, showlights, manifest
  JSON, xblock. The TOC is AES-encrypted with the well-known Rocksmith key.
  Charts are time-based (seconds) with beat markers, so export converts from
  our measure/beat model through the tempo map.
- Releases: local builds only for now (this is an app, not one of the games,
  so the game launcher doesn't apply). Revisit if Dan wants auto-update.
