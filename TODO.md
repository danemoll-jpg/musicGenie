# musicGenie: Active Development Plan

## Standing rules
- Read `CLAUDE.md` first. Its testing rules (always muted with proof, never
  steal focus) apply to every check.
- Report per item: done / not done / deferred, and why. Never skip an item
  silently.
- One check per item, done in the built app, with screenshots you look at.

## Completed Tasks
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

### Round 2, "virtual band v1" (2026-11-16): DONE, awaiting Dan's check
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

## Round 2 plan (as written, for reference)
Goal: open a piece (e.g. the piano Ode to Joy), pick a style, press Generate,
and hear it played by a band (drums, bass, rhythm guitar or keys, a lead
instrument on the melody), with every generated part shown as normal
notation/tabs that can be edited like any other track.

Design rules for this round:
- Generated tracks are ordinary tracks in the model plus a `generated` tag
  (style, role, complexity, seed). Same inputs + seed = same notes (testable).
- Never destroy the user's material: the source track is kept (muted, not
  deleted). If a generated track has been edited by hand, Regenerate asks
  before replacing it.
- Generated guitar/bass parts get playable string/fret positions (they must
  be Rocksmith-ready later).
- Everything here is undoable as one step per Generate/Regenerate.

1. **Better default sounds.** Bundle a fuller General MIDI SoundFont (e.g.
   GeneralUser GS; check its licence allows bundling and note it in
   `CLAUDE.md`), plus Settings > "Load SoundFont" for any .sf2/.sf3 (remember
   the choice). Check: app loads it; one sound check of 10 s or less.
2. **Chord recognition.** Work out chord symbols from the notes (per bar, or
   per half bar / beat when the harmony moves faster), weighting by note
   length and the bass note. Covers major, minor, 7, maj7, m7, dim, aug,
   sus2/sus4, power chords, slash chords. Writes chord symbols into the model
   and shows them above the score; click a chord symbol to change it from a
   list. Doesn't overwrite chords that came with the file unless asked.
   Check: Bach Prelude in C (one chord per bar, known answers) and Ode to Joy
   (hand-labelled answers in a test fixture): at least 90% of bars match.
3. **Split a part.** "Split into band parts" on any track: melody (top
   line), bass (lowest notes), and the harmony in between, each as a new
   track. Check: Ode to Joy piano splits into melody/bass/harmony; unit test
   that every source note lands in exactly one part.
4. **Sections.** Select bars and name them (Intro, Verse, Chorus, Bridge,
   Solo, Outro); shown above the score. If a song has none, Generate treats it
   as one section. Check: screenshot with sections shown.
5. **Style engine: 5 styles.** Rock, Blues (shuffle), Country, Jazz (swing),
   Pop. Each style defines per role:
   - drums: groove + a fill at the end of each section, crash on the next
     downbeat; GM drum kit, shown as drum notation;
   - bass: root/fifth, walking (jazz), boom-chick (country), or "follow the
     kick drum";
   - rhythm guitar / keys: strumming, power chords, arpeggios or comping,
     using sensible voicings for the instrument;
   - lead: the melody line moved to a chosen instrument and octave.
   Swing/shuffle feel is a playback setting on the song (straight / swing
   amount), so swung styles sound right. Optional ending: final chord held.
   Check: unit tests per style (notes in range for the instrument, all on
   the chord tones / scale where expected, deterministic per seed).
6. **Band panel.** Choose style; choose the lineup (which roles are on, and
   the instrument for each); complexity per player (Simple / Normal / Busy);
   "bass follows kick" toggle; Generate (whole song) and Regenerate (one
   section or one player); "Try another" (new seed). Check: open Ode to Joy,
   pick Rock, Generate; screenshot shows drums, bass, guitar and lead tracks
   with notation/tabs.
7. **Band playback.** The whole band plays together with the cursor
   following, mixer controls work on generated tracks. Check: hidden, muted
   run of each style: every generated track produces notes in the playing
   range (pre-gain level above 0, speaker level 0); one sound check of 10 s
   or less for the Rock arrangement.
8. **Save/load + undo for all of the above.** Generated tags, sections,
   chord symbols, swing and SoundFont choice survive save/reopen; each
   Generate/Regenerate undoes in one step. Check: deep-equal save/reopen
   test; undo after Generate restores the song exactly.


## Next Steps (Do Not Start Yet)
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
