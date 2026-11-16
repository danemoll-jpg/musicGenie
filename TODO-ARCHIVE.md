# musicGenie: Archived Rounds

Finished rounds moved out of `TODO.md` word for word.

### Round 1, "import it, see it, hear it with other instruments" (2026-11-16): DONE, Dan checked (no issues found, 2026-11-16)
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

Dan's check list for Round 1 (done):
- Run `dist\musicGenie-0.1.0-portable.exe` (or `npm run dev`). Open
  `TestData\ode-to-joy-piano.musicxml`, press Play: does it sound right and does
  the cursor follow? Then switch Piano to Electric Guitar and to a guitar view.
- Open `TestData\full-song.gp`: hide tracks, switch a guitar to Tab/Both.
- Drag across bars, tick Loop; try Speed 50%; Transpose +2; Undo.
- Known limits: MIDI import quantises to 16ths (no triplets yet) and holds only
  one voice per staff; the default sonivox SoundFont sounds basic; app has the
  default Electron icon; exe is unsigned (SmartScreen may warn).

### Round 2, "virtual band v1" (2026-11-16): DONE, Dan moved on to Round 3 with no issues reported
Checks ran in the packaged app (`npm run e2e:r2`), hidden (off-screen, never shown or
focusable) and `--mute`; speaker level measured 0 on every playing step. Unit tests 84/84
(`npm test`). Screenshots: `test-results/r2-*.png`; report `test-results/report-round2.json`.
Sound: 2 checks, both unmuted only for the step: **item 1, 2.0 s** (Ode to Joy piano,
GeneralUser GS) and **item 7, 4.0 s** (Rock band); speaker level back to 0 after each.
1. Better sounds: **done.** GeneralUser GS 2.0.3 bundled (licence allows use in software,
   `src/renderer/public/sounds/`). Settings > Load SoundFont (.sf2/.sf3), remembered in
   app settings and in the project. Check: default plays (pre 0.12, speaker 0); sonivox.sf2
   loaded as a user SoundFont, still chosen after a relaunch, "built-in" restores the default.
2. Chord recognition: **done.** Per bar / half bar / beat, weighted by length, beat and bass;
   maj, min, 7, maj7, m7, dim, dim7, m7b5, aug, sus2/4, power, slash. Detect keeps file chords
   unless "Replace" is ticked; click a chord in the score for a picker. Check: Bach Prelude
   35/35 bars (100%), Ode to Joy 15/16 (93.8%, bar 4 read as Em7/G then G); click C -> Am in app.
3. Split a part: **done.** Track > Split: melody / harmony / bass tracks, source kept muted.
   Check: Ode piano -> 3 parts (melody E E F G..., bass C3...); unit test: every note in
   exactly one part, same times (also on every GP track).
4. Sections: **done.** Drag over bars, pick a name, "Name bars x-y"; shown above the score,
   chips in the Band panel. Check: Intro 1-4 / Verse 5-12 / Chorus 13-16 screenshot.
5. Style engine: **done.** Rock, Blues (shuffle), Country, Jazz (swing), Pop; drums with
   section-end fills + crash, bass (root/8ths, boogie, boom-chick, walking, follow kick),
   rhythm (power chords, boogie, strum, shell comping, arpeggios), lead = melody moved to
   the instrument's range; swing is a song playback setting; optional held ending.
   Check: unit tests per style: in range, chord tones, playable frets, deterministic per seed.
6. Band panel: **done.** Style, play-along track, lineup + instrument + Simple/Normal/Busy per
   player, lead octave, bass follows kick, ending, Generate, Try another, Regenerate
   (section and/or player), Feel slider. Check: Rock on Ode -> drums, bass, guitar, lead with
   notation + tabs; hand-edited bass -> Regenerate asked first, Cancel kept it.
7. Band playback: **done.** Check: all 5 styles, each generated track soloed sounds
   (pre > 0), speaker 0, cursor moving, all band tracks muted -> silent. Found + fixed a
   Round 1 bug: a track muted before a re-render still played (alphaTab ignores stored mute).
8. Save/load + undo: **done** (project format v2; v1 files still open). Check: save ->
   reopen deep-equal with tags, section seeds, chords, sections, swing, SoundFont; undo
   after Generate + Regenerate restores the song exactly.

Dan's check list for Round 2 (fill in what you find):
- Run `dist\musicGenie-0.2.0-portable.exe` (or `npm run dev`). Sounds should be fuller
  (GeneralUser GS). Settings (top right) > Load SoundFont to try another .sf2/.sf3.
- Open `TestData\ode-to-joy-piano.musicxml`. The Band panel is on the right (toggle with
  "Band"). Drag over bars 1-4 > pick Intro > "Name bars"; 5-12 Verse; 13-16 Chorus.
- **Try each style:** pick Style > Generate > Play. Rock (power chords, 8th bass), Blues
  (shuffle, boogie), Country (boom-chick, acoustic strum, fiddle lead), Jazz (swing ride,
  walking bass, sax), Pop (kick-driven bass, keyboard arpeggios). Generate again with a new
  style to replace the band; "Try another" for new choices; set a player to Busy or Simple.
- Regenerate: choose a section (e.g. Chorus) and/or a player > Regenerate. Undo (Ctrl+Z)
  takes back a whole Generate in one step.
- Chords: "Detect chords" (tick "Replace file chords" to overwrite); click a chord name in
  the score to change it. Try `TestData\bach-prelude-c-bwv846.mid` too.
- Split: the Split button on the Piano track makes melody / harmony / bass tracks.
- Known limits: the 0.1.0 exe was in use, so it is still in `dist\` (delete it when closed);
  no note editing yet (Round 3/4); swing moves off-beat 8ths only; band parts never
  cross barlines; lead = the top line of the play-along track.
