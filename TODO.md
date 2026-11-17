# musicGenie: Active Development Plan

## Standing rules
- Read `CLAUDE.md` first. Its testing rules (always muted with proof, never
  steal focus) apply to every check.
- Report per item: done / not done / deferred, and why. Never skip an item
  silently.
- One check per item, done in the built app, with screenshots you look at.

## Completed Tasks
Rounds 1-2 are archived in `TODO-ARCHIVE.md` (grep it, never read it in full).
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

### Round 5, "production" (2026-11-16): DONE in the app (no real audio input or MIDI keyboard here: recording is verified with a simulated input only)
Checks ran in the packaged 0.5.0 app (`npm run e2e:r5`), hidden (off-screen, never shown or
focusable) and `--mute`; speaker level measured 0 on every step that made sound (band, mixer,
automation, clips, recording, keyboard piano: pre-gain 0.02-0.44, speakers 0). **No sound checks
this round.** Unit tests 160/160 (`npm test`, 18 new). Rounds 1-4 app checks re-run on the 0.5.0
exe: all pass. Screenshots `test-results/r5-*.png`, PDF `r5-7-score.pdf`; report `report-round5.json`.
Everything is in the dock: **🎚 Mixer** (toolbar), 〰 Automation, 🎙 Audio; **⇩ Export…** and
**Package…** in the toolbar.
1. Playback engine: **done. Choice: (b) alphaTab's own synthesizer, moved to the page thread and
   split per MIDI channel** (each track owns its channels) into a 17-output AudioWorklet that feeds
   a Web Audio mixer; the worklet's played frames drive alphaTab's cursor. Why: every alphaTab
   feature (cursor, loop/range, speed, swing, count-in, metronome, repeats) keeps working unchanged,
   the same SoundFonts sound the same, and offline export uses the same synth + graph. SpessaSynth
   (a) would have meant re-implementing all of that on a second clock. Check: Rock band, each track
   soloed in turn = level only on that track (others exactly 0); Rounds 1-4 pass on it.
2. Mixer view: **done.** Strip per track + Reverb, Delay, Master: fader (dB), pan, M/S, stereo meter
   with clip light, effects chain (add/remove/reorder/bypass/settings), presets, Rev/Dly sends.
   Check: `r5-2-mixer.png` (sends feed both buses); unit tests for fader law, pan law, mute/solo.
3. Effects: **done.** 3-band + parametric EQ, compressor, gate, overdrive/distortion/fuzz, guitar and
   bass amp with 5 cabinets, chorus, flanger, phaser, tremolo, tempo-synced delay, reverb
   (room/hall/plate), master limiter; 10 presets (Clean guitar, Crunch, Lead, Bass DI, Bass drive,
   Drum room, Vocal plate…) + saved user presets. Impulse responses are generated by our own code
   (no third-party licence). Check: 18 offline signal tests all pass (e.g. low cut 500 Hz: -27.8 dB at
   100 Hz, 0.15 dB at 3 kHz; compressor -20.4 dB loud / 0 dB quiet; delay echo at 250.0 ms; limiter
   peak -3.2 dB with ceiling -3); amp chain `r5-3-amp-chain.png`.
4. Automation: **done.** Lanes for volume, pan and any effect knob; click/drag/right-click points;
   follows playback, loops and repeats; renders. Check: fade bar 5 -> 13 in an offline render: bars
   1-4 unchanged (0.0 dB), then -1.3 … -61 dB, silent after (`r5-4-automation.png`).
5. Audio tracks: **done.** Import WAV/MP3/OGG/FLAC; move, trim, split, fades, clip gain (each one undo
   step); clips stay on their bar when the tempo changes; record from any input (device picker, count-in,
   metronome, input meter, monitoring off by default, latency + loopback test); media copied to
   `<name>_media\`, **Package…** = one `.mgpack`. Check: simulated 80 ms cable -> latency test measured
   80 ms; take placed at bar 5, recorded metronome clicks 0.3-1 ms from the beats; clip played back.
6. Keyboard piano: **done.** Toggle "⌨ Keyboard piano" (A-row white keys, W-row black, Z/X octave,
   C/V velocity); feeds the MIDI path (hear, step entry, record). Check: simulated keys recorded
   C4 D4 E4 F4 C5 exactly one beat apart; keys do nothing while the toggle is off.
7. Export: **done.** WAV + MP3 (192 kbps) through the mixer, -14 LUFS normalise + -1 dB peak limit,
   stems per track and per bus, MIDI, MusicXML, Guitar Pro (.gp), PDF (parts, notation/tab/both,
   Letter/A4, title, composer, page numbers). Check: MIDI, MusicXML and GP re-import 869/869 notes;
   WAV 38 401 ms vs song 38 400 ms; WAV measures -14.0 LUFS (MP3 -14.3), peak -3.6 dB; rendered 4.5x
   faster than real time; PDF 5 pages (`r5-7-pdf-page1.png`).
8. Save/load, undo, regression: **done.** Format v5. Check: 8 kinds of edit (preset, knob, 5-move fader
   drag, send, master, automation, audio track, clip) each one undo step; save -> reopen identical,
   media copied; `.mgpack` opened after deleting the project folder: identical, audio plays (stem peak 0.95).
   Found + fixed on the way: Web Audio's compressor adds hidden makeup gain (replaced by our own);
   alphaTab moves the metronome channel; an idle audio device crashed the page after minutes, so the
   engine now suspends audio after 5 s of silence (like alphaTab did).

### For Dan to check (fill in at end of round)
- Play an exported song in Rocksmith 2014 (timing, note placement, difficulty levels). Still
  pending from Round 3.
- Run `dist\musicGenie-0.5.0-portable.exe`. Open Ode to Joy, Band > Generate (Rock), Play: should
  sound like before. **🎚 Mixer**: move faders/pan, mute/solo, watch the meters; pick a Preset on
  each strip (Crunch on rhythm, Lead on lead, Bass drive, Drum room); raise Rev/Dly sends.
- Click an effect name to open its knobs; ⏻ bypass, ▲▼ reorder, ✕ remove; "+ Effect…" adds one.
- 〰 Automation: "+ Lane…" Volume, click points to make a fade; play it.
- 🎙 Audio: + Audio track, Import audio… (any WAV/MP3). Drag clips, drag edges to trim, fades in the
  clip box. **Recording (real input, not tested here):** pick your interface or the Real Tone Cable,
  connect output to input with a cable and press Test latency, then ● Record (count-in + metronome).
- ⌨ Keyboard piano (toolbar): A S D F… play notes through the selected track; 🎛 MIDI tab ▸ Record.
- ⇩ Export…: writes WAV, MP3, MIDI, MusicXML, .gp, PDF (and stems) to Documents\musicGenie\Exports.
  Open the PDF and the .gp in Guitar Pro / the .musicxml in MuseScore if you have them.
- Known limits: drum tracks share one mixer strip if there are several (MIDI channel 10); over 15
  melodic tracks share channels; clips are not time-stretched at other tempos/speeds; MIDI import
  of 32nd/triplet-heavy songs quantises to 16ths (the exported file itself has every note); MP3
  encoder is LGPL (lamejs, separate chunk).

## Current Objective: Round 6, "recording to tabs"
Goal: take a real song recording, find its beats, split it into
instruments, turn the bass/guitar/drums into editable tracks, fix them up
against the audio, and (for guitar/bass) export a Rocksmith chart that plays
along with the original recording. Plus reading sheet music from a PDF.
Standing checks for Dan (keep in "For Dan to check" until he reports): play
an exported song in Rocksmith 2014; try Rounds 2-5 features.

Design rules for this round:
- Plug in existing open-source tools/models; don't train or write our own
  ML. Note each tool's and model's licence in `CLAUDE.md`.
- Heavy jobs run in the background at Below Normal priority with progress
  and Cancel; the app stays usable. Models download on first use (with
  size shown and a progress bar) into the app's data folder, not the repo.
- Results are ordinary tracks/clips: editable and undoable like anything
  else; the original recording is never changed.
- Test material: render our own songs to audio (the notes are known, so
  accuracy can be measured), plus the private Hüsker Dü file (real audio +
  a human-made bass chart) as a real-world benchmark. Never commit the
  private file or anything derived from it.

1. **ML runtime (do first, report the choice).** Pick how models run on
   Dan's PC: ONNX Runtime from Node (preferred if the models below have
   ONNX versions) or a bundled Python environment. Use the GPU when present
   (DirectML/CUDA), otherwise the CPU. Check: a test model runs; report
   CPU/GPU used and the time.
2. **Beats and tempo from audio.** Detect beats and downbeats in a recording
   and build the tempo map and bars from them (time signature guessed,
   changeable). Editable beat markers: drag a beat, set the downbeat, tap
   tempo over a section; audio clips never move. Check: our rendered songs
   (steady, a tempo change, a 3/4 section): beats within 20 ms; Hüsker Dü:
   compare with its chart's beat markers and report the average error.
3. **Stem separation.** Split a recording into vocals, drums, bass and other
   (and guitar/piano if a 6-stem model is available, e.g. Demucs htdemucs_6s),
   each as an audio track. Check: run on a rendered band mix; report the
   time taken and how much of each stem's energy is the right instrument.
4. **Audio to notes.** Transcribe a stem or any clip (e.g. Spotify's
   basic-pitch) into a new track, quantised to the tempo map (choose grid,
   with a "keep loose timing" option), kept within the chosen instrument's
   range; guitar/bass get playable string/fret positions; chord symbols from
   the existing chord detection. Check: rendered bass and guitar parts: note
   F-score with 50 ms onset tolerance, target 0.9 or better on bass; Hüsker
   Dü bass stem vs its chart: report the F-score (no target, benchmark).
5. **Drums to a drum track.** Transcribe the drum stem into kick, snare,
   hi-hat (open/closed), toms, crash and ride (an existing drum-transcription
   model if a usable free one exists; otherwise onset detection plus
   classification for at least kick/snare/hi-hat). Check: rendered Rock and
   Jazz drums: F-score per kit piece reported, target 0.85+ on kick/snare.
6. **Review and fix view.** Waveform (and spectrogram toggle) lined up above
   the score/tab; A/B buttons: original / stem / transcription / stem +
   transcription; slow the audio down to 25-100% **with pitch kept**, loop a
   range; click a note to hear it against the audio. Normal editing works
   here. Check: screenshot; pitch stays the same at 50% speed (measured).
7. **"Song to Rocksmith" wizard.** One guided flow: load a recording -> beats
   -> stems -> transcribe bass and/or guitar -> review -> Rocksmith export
   using the ORIGINAL recording as the song audio (charts lined up to it).
   Every step can be redone or skipped. Check: run on a rendered song end to
   end; the exported .psarc round-trips with its notes lined up to the audio
   within 20 ms; run on the Hüsker Dü file and report (don't keep outputs).
8. **Sheet music from PDF or photo.** Use Audiveris (installed locally by
   the app or by you, note how in `CLAUDE.md`) to turn a PDF/image score into
   MusicXML, then import it; show which pages/measures it was unsure about.
   Check: export a PDF from our app (Round 5), read it back, compare note
   counts and report the match. Plus save/load, undo and the Round 1-5 app
   checks on the new exe.

### For Dan to check (fill in at end of round)
- Play an exported song in Rocksmith 2014 (timing, note placement,
  difficulty levels). Still pending from Round 3.

## Next Steps (Do Not Start Yet)
- **Later, unordered:** test item 7 of Round 4 with a real MIDI keyboard and Round 5
  recording with a real audio input (interface / Real Tone Cable).
- **Round 7 (planned): lyrics, singing and assisted composition.** Lyrics per
  note shown under the staff; singing synthesis from notes + lyrics (a free
  engine such as OpenUtau/DiffSinger if it can run from the app, otherwise
  export to OpenUtau/Synthesizer V and bring the vocal WAV back); "describe
  it" song starters ("12-bar blues in E, guitar, bass, piano, drums"); better
  sound libraries / VST3 instrument hosting.

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
