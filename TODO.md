# musicGenie: Active Development Plan

## Standing rules
- Read `CLAUDE.md` first. Its testing rules (always muted with proof, never
  steal focus) apply to every check.
- Report per item: done / not done / deferred, and why. Never skip an item
  silently.
- One check per item, done in the built app, with screenshots you look at.

## Completed Tasks
Rounds 1-5 are archived in `TODO-ARCHIVE.md` (grep it, never read it in full).
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

### Round 7, "lyrics, singing, real-song accuracy, song starters" (2026-11-17): DONE in the app (in-game Rocksmith test still pending Dan)
Checks ran in the packaged 0.7.0 app (`npm run e2e:r7`), hidden (off-screen, never shown or focusable)
and `--mute`; speaker level measured 0 on every step (sung track playing: pre-gain 0.24, speakers 0).
**One sound check:** item 3, the sung Ode to Joy from bar 1, unmuted 8.0 s (peak 0.14), re-muted 0.
Unit tests 217/217 (`npm test`, 39 new). Rounds 1-6 app checks re-run on the 0.7.0 exe (no sound
checks): all pass, all silent (Round 6 item 10 needed a test fix: it assumed its 0.23 MB model was
not downloaded yet, which a full run never allows; it now removes it first).
Screenshots `test-results/r7-*.png`; report `report-round7.json`; benchmark `r7-5-benchmark.json`.
New: **🎤 Lyrics** and **🎻 Sounds** tabs in the 🎹 Compose dock, New ▸ Describe a song…,
🎧 Recording ▸ "Vocals → melody + lyrics" (and a "vocals" box in the wizard's step 4).
1. Lyrics: **done.** Syllables per note, verses, "-" hyphens, "_" held syllables; paste (auto
   syllables), type, drag; shown under the staff, in the review view and the PDF; MusicXML / GP import
   and export, MIDI lyric events (verse 1). Check: Ode to Joy, 2 pasted verses (62 + 61 syllables, one
   held): save/reopen identical; MusicXML and GP re-import keep both verses, MIDI verse 1; PDF 1 page.
2. Rocksmith vocals: **done.** Export writes a vocals arrangement (lines, game font characters),
   import makes a "Vocals" track. Check: .psarc built, helper checks 0 issues (incl. font check);
   re-read: 62/62 syllables, 11 lines; re-opened as a Vocals track with all 62 syllables.
3. Singing: **done. Choice: DiffSinger run by our own code on the existing ONNX runtime, Qixuan v2.7.0
   voicebank + OpenVPI PC-NSF-HiFiGAN vocoder.** Why: the only free voicebank found whose terms allow
   new inference programs and that sings English; no Python, no OpenUtau install; GPU (DirectML).
   Vibrato depth/rate, dynamics, breath, voice character, quality; re-sings when notes/lyrics change
   (button or automatic). Check: Ode to Joy (39 s) sung in 11-31 s on the GPU; 55/55 held notes within
   30 cents (-9..+1). Honest quality: smooth and in tune, but an accented (Chinese-English) voice;
   words are only partly understandable (see item 4); no consonant/duration model of our own yet.
   Fallbacks also done: .ustx (OpenUtau), .svp (Synthesizer V), Import rendered vocal.
4. Vocals from a recording: **done.** FCPE pitch tracker -> melody track, Whisper base -> words with
   timings (cross-attention + DTW) -> syllables on the notes. Check (our sung Ode to Joy back in):
   melody F 0.885 (50 ms; 0.934 at 100 ms; target 0.85 met); word accuracy 33-46 % over two runs
   (the voice is hard to understand; Whisper base on singing).
5. Real-song accuracy: **done** (improved; still far from a finished chart on real mixes). 12 official
   Ubisoft charts read in place from `E:\Rocksmith2014\dlc` (Creep, Cherub Rock, Purple Haze, Another
   One Bites the Dust, Three Little Birds, NOFX, Buddy Holly, Misirlou, Dust in the Wind, Stone Sour,
   Possum Kingdom, Bad Moon Rising; `songs.psarc` not used: the importer reads one song per package)
   + the custom Hüsker Dü file (fan-made, reported apart). Mean F (50 ms, exact pitch), before -> after:

   | | raw | chart offset removed | + octave ignored | timing ignored (250 ms) |
   |---|---|---|---|---|
   | official bass (12) | 0.417 -> 0.478 | **0.442 -> 0.494** | 0.519 -> 0.554 | 0.580 -> 0.599 |
   | official guitar (12, stem vs Lead+Rhythm) | 0.326 -> 0.344 | **0.338 -> 0.349** | 0.377 -> 0.393 | 0.483 -> 0.451 |
   | custom bass (Hüsker Dü) | 0.203 -> 0.191 | **0.335 -> 0.431** | 0.428 -> 0.476 | 0.501 -> 0.564 |

   Our renders, no worse: bass 0.696 -> 0.708, lead 0.886 -> 0.945, rhythm chords 0.916 -> 0.916.
   Added: cent offset (found up to +32 c, e.g. Buddy Holly; audio shifted onto the grid), tuning from
   the notes (right for 12/12 bass, 10/12 guitar parts), bass octave fix from the stem's low energy,
   guitar single-note lines vs chords, attack-based onsets for single notes. Bass gained on 11 of 12
   songs (biggest: Misirlou 0.57 -> 0.70, Buddy Holly 0.51 -> 0.63). Worst 3, bars to listen to
   (bar, time): Stone Sour bass 22/24/26 (0:43-0:49), guitar 73/114/117 (2:03, 3:08, 3:12); Creep bass
   16/44/64 (0:48, 2:01, 2:53), guitar 56/62/69 (2:33, 2:48, 3:06); Purple Haze bass 13/15/44 (0:37,
   0:42, 1:46), guitar 63-65 (2:27-2:31, the solo). Per song: `test-results/r7-5-benchmark.json`.
6. Describe a song: **done.** Built-in parser (keys/modes, tempo words, feel, 5 styles, 30
   instruments, 12-bar/minor/quick-change blues, AABA, verse/chorus/bridge, ii-V-I, named and Roman
   progressions, repeats, intro/ending, title) -> editable plan -> chord chart -> band. Claude
   (`claude-opus-5-5`) is used only when ANTHROPIC_API_KEY is set (not set here: untested live).
   Check: 15 descriptions in unit tests; "12-bar blues in E, shuffle at 110, ..." built 12 bars x3,
   E7/A7/B7, 110 bpm, shuffle, 4 tracks, and played (pre-gain 0.26, speakers 0).
7. More sounds: **done.** Library of SoundFonts + SFZ (SFZ converted to SoundFont in memory), a
   sound per track, preview, 6 recommended free libraries with licences/links (nothing bundled).
   Check: a test sine SoundFont (and the same as SFZ) on the melody: its high-band energy fell from
   0.042 to 0.011 / 0.006 (a sine) while the bass render stayed the same (rms 0.0283 vs 0.0283);
   save/reopen keeps the choice; preview heard by the meters (pre 0.86, speakers 0).
8. Save/load, undo, regression: **done.** Format v7. Check: reopen identical; paste, typing and
   sound choice each one undo step (+ redo); singing, vocals-to-notes are one step each. Rounds 1-6 checks pass on the 0.7.0 exe.
   Found + fixed on the way: re-opening a .psarc with vocals crashed; the Lyrics tab kept verse 2
   after opening another song; strummed chords lost timing when onsets were refined one by one.

### For Dan to check
- Play an exported song in Rocksmith 2014 (timing, note placement, difficulty levels). Still
  pending from Round 3 — also a "Song to Rocksmith" export of a real recording, and now lyrics: an
  export with a Vocals track (Rocksmith dialog ▸ "Vocals (lyrics)") should show them in the game.
- Run `dist\musicGenie-0.7.0-portable.exe`. Open a song, 🎹 Compose ▸ **🎤 Lyrics**: paste a verse,
  Put on notes; type into a box or drag a syllable to fix it; Verse ▸ 2 for another verse.
- Same tab, **Singing ▸ Sing** (first use asks to download the voicebank 421 MB + vocoder 53 MB;
  credit "Qixuan (绮萱) / DiffSinger" if you publish anything). Listen: is the voice usable? Try
  Vibrato, Breath, Voice; tick "re-sing after edits" and change a note.
- 🎧 Recording ▸ split stems of a song, then "Vocals → melody + lyrics" on the vocal stem (downloads
  FCPE 48 MB + Whisper 77 MB): are the melody and the words close?
- New ▸ **Describe a song…**: try your own wording; edit the plan, Create song. With
  ANTHROPIC_API_KEY set in Windows, "ask Claude" appears (not tried here: no key).
- 🎻 **Sounds**: add a SoundFont or SFZ you like (free ones are listed in the tab), pick it for one
  track, ▶ Preview, save and reopen.
- Benchmark bars to listen to (item 5): which is right there, the chart or the transcription?
- Known limits: the singer is only partly understandable (Whisper heard 33-46 % of the words);
  English only; real-song transcription is ~0.5 F for bass and ~0.35 for guitar against official
  charts (chords in full mixes are the weak part); a song can use up to 7 library sound files; SFZ
  covers samples, key/velocity ranges, loops and envelopes, not every opcode. The vocoder and Demucs
  weights are non-commercial (personal use only).
- Still open from earlier rounds: try the Round 2-6 features (each round above says how); Round 5
  recording with a real input, Round 4 with a real MIDI keyboard.

### Round 8, "make it understandable" (2026-11-17): DONE in the app (0.8.0; first-run tour still to be tried by Dan)
No new features, none removed: layout, wording, guidance. All checks hidden + muted (speakers 0).
1. Music first: **done.** Score area 64 % of the window at 1280x720 and 78 % at 1920x1080 (default
   layout); Full score (button / F11, Esc back) 91 % / 97 %. Window opens maximized, then at its last
   size. Tracks panel, band panel and bottom panel fold to a rail and resize by dragging; sizes, folds,
   zoom and view are remembered (checked across a reload). Zoom: Ctrl +/-/0, Ctrl+wheel, fit to width.
   Page view or scrolling view (one line: 4172 px vs 1596 px wide).
2. Menu bar + play bar + workspaces: **done.** File/Edit/View/Song/Tools/Help; play bar (play/stop,
   bar + time, tempo, loop, metronome, count-in, speed, volume, zoom, view, full score); Arrange (score,
   tracks, band), Write (roll, drums, chords, what chord next, lyrics, MIDI keyboard + note writing),
   Mix (mixer, changes over time, audio tracks, sounds), Recordings. Rocksmith: File > Export >
   Rocksmith 2014…, and an optional last step of "Recording to sheet music". Check: screenshot per
   workspace; all 21 former toolbar places reached through their new place.
3. Plain words: **done.** About 90 labels renamed (old word kept in the tooltip); expert settings behind
   "More options" in 12 panels. Check: every new word found, none of the old words still shown.
4. Home screen: **done.** 6 cards, recent files (8), 4 examples (Ode to Joy, Bach Prelude in C,
   Twinkle Twinkle, 12-bar blues in A: public domain / CC0, `public/examples/README.md`). Check: each
   card opens its flow; each example opens with its title.
5. Tours: **done.** First-run tour (7 steps, skippable, once; Help > Take the tour) + 5 more (writing
   notes, starting from chords, mixing/exporting, recording to sheet music, Rocksmith). Steps that wait
   for you move on when you do it. Check: all 6 complete by clicks in the hidden app; skip remembered.
6. Help everywhere: **done.** Check: 519 controls in 20 views, 0 without a tooltip; 27 "?" buttons,
   34 help pages (each what / when / 3 steps), none missing; searchable Help topics + 29-word glossary.
7. Docs: **done.** VISION.md (Rocksmith = bonus), CLAUDE.md (workspace layout, where new features go,
   tooltip + help rule), `Docs/USER-GUIDE.md` generated from the help pages (34/34 topics).
8. Regression: **done.** Rounds 1-7 app checks pass on the 0.8.0 exe (selectors updated: New, Export
   and Rocksmith go through the menu; the band panel is unfolded; one Round 6 wait fixed); 217 unit
   tests pass (save/load, undo unchanged).

### For Dan to check
- Run `dist\musicGenie-0.8.0-portable.exe`. Does it make sense now? Take the first-run tour (it starts
  by itself the first time), then try one thing on your own, and say where you got lost.
- Hover over anything you don't understand: is the tooltip clear? Press "?" on a panel, or F1.
- Tell me if any label still reads like jargon, or if something you used before is hard to find
  (the report lists where every old toolbar button went).
- Play an exported song in Rocksmith 2014 (still pending; a bonus now).

## Next Steps (Do Not Start Yet)
- **Later, unordered:** test item 7 of Round 4 with a real MIDI keyboard and Round 5
  recording with a real audio input (interface / Real Tone Cable).
- **Round 9 (planned): VST3 instruments and effects.** Needs a native host
  process (C++, e.g. JUCE) with audio routed back into our mixer and offline
  render; deferred from Round 7 because it is a round on its own.
- **Later: recording-to-notes accuracy round 2** (stronger multi-instrument
  models, fast cleanup tools such as fix-octave-on-selection and snap to
  chord shape). Lower priority since Rocksmith is a bonus.
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
