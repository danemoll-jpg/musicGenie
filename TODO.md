# musicGenie: Active Development Plan

## Standing rules
- Read `CLAUDE.md` first. Its testing rules (always muted with proof, never
  steal focus) apply to every check.
- Report per item: done / not done / deferred, and why. Never skip an item
  silently.
- One check per item, done in the built app, with screenshots you look at.

## Completed Tasks
Round 1 is archived in `TODO-ARCHIVE.md` (grep it, never read it in full).
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

### Round 3, "tab editing + Rocksmith" (2026-11-16): DONE in the app; in-game Rocksmith test still pending Dan
Checks ran in the packaged app (`npm run e2e:r3`), hidden (off-screen, never shown or
focusable) and `--mute`; speaker level measured 0 on every playing step (techniques
playback pre 0.14, backing track pre 0.66, offline render 0). **No sound checks this round.**
Unit tests 107/107 (`npm test`). Rounds 1-2 app checks re-run on the 0.3.0 exe: all pass.
Screenshots: `test-results/r3-*.png`; report `test-results/report-round3.json`.
1. Note editing: **done.** Edit mode (✎ Edit, or New ▸ Guitar/Bass song): click a beat; tab =
   fret digits (two quick digits = 10-24), ↑↓ strings; notation = A-G (Shift adds to chord),
   ↑↓ pitch; whole-64th, dot, triplet, tie, rest, insert/delete beat and bar, copy/paste
   (beat or selected bars); undoable; generated tracks show "edited". Check: 16-note bass riff
   typed with keys matched exactly (`r3-1-bass-riff.png`); unit tests per edit, bars stay full.
2. Techniques: **done.** Palette + keys for hammer-on/pull-off, slide (shift/legato/out up/down),
   bend (½, full, 1½, bend+release), vibrato, palm mute, fret mute, harmonic, pinch, tap, slap,
   pop, accent, tremolo. Check: all 20 drawn on a tab (`r3-2-techniques.png`), played (muted),
   save -> reopen identical.
3. Tunings and capo: **done.** Presets (14 guitar, 6 bass) + custom dialog; keep the sound
   (frets re-placed) or keep the frets; capo 0-12. Check: E-G-A riff -> Drop D keep-pitch frets
   2/5/7, keep-frets pitches D/F/G (`r3-3-drop-d.png`); unit tests.
4. .NET helper: **done.** `helpers/rocksmith/MgRocksmith` (F#, net8.0) over Rocksmith2014.NET
   v3.5.0 (MIT, submodule); JSON lines over stdin/stdout; read, readProject, readXml, list, write,
   check, findWwise, findRocksmith. Check: lists the reference file's 18 entries.
5. .psarc import: **done.** File > Open takes .psarc, DLC Builder .rs2dlc and arrangement .xml.
   Check: reference bass imports with 541 notes = hardest levels (541) = the file's source XML
   (541); 108 bars, sections, tuning; song audio plays as a "Song audio" row (vol, mute, start
   offset): pre-gain 0.66, speakers 0, **16 ms off the cursor at 30 s** (`r3-5-*.png`).
6. Audio for export: **done.** alphaTab offline render (~105x real time, silent) or a loaded
   recording (WAV/MP3/OGG/FLAC + offset). Check: Ode Rock mix WAV 38 401 ms vs song 38 400 ms
   (1 ms); "without the exported parts" also renders.
7. Rocksmith export: **done.** Dialog: parts +
   Lead/Rhythm/Bass/Bonus, title/artist/album/year/art, preview start, audio choice, copy to
   `E:\Rocksmith2014\dlc`; writes notes, chords + fingerings, techniques, beats, sections,
   COUNT/END phrases, anchors; DD generated (14/14/11 levels). Check: Ode Rock bass, rhythm and
   lead: **arrangement checks 0 issues**; Wwise 2023.1.19 made the song + preview .wem and the
   `_p.psarc` was built (1.06 MB, stage "done"), plus XML, WAV, cover and `.rs2dlc`
   (`r3-7-*.png`). Refuses non-guitar/bass and wrong string counts with a message. Without
   Wwise it stops at that step and keeps everything else.
8. Round trip: **done.** Check: reopened the export, 121/365/62 notes, **0 differences** in
   pitch/string/fret/techniques, same sections and tunings (plus 1 lead-in and 1 tail bar, by
   design); the built `_p.psarc` read back has 121/365/62 notes, 14/14/11 levels and its .wem
   audio. Reference bass import -> export (full .psarc build): 541 notes out, 541 in the
   written XML, 0 check issues; that copy is deleted after the check.

Dan's check list for Round 3 (For Dan to check):
- Play an exported song in Rocksmith 2014 (timing, note placement, difficulty levels)
- Run `dist\musicGenie-0.3.0-portable.exe` (or `npm run dev`). New ▸ Bass song: click a beat,
  type frets (1 then 2 quickly = 12), ←→ beats, ↑↓ strings, `]`/`[` shorter/longer, `.` dot;
  try the technique buttons (or H, S, B, V, M, X, N, T...). Ctrl+Z undoes each step.
- A guitar track's row has Tuning and Capo: pick Drop D; "…" opens custom tuning with
  "keep the sound" / "keep the frets".
- Open `TestData\private\Husker-Du_Could-You-Be-The-One_v1_p.psarc`: the bass tab should play
  along with the song audio ("Song audio" row: volume, mute, start offset).
- Wwise 2023.1.19 is installed (`C:\Audiokinetic\Wwise2023.1.19.8928`); musicGenie finds it
  by itself. Don't take the Launcher's 2026 upgrade offer for this (Rocksmith tools need
  2019-2023); having 2026 installed alongside is fine.
- **Loading the exported song in Rocksmith 2014:** load a song with guitar/bass parts (or the
  Ode to Joy Rock band), ⇪ Rocksmith…, tick the parts, tick "Copy into E:\Rocksmith2014\dlc",
  Export. That writes `Documents\musicGenie\Rocksmith\<Artist>_<Title>\<Artist>_<Title>_v1_p.psarc`
  and copies it into `E:\Rocksmith2014\dlc` (or copy it there yourself). Custom songs need the
  CDLC patch: your `E:\Rocksmith2014` already has `D3DX9_42.dll` (the CDLC enabler). Start
  Rocksmith 2014 > Learn a Song > search the title or artist. Without Wwise: open the `.rs2dlc`
  from the same folder in DLC Builder and press Build > Release (it converts the audio).
- Known limits: the built .psarc has not been tried in the game yet (that's your check);
  the tone is DLC Builder's default per arrangement; imports quantise to 32nd notes (no
  triplets); a Rocksmith import's tempo changes every beat (only big changes are drawn);
  the exported song gets a ~2 s count-in bar and a 1-bar ending.

### Round 4, "composition" (2026-11-16): DONE in the app (Dan moved on; no real MIDI keyboard to test with, so item 7 is verified with simulated input only)
Checks ran in the packaged 0.4.0 app (`npm run e2e:r4`), hidden (off-screen, never shown or
focusable) and `--mute`; speaker level measured 0 on every step that made sound (piano-roll
playback, chord preview, chord-chart playback, MIDI recording: pre-gain 0.07-0.42, speakers 0).
**No sound checks this round.** Unit tests 142/142 (`npm test`, 35 new). Rounds 1-3 app checks
re-run on the 0.4.0 exe: all pass (Round 1: 7 items, Round 2: 9, Round 3: 9 incl. the full .psarc build). Screenshots `test-results/r4-*.png`; report
`test-results/report-round4.json`. Open everything with **🎹 Compose** (a dock under the score;
it works on the track selected in the track list).
1. Piano roll: **done.** Draw (drag), move, resize (right edge), delete (right-click / Delete),
   Shift+click multi-select, snap 1/4-1/32 + triplets, velocity lane, zoom, playhead follows
   playback; fretted tracks get string/fret (capo kept) and refuse unplayable pitches. Check: 10
   notes drawn with the mouse (incl. a chord, a tied note, 8th triplets) = same notes, strings and
   frets in score and tab (`r4-1-piano-roll-score-tab.png`); unit test vs alphaTab's score.
2. Chord explorer: **done.** Root / quality / extension / alterations / slash bass, or type a
   name, or Explore… from a chord symbol. Open, barre and other shapes, power chords, string-set
   triads, bass shapes, piano close/inversions/open/drop 2; click = hear, Insert = notes at the
   cursor (+ chord symbol). Check: C, Am7, D/F#, E7#9 in standard (33-46 shapes) and Drop D
   (30-44); unit test: every voicing's notes are chord tones, full shapes have every required
   note and the bass lowest; screenshots `r4-2-*.png`.
3. Progression helper: **done.** Key at the selected bar, diatonic chords, next-chord
   suggestions, secondary dominants, borrowed chords, substitutions (relative, tritone, dim7);
   15-progression library inserted over the selected bars. Check: unit tests in C major and
   A minor; 12-bar blues in E inserted as E7×4 A7 A7 E7 E7 B7 A7 E7 B7 (`r4-3-*.png`).
4. Drum step sequencer: **done.** 16/32 steps + triplet grid, 13 lanes + any GM kit piece,
   accent (Shift) / ghost (right-click), copy/paste bar, fill section, built-in + saved patterns
   (settings.json). Check: a beat built by clicking = the drum notation (unit test vs alphaTab);
   generated drums show "edited" (`r4-4-drum-grid.png`).
5. Chord charts + song-wide changes: **done.** New ▸ Chord chart… (bars, %, holds, repeats,
   [sections], {key}, {3/4}, {tempo}, {accel/rit}) generates the band; Song ▸ Key, time & tempo
   changes… at any bar, incl. gradual changes. Check: chart with a G→A key change and 3/4 bars
   generated and played (muted, reached bar 5 through the repeat); tempo-map unit tests; unit
   test that Rocksmith export has 3 beats in 3/4 bars and slowing beats in a ritardando.
6. Harmony lines: **done.** Track row ▸ Harmony…: 3rd / 6th / octave, above or below, as a new
   track, in key, chord tones on strong beats. Check: Ode to Joy unit test (all notes in key;
   >70% exact diatonic 3rd/6th, the rest chord tones); `r4-6-harmony.png`.
7. MIDI keyboard: **done.** Web MIDI device picker (remembered), plays through the selected
   track's sound, step entry, recording with count-in, metronome, quantise (none/1/8/1/16/
   triplets), add or replace. Check: unit test with simulated messages (notes at the expected
   ticks); in the app a simulated keyboard recorded 4 quarters exactly 960 ticks apart.
8. Save/load, undo, regression: **done.** Format v4. Check: every feature saved and reopened
   deep-equal (unit + app), each action = one undo step (app: 6 actions undone one by one).

Dan's check list for Round 4 (For Dan to check):
- Play an exported song in Rocksmith 2014 (timing, note placement, difficulty levels)
- Run `dist\musicGenie-0.4.0-portable.exe`. New ▸ Chord chart…: keep the example (or type your
  own), pick a style, Create: the band plays it. Song ▸ Key, time & tempo changes… to add a
  3/4 bar or a ritardando.
- 🎹 Compose ▸ Piano roll: click a track in the list, drag in the grid to draw; Ctrl+Z undoes.
- ♯ Chords: type E7#9 (or click a chord symbol ▸ Explore…), click diagrams to hear them; with
  ✎ Edit on, click a beat and press Insert.
- 🥁 Drum grid on a generated band (or "Add a drum track"); ⇢ Progressions; Harmony… on a track.
- 🎛 MIDI: plug in a keyboard, pick it, play; Record from the cursor bar (count-in + metronome).
  Not tried with a real keyboard yet (only simulated input).
- Known limits: only staff 1 of a multi-staff track is edited in the drum grid; recording over
  repeats writes onto the repeated bars; step entry uses the cursor beat's length (set it first);
  chord shapes stop at fret 15; the piano roll edits one staff at a time.

## Current Objective: Round 5, "production"
Goal: make it sound like a finished recording and get it out of the app:
per-track effects and a real mixer, recorded/imported audio tracks, and
export to audio, stems, MIDI, MusicXML, Guitar Pro and printable PDF.
Standing check for Dan (keep in "For Dan to check" until he reports):
play an exported song in Rocksmith 2014.

1. **Playback engine with per-track outputs (do this first, report the
   choice).** Effects need each track as its own audio stream; alphaTab's
   player mixes everything into one. Evaluate (a) a SoundFont synth with
   separate outputs per track/channel (e.g. SpessaSynth) driven from our
   model, with alphaTab kept for drawing and the cursor, versus (b) any
   alphaTab option that gives per-track outputs. Pick the one that keeps the
   cursor in sync and works offline (for export). Rounds 1-4 playback
   features (cursor, loop, speed, swing, count-in, metronome, mute/solo,
   backing track, Rocksmith render) must all still work. Check: the Round 1-4
   app checks pass on the new engine; each track's output measured
   separately (pre-gain level above 0 only on that track when soloed).
2. **Mixer view.** A strip per track plus master: fader, pan, mute/solo,
   level meter with clip light, an effects chain (add/remove/reorder/bypass),
   and send levels to two shared buses (Reverb, Delay). Check: screenshot;
   unit tests for gain/pan maths.
3. **Effects.** EQ (3-band + parametric), compressor, gate, overdrive/
   distortion, guitar and bass amp simulation (with cabinet impulse
   responses), chorus, flanger/phaser, tremolo, delay (tempo-synced),
   reverb (convolution with bundled freely licensed impulse responses;
   note the licences in `CLAUDE.md`), master limiter. Presets per instrument
   ("Clean guitar", "Crunch", "Lead", "Bass DI", "Bass drive", "Drum room",
   "Vocal plate"...), saved user presets. Check: each effect changes the
   measured signal in the expected way (e.g. a low-cut EQ lowers energy below
   the cutoff) in an offline render; screenshot of an amp chain.
4. **Automation.** Volume, pan and any effect knob can change over time:
   draw/edit points in a lane under the track, plays back and renders.
   Check: a volume fade-out measured in an offline render.
5. **Audio tracks.** Import WAV/MP3/OGG/FLAC onto a new audio track; move,
   trim, split, fade in/out, clip gain; it stays at its bar position when the
   tempo changes (option to stretch is NOT needed this round). Record from
   any audio input (device picker, e.g. a USB interface or the Rocksmith
   Real Tone Cable), with count-in, metronome, input level meter, input
   monitoring off by default, and a latency setting with a loopback test.
   Media is saved in a folder next to the project (`<name>_media/`);
   "Save as package" zips project + media into one `.mgpack`. No real
   input in tests: use a simulated input stream. Check: a simulated
   recording lands at the expected bar with the latency offset applied.
6. **Computer keyboard as a piano** (Dan has no MIDI keyboard): the
   A-S-D-F row = white keys, W-E-T-Y-U = black keys, Z/X = octave down/up,
   C/V = velocity; works for hearing notes, step entry and recording, the
   same as a MIDI keyboard. Only active while a "Keyboard piano" toggle is
   on, so it never clashes with shortcuts. Check: simulated key presses
   record the expected notes.
7. **Export.** File > Export: mixdown WAV and MP3 (with effects, offline,
   faster than real time), optional loudness normalise (-14 LUFS) and a
   peak limit; stems (one WAV per track or per bus); MIDI; MusicXML; Guitar
   Pro (.gp, if alphaTab's exporter works); PDF/print of the full score or
   chosen parts (notation, tabs or both; title, composer, page numbers; page
   size Letter/A4). Check: exported MIDI and MusicXML re-import with the same
   note counts; WAV length matches the song within 50 ms; loudness within
   1 LU of target; PDF screenshot of page 1.
8. **Save/load, undo, regression.** Mixer, effects, automation and audio
   clips survive save/reopen (and `.mgpack` open on its own); each edit is
   one undo step; the Round 1-4 app checks still pass on the new exe.

### For Dan to check (fill in at end of round)
- Play an exported song in Rocksmith 2014 (timing, note placement,
  difficulty levels). Still pending from Round 3.

## Next Steps (Do Not Start Yet)
- **Later, unordered:** test item 7 of Round 4 with a real MIDI keyboard if
  Dan gets one; better sound libraries / VST3 instruments, singing, "describe it" assisted
  composition, PDF score reading (Audiveris), audio to notes (basic-pitch),
  stem splitting (Demucs). Plug these in from existing tools, don't build them.

## Technical Notes / Blockers
- Resolved 2026-11-16: the Wwise blocker (Round 3, item 7). Dan installed Wwise 2023.1.19 at
  `C:\Audiokinetic\`; the helper now also searches there and reads `WWISEROOT` from the
  registry. `npm run e2e:r3 -- --only=4,7,8` builds the full .psarc and round-trips it.
- Reference Rocksmith file examined 2026-11-16 (Hüsker Dü, "Could You Be The
  One", bass): the .psarc holds the arrangement XML (song version 7: notes
  with time/string/fret/techniques, phrases, sections, 7 difficulty levels),
  .sng, Wwise .bnk/.wem audio + preview, DDS album art, showlights, manifest
  JSON, xblock. The TOC is AES-encrypted with the well-known Rocksmith key.
  Charts are time-based (seconds) with beat markers, so export converts from
  our measure/beat model through the tempo map.
- Releases: local builds only for now (this is an app, not one of the games,
  so the game launcher doesn't apply). Revisit if Dan wants auto-update.
