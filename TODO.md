# musicGenie: Active Development Plan

## Standing rules
- Read `CLAUDE.md` first. Its testing rules (always muted with proof, never
  steal focus) apply to every check.
- Report per item: done / not done / deferred, and why. Never skip an item
  silently.
- One check per item, done in the built app, with screenshots you look at.

## Completed Tasks
None yet.

## Current Objective: Round 1, "import it, see it, hear it with other instruments"
Goal: open a piano piece, show it as notation/tabs, give its parts other
instruments, and play it with the score following along.

1. **Project setup.** Electron + TypeScript + Vite, Vitest for unit tests,
   `.gitignore` (node_modules, build output), a Windows build (installer or
   portable exe), the `--mute` flag, and a test harness that starts the app
   hidden and takes screenshots. Put exact commands in `CLAUDE.md`.
   Check: the built exe starts hidden with `--mute`, a screenshot is taken,
   and the measured output level is 0.
2. **Music model + project files.** The model described in `CLAUDE.md`
   (including string/fret/techniques on notes, instrument + tuning on tracks,
   tempo map, sections, chord symbols, lyrics). Save/load `.mgproj` with
   `schemaVersion`. Check: unit tests pass; a saved and reopened project is
   identical (deep-equal).
3. **Import.** MusicXML and Guitar Pro (3-7) via alphaTab's importers, MIDI via
   `@tonejs/midi`, all converted into our model. Collect a few freely
   licensed test files in `TestData/` (note the source of each in
   `TestData/README.md`), including one piano piece with both hands.
   Check: one file of each type; track, measure and note counts match the
   source.
4. **Score view.** Show the song with alphaTab: per track choose notation,
   tabs or both; choose which tracks are shown. Check: screenshot of a piano
   piece as notation, and of a guitar track as notation + tabs.
5. **Playback.** Play/pause/stop; the cursor follows and highlights the
   current notes; click a measure to play from there; loop a selected range;
   metronome and count-in toggles. Check: hidden, muted run; screenshot
   partway through shows the cursor in the expected measure.
6. **Tracks panel.** Per track: instrument picker (grouped: keys, guitars,
   basses, strings, brass, winds, synths, drums), mute, solo, volume, pan.
   Changing the instrument changes the sound only, never the notes.
   Check: change a piano track to electric guitar; the model's notes are
   unchanged (test); one sound check of 10 seconds or less.
7. **Speed and transpose.** Playback speed 25-150% (practice setting, does not
   change the song), and transpose the whole song or one track by semitones
   (changes the song; guitar/bass string and fret are recalculated to
   playable positions). Check: transpose +2 and verify pitches in a test;
   screenshot of the transposed score.
8. **Undo/redo + autosave.** Undo/redo for every model edit in this round
   (instrument, transpose, track settings). Autosave a recovery copy every 2
   minutes; offer to restore it after a crash. Check: unit test for
   undo/redo; kill the app and confirm the restore offer appears.

### For Dan to check (fill in at end of round)

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
