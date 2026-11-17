# musicGenie: Active Development Plan

## Standing rules
- Read `CLAUDE.md` first. Its testing rules (always muted with proof, never
  steal focus) apply to every check.
- Report per item: done / not done / deferred, and why. Never skip an item
  silently.
- One check per item, done in the built app, with screenshots you look at.

## Completed Tasks
Rounds 1-3 are archived in `TODO-ARCHIVE.md` (grep it, never read it in full).
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

### Round 6, "recording to tabs" (2026-11-16): DONE in the app (real-world benchmark on the private Hüsker Dü file; in-game Rocksmith test still pending Dan)
Checks ran in the packaged 0.6.0 app (`npm run e2e:r6`), hidden (off-screen, never shown or
focusable) and `--mute`; speaker level measured 0 on every step (the 440 Hz review tone measured
pre-gain 0.40, speakers 0). **No sound checks this round.** Unit tests 178/178 (`npm test`, 18 new).
Rounds 1-5 app checks re-run on the 0.6.0 exe: all pass (all silent). Our test songs (Ode to Joy + Rock band:
steady 100 bpm, tempo change to 132, 4 bars of 3/4; Ode + Jazz band, swung) are rendered to audio
so every note is known. Screenshots `test-results/r6-*.png`; report `report-round6.json`.
Everything is in the **🎧 Recording** dock tab (toolbar): the wizard, the tools, sheet music.
1. ML runtime: **done. Choice: ONNX Runtime from Node** (`onnxruntime-node` 1.31.1, MIT) in a
   background utility process at Below Normal; **DirectML on the GPU** (GTX 1660 Ti), CPU fallback;
   no Python. All three models have ONNX versions. Check: basic-pitch test model, one 2 s window:
   GPU 9.0 ms, CPU 28.2 ms. Beat This! runs on the CPU on purpose (DirectML was ~3x slower for it).
2. Beats and tempo: **done.** Beat This! (MIT) -> bars + tempo map (one tempo point only where the
   beats drift > 12 ms), time signature from the downbeats (Beats/bar to redo it); in the review view:
   drag a beat line, double-click = beat 1, Tap tempo over selected bars, Re-bar; audio clips never
   move. Check (detected beats vs truth): steady 61/64 within 20 ms (mean 14.4 ms), tempo change 59/64
   (15.6 ms; map 100 -> 132 found), 3/4 section 58/60 (13.6 ms); all 64/64, 64/64, 60/60 once a
   constant +14 ms is removed (our synth's own attack is 5-8 ms of it). 3/4 bars: found 2+3+3+4 for
   3+3+3+3 (fix with Re-bar / set downbeat). Hüsker Dü vs its chart's beat markers: chart sits a
   constant 75 ms off the detected beats; 349/385 within 20 ms after that offset (mean |err| 75 ms raw).
3. Stems: **done.** HT-Demucs 6 stems (drums, bass, other, vocals, guitar, piano), each a muted audio
   track. Check (38.4 s Rock mix): 20.4 s on the GPU; share of each stem that is the right
   instrument: drums 99.2 %, bass 99.4 %, guitar 98.7 %; vocals/piano/other < 0.2 % of the mix energy.
4. Audio to notes: **done.** basic-pitch (Apache-2.0) -> new track, grid 1/4..1/32 (incl. triplets)
   or "loose" (1/64), range per instrument, string/fret positions (126/126 playable), chord symbols
   from the existing detection. Fixes: onsets were 30-40 ms late (now -25 ms), sustained notes split
   (weak re-attacks merged), bass octave harmonics dropped. Check, F-score (50 ms, pitch exact):
   **bass 0.972** (target 0.9; loose timing 0.908; from the bass stem 0.856), lead guitar 0.968,
   rhythm-guitar chords 0.911, guitar stem (both guitars mixed) **0.33** (weak). Hüsker Dü bass stem
   vs chart: 0.165 raw, 0.356 after removing the chart offset, 0.50 ignoring octave.
5. Drums: **done, without a model** (no usable free drum-transcription model in ONNX): onset
   detection + band-energy rules (kick/snare/hi-hat open/closed/toms low-mid-high/crash/ride).
   Check, F per piece, clean part / drum stem: Rock kick 0.97, snare 0.99, closed hat 0.95,
   open hat 1.00, crash 0.80 (2 of 3); Jazz kick 0.95, snare 0.96, hat 0.98 (stem 0.72), toms 0.89-1.00, ride 0.42 (stem 0)
   (rides played with the kick are missed). Rock clean part and drum stem scored the same. Swung parts
   need "loose" timing (a straight 1/16 grid moves swung off-beats ~70 ms). Target 0.85+ kick/snare: met.
6. Review view: **done.** One-row score with the recording/stem above it as waveform or spectrogram
   (log frequency), drawn bar by bar so they line up; A/B: original / stem / transcription / stem +
   transcription (no change to the song); speed 25-100 % with pitch kept; loop; a note click plays
   2.5 s from there against the audio; editing works as usual. Check: 440 Hz tone measured
   440.02 Hz at 100 % and 440.02 Hz at 50 % (`r6-6-review-*.png`).
7. "Song to Rocksmith" wizard: **done.** Load -> beats -> stems -> bass/guitar notes -> review ->
   Export (each step redo/skip); the ORIGINAL recording is the song audio. Check (Rock mix, 45 s
   end to end): .psarc built (18 difficulty levels, 0 issues), re-opened: chart notes vs notes before
   export, lined up through the audio by cross-correlation: max error 1 ms (target 20 ms); vs the true
   notes F 0.856. Hüsker Dü: whole wizard in 1.9 min, .psarc built (25 levels); outputs deleted.
8. Sheet music: **done.** Audiveris 5.11.0 (AGPL, separate program) downloaded once (85 MB) and
   unpacked into the app's data folder, no install; PDF/PNG/JPG -> MusicXML -> song; unsure bars
   (Audiveris warnings + bars whose rhythm does not add up) listed and clickable. Check: our Ode to
   Joy PDF read back: 101/108 notes (93.5 %), 15/16 bars; bar 4 flagged. Tempo text is not read (no
   OCR languages), so read songs start at 120 bpm. Plus save/load (format v6) and undo: stems + transcription + recording survive save/reopen (8 tracks, 17 bars, 3 tempo points, all clip files present); undo takes back notes, stems, beats one step each, redo works.
   Found + fixed on the way: PDF-only export failed (page image written before its folder existed);
   a song of only audio tracks lost its tempo map in alphaTab (crash on pause).

### For Dan to check
- Play an exported song in Rocksmith 2014 (timing, note placement, difficulty levels). Still
  pending from Round 3 — now also a "Song to Rocksmith" export of a real recording.
- Run `dist\musicGenie-0.6.0-portable.exe`. **🎧 Recording** (toolbar) > Song to Rocksmith > Load…
  any song WAV/MP3: Run beats (first use downloads 83 MB), Run stems (110 MB; ~1 min per 4 min of
  song on the GPU), tick bass, Run notes, Open review, Export…. Every download asks first; the bar
  under the toolbar shows progress and has Cancel; the app stays usable meanwhile.
- Review view: Original / Stem / Transcription / Stem + transcription; Speed 50 % should sound slower
  but not lower; drag a beat line, double-click one to make it beat 1; select bars, play, click Tap on
  each beat (4+), Apply taps.
- Tools: Audio to notes on any audio track (choose instrument + grid, or loose); Drums -> drum track
  on the drum stem; Read sheet music… on a PDF or photo (first use downloads Audiveris, 85 MB).
- Known limits: guitar transcription from a full-band guitar stem is weak (F 0.33 here); drums are
  rule-based (tuned on the GM kit; real kits will be rougher, rides under kicks are missed); OMR does
  not read tempo/lyrics text; the Demucs weights are non-commercial (CC BY-NC 4.0): fine for personal
  use, not for selling the app.
- Still open from earlier rounds: try the Round 2-5 features (band, tab editing + tunings, piano
  roll / drum grid / chords / MIDI, mixer / effects / automation / audio tracks / export; each round
  above says how); Round 5 recording with a real input, Round 4 with a real MIDI keyboard.

## Current Objective: Round 7, "lyrics, singing, real-song accuracy, song starters"
Standing checks for Dan (keep in "For Dan to check" until he reports): play
an exported song in Rocksmith 2014; try Rounds 2-6 features.

1. **Lyrics.** Per-note syllables with hyphens and held syllables
   (melisma), several verses, shown under the staff and in the review view.
   Paste a block of lyrics onto a melody track and the app splits it into
   syllables and assigns them to notes (fix by dragging/typing). Import
   lyrics from MusicXML and Guitar Pro; export them to MusicXML, Guitar Pro,
   MIDI (lyric events) and PDF. Check: Ode to Joy with a pasted verse; save/
   reopen and export/re-import keep every syllable.
2. **Rocksmith vocals.** Import the vocals (lyrics) arrangement from a
   .psarc when present; export lyrics as a Rocksmith vocals arrangement so
   they show in the game. Check: round trip of an exported song with lyrics;
   the helper's checks report no issues (incl. the font-character check).
3. **Singing synthesis.** Evaluate free engines that can run from the app
   (DiffSinger acoustic + vocoder models in ONNX on our existing runtime is
   the first choice; OpenUtau's renderer as second) with a voicebank whose
   licence allows this use; note it in `CLAUDE.md`. Render a vocal audio
   track from a melody track + its lyrics, with vibrato, dynamics and breath
   settings; re-render when notes/lyrics change. If no engine can run from
   the app, export `.ustx` (OpenUtau) and a Synthesizer V-compatible file,
   and add "Import rendered vocal" to bring the WAV back in time. Report
   the choice and honest quality notes. Check: Ode to Joy sung (rendered
   offline, muted); the rendered pitch follows the melody (measured, within
   30 cents on held notes); one sound check of 10 s or less.
4. **Vocals from a recording.** In the Recording tools / wizard: vocal stem
   -> vocal melody track (a monophonic pitch tracker such as RMVPE/CREPE in
   ONNX, better than basic-pitch for voice) and lyrics by speech-to-text with
   word timings (Whisper in ONNX), lined up to the notes. Check: our sung Ode
   to Joy rendered and transcribed back: note F-score and word accuracy
   reported (target melody F 0.85+).
5. **Real-song accuracy (bass and guitar).** Round 6 scored 0.97 on our own
   renders but only 0.36 against the Hüsker Dü custom chart. That chart is
   fan-made and may itself be wrong (offset, octave, missed notes), so don't
   treat custom charts as the truth.
   - **Main benchmark: Ubisoft's official charts.** Dan owns Rocksmith 2014
     at `E:\Rocksmith2014`; its `songs.psarc` (on-disc songs) and any
     official DLC in `dlc\` are professionally charted. Read them in place
     with the helper (official files have SNG only: convert SNG -> XML with
     Rocksmith2014.NET). Pick 10-15 songs across styles, tunings (incl. drop
     and down-tuned) and bass/guitar. Read-only: never modify, copy outside
     `TestData/private/`, or commit anything from them; delete extracted
     audio after the run.
   - **Secondary: custom songs** in `TestData/private/` (report separately,
     flagged as fan-made).
   - Score with each chart's own time offset removed, and also report
     octave-ignored and timing-ignored scores, so a wrong chart and a wrong
     transcription can be told apart. For the 3 worst songs, list the bars
     where chart and transcription disagree most, so Dan can listen and say
     which is right.
   - Then improve: detect tuning and cent offset (down-tuned / drop tunings,
     songs not at A440), octave correction for bass (fret/string
     plausibility, the stem's low-frequency energy), a guitar mode that
     separates single-note lines from chords, and better onset timing on
     distorted guitar.
   Check: before/after F-scores per song (official and custom separately);
   no worse on our renders.
6. **"Describe it" song starters.** New > Describe a song: type e.g. "12-bar
   blues in E, shuffle at 110, guitar, bass, piano and drums, 3 choruses" and
   the app builds the chord chart, sections, tempo, key, style and lineup,
   then generates the band (using Rounds 2 and 4). A built-in parser handles
   the common wording (keys, modes, tempo, feel, styles, instruments, forms:
   12-bar blues, AABA, verse/chorus, ii-V-I, named progressions); if an
   `ANTHROPIC_API_KEY` environment variable is set, free-form descriptions
   go to Claude to fill a JSON song plan (never write the key to the repo,
   logs or settings). Shows the plan before generating so it can be edited.
   Check: 15 test descriptions parsed correctly offline (unit tests); one
   generated and played (muted).
7. **More sounds.** A sound library manager: add/remove SoundFonts
   (.sf2/.sf3) and SFZ instruments, pick a sound per track from any
   installed library, preview, and a short list of recommended free
   libraries with their licences and download links (Dan downloads them;
   don't bundle anything whose licence doesn't allow it). Check: a second
   SoundFont used on one track while others use the default; save/reopen
   keeps the choice.
8. **Save/load, undo, regression.** Everything above survives save/reopen
   and undoes in one step per action; the Round 1-6 app checks pass on the
   new exe.

### For Dan to check (fill in at end of round)
- Play an exported song in Rocksmith 2014 (timing, note placement,
  difficulty levels). Still pending from Round 3.

## Next Steps (Do Not Start Yet)
- **Later, unordered:** test item 7 of Round 4 with a real MIDI keyboard and Round 5
  recording with a real audio input (interface / Real Tone Cable).
- **Round 8 (planned): VST3 instruments and effects.** Needs a native host
  process (C++, e.g. JUCE) with audio routed back into our mixer and offline
  render; deferred from Round 7 because it is a round on its own.
- **Later:** Rocksmith tones (pick amp/pedal gear per arrangement instead of
  DLC Builder's default tone).

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
