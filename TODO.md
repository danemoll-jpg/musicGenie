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

## Current Objective: Round 3, "tab editing + Rocksmith"
Goal: edit guitar/bass parts note by note on the tab, open any Rocksmith
2014 custom song (.psarc) as tabs with its audio, and export any guitar or
bass part as a .psarc that plays in Rocksmith.

Facts for this round:
- Dan installed Audiokinetic Wwise on 2026-11-16 (version not recorded; find
  it and note the path and version in `CLAUDE.md`). DLC Builder supports Wwise
  2019 and 2021.
- Reference file: `TestData/private/Husker-Du_Could-You-Be-The-One_v1_p.psarc`
  (bass arrangement, 7 difficulty levels, made with Toolkit 2.9.2 + EOF).
  It is a copyrighted song: `TestData/private/` is git-ignored, never commit
  it, and never copy its audio or chart into other test files.
- Rocksmith limits: 6-string guitar and 4-string bass only (tunings are
  per-string offsets from standard, capo allowed). Export refuses other
  instruments with a clear message.
- Rocksmith2014.NET (iminashi, GitHub) has the .psarc read/write, SNG
  conversion, difficulty-level generation, arrangement checks and Wwise
  conversion that DLC Builder uses. Check its licence and note it in
  `CLAUDE.md`. Use its NuGet packages if published; otherwise add it as a git
  submodule pinned to a release tag.

1. **Note editing (tab and staff).** Click a beat to select it. On a tab:
   type fret numbers on the selected string, arrows move between strings and
   beats. On a staff: letters A-G enter notes, up/down change pitch.
   Durations (whole to 64th), dots, ties, triplets, rests, delete,
   copy/paste and insert/delete bars. Every edit is undoable and marks a
   generated track as edited. Check: unit tests for each edit; screenshot of
   a riff entered on a bass tab.
2. **Techniques.** A palette (and shortcuts) for hammer-on, pull-off, slide
   (to a fret / unpitched), bend (amount + release), vibrato, palm mute, fret
   mute, harmonic, pinch harmonic, tap, slap, pop, accent, tremolo. Shown on
   the tab and played back where alphaTab supports it. Check: screenshot of
   each technique on a tab; save/reopen keeps them.
3. **Tunings and capo.** Per-track tuning presets (Standard, Drop D, Eb
   Standard, D Standard, Drop C, Open G/D/E...) plus custom, and capo.
   Changing the tuning keeps the pitches and re-places frets (or keeps frets
   and changes pitches, user's choice). Check: unit test; Drop D screenshot.
4. **.NET Rocksmith helper.** `helpers/rocksmith/`: .NET 8 console app built
   alongside the app (put the command in `CLAUDE.md`), talking to Electron
   over JSON on stdin/stdout. Commands: read a .psarc, write a .psarc,
   check an arrangement, find Wwise. Check: the helper reads the reference
   file and lists its contents.
5. **.psarc import.** File > Open accepts .psarc. Each arrangement (lead,
   rhythm, bass) becomes a track with its tuning, capo, the hardest
   difficulty level's notes, chords and techniques, sections and chord
   names; Rocksmith's beat markers become our bars and tempo map. The song's
   audio becomes a **backing track** that plays in sync with the cursor,
   with its own volume and mute in the tracks panel (alphaTab's backing-track
   / external media sync if it has one, otherwise sync an audio element to
   the player position). Check: reference file imports; note count equals
   the hardest level in the source XML; screenshot of the bass tab;
   hidden, muted run shows the backing audio playing (pre-gain level above 0)
   and in sync with the cursor at 30 s.
6. **Audio for export.** Render the song to a WAV file offline (faster than
   real time if alphaTab can, otherwise a muted real-time recording of the
   pre-gain signal). Choose: full mix, mix without the parts being exported,
   or a loaded recording (WAV/MP3/OGG/FLAC) with an offset to line it up.
   Check: the rendered WAV length matches the song length within 50 ms.
7. **Rocksmith export.** File > Export to Rocksmith: pick the guitar/bass
   tracks and their arrangement type (Lead / Rhythm / Bass, one can be
   Bonus); song info (title, artist, album, year, album art image); preview
   start time; a default tone per arrangement. Writes the arrangement with
   notes, chords + chord fingerings, techniques, beats, sections and phrases
   (our section names mapped to Rocksmith's, with the required COUNT and END
   phrases), auto hand positions and generated difficulty levels; runs the
   helper's arrangement checks and shows any problems; converts the audio
   with Wwise; writes `<Artist>_<Title>_v1_p.psarc`. Option: copy it straight
   into Rocksmith 2014's `dlc` folder (find the Steam path, let Dan change
   it). **If Wwise can't be found or fails, stop at that step**: keep the
   arrangement files, the WAV and a DLC Builder project (.rs2dlc) so it can
   be finished by hand, and report it. Check: export the Round 2 Rock bass and
   guitar from Ode to Joy; the arrangement checks report no errors.
8. **Round trip.** Import the exported .psarc back into the app: notes,
   techniques, sections and tuning match what was exported (unit/e2e test).
   Also export the reference file's bass after import and compare note counts.
   Check: test passes; list any differences in the report.

### For Dan to check (fill in at end of round)
- Include exactly how to load the exported song in Rocksmith 2014.

## Next Steps (Do Not Start Yet)
- **Round 4: composition.** Piano roll, chord
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
