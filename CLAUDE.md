# musicGenie: Project Context & Rules

A Windows desktop music studio: import or write music, assign any instrument
to any part, hear it played by a virtual band, and (later) export guitar/bass
parts as Rocksmith 2014 custom songs. Full vision and roadmap:
`Docs/VISION.md`. Current work: `TODO.md`.

## Tech Stack (decided 2026-11-16)
- **App:** Electron + TypeScript, built with Vite (electron-vite is fine).
  Plain TS + a light UI layer: **React 19** (picked in Round 1; keep it).
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
  to .wem needs Wwise 2019/2021/2022/2023 installed on Dan's PC (DLC Builder
  documents 2019 and 2021; the library also accepts 2022 and 2023).
- **ML runtime (Round 6, decided 2026-11-16):** ONNX Runtime from Node
  (`onnxruntime-node` 1.31.1, MIT) in an Electron utility process; DirectML on the GPU
  (GTX 1660 Ti here) with CPU fallback. No Python. Models are downloaded on first use.
- **Plug-in tools/models (not built ourselves), with licences:**
  - Beat This! (CPJKU, beats + downbeats): code and weights **MIT**; ONNX export
    `final0-v2.onnx` by ashudesai/songbird-models (MIT), pinned to commit 813eff2.
    (The repo's first `final0.onnx` froze the time axis: beats stop after ~6 s per chunk.)
  - HT-Demucs 6 stems (Meta, stems): code **MIT**; the v4 weights are **CC BY-NC 4.0**
    (non-commercial) per the export's README. ONNX export HRSadeghi/demucs-onnx (MIT), commit
    9128f6e; our STFT/overlap host code is ported from its JS binding (MIT).
  - basic-pitch (Spotify, audio to notes): **Apache-2.0**, `nmp.onnx` from tag v0.4.0; note
    decoding ported from its Python.
  - Drums: no usable free drum-transcription model in ONNX: our own onset detection +
    band-energy rules (`src/ml/drums.ts`), no ML.
  - Audiveris 5.11.0 (sheet music from PDF/images): **AGPL-3.0**, run as a separate program
    (never linked); the official windowsConsole MSI bundles its own Java runtime.
  - **Singing (Round 7): DiffSinger** run by our own host code (`src/ml/sing.ts`) on onnxruntime-node.
    Voicebank **Qixuan v2.7.0** (OpenVPI / yqzhishen, GitHub release zip, 420 MB): its Terms of Use
    allow new inference programs and any use of the output, but published songs must credit
    "绮萱 (Qixuan)" and "DiffSinger" and be marked as AI-made; no violent/sexual/political/religious
    content; the model must not be modified; outputs must not be used as training data; redistribution
    only whole, unmodified, free (so the app downloads it, never bundles it). Vocoder **OpenVPI
    PC-NSF-HiFiGAN 44.1k hop512 128bin 2025.02** (`.oudep` release asset, 53 MB): **CC BY-NC-SA 4.0**
    (non-commercial). Other banks were rejected: SPORE (CC BY-NC-ND variant, "UTAU-like synths only"),
    LUNAI (forbids porting to other engines). Fallback exports: `.ustx` (OpenUtau, MIT) and `.svp`.
  - **FCPE** pitch tracker (vocal melody): **MIT** (CNChTu/FCPE; ONNX tuneperfect/fcpe-onnx @f99224c, 48 MB).
  - **Whisper base** (lyrics from vocals): OpenAI code + weights **MIT**; ONNX export
    onnx-community/whisper-base_timestamped @608c49e (quantized encoder 23 MB + decoder 53 MB, with
    cross-attentions for word timings).
  - **Claude** ("Describe a song", optional): `@anthropic-ai/sdk` 1.9.0 (MIT) in the main process,
    model `claude-opus-5-5`, only when `ANTHROPIC_API_KEY` is in the environment (never stored).
  - Sound library: nothing bundled. Recommended downloads (Dan's choice): MuseScore General (MIT),
    FluidR3 GM (MIT), Salamander Grand (CC BY 3.0), VSCO-2 CE and VCSL (CC0), Virtual Playing
    Orchestra (mixed CC, link only).

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
Run heavy jobs at Below Normal, e.g. `cmd /c "start /belownormal /b /wait npm run dist"`.
- Install: `npm install`, then `node node_modules/electron/install.js` (npm 11's
  allow-scripts skips Electron's binary download).
- Dev run (visible window, for Dan): `npm run dev`
- Unit tests (model, import counts, save/load, transpose, undo, chords, split, band styles,
  mixer maths, loudness, export round trips): `npm test`
- Typecheck: `npm run typecheck`
- Build: `npm run build` (-> `out/`). Windows app: `npm run dist` ->
  `dist/win-unpacked/musicGenie.exe` + `dist/musicGenie-<ver>-portable.exe`.
- App checks (hidden + muted, screenshots in `test-results/`, report in
  `test-results/report.json`): `npm run e2e` (packaged exe) or `npm run e2e:dev`
  (after `npm run build`). Options: `--only=1,5`, `--no-sound-check`.
  Item 6 is the only step that unmutes (2 s); always pass `--no-sound-check`
  unless a sound check is actually needed.
- Round 2 app checks: `npm run e2e:r2` (packaged) / `npm run e2e:r2:dev`; report
  `test-results/report-round2.json`. Sound checks: item 1 (2 s) and item 7 (4 s); skip
  with `--no-sound-check`.
- From Git Bash, `cmd //c "start /belownormal ..."` hangs: run Below Normal builds from
  PowerShell (`cmd /c "start /belownormal /b /wait npm run build"`).
- Regenerate the MusicXML test piece: `node tests/fixtures/make-ode-to-joy.mjs`
- Rocksmith helper (.NET 8, needs the .NET SDK 8+ to build and the .NET 8 runtime to run):
  `git submodule update --init` once, then from PowerShell
  `cmd /c "start /belownormal /b /wait npm run helper"` -> `helpers/rocksmith/bin/MgRocksmith.exe`
  (gitignored). Build it BEFORE `npm run dist`: the exe ships it as `resources/rocksmith/`.
  One-shot use: `MgRocksmith.exe ping|findWwise|findRocksmith`, `MgRocksmith.exe read <file.psarc>`;
  JSON args go over stdin (`{"id":1,"cmd":"write","args":{...}}`, one per line).
- Round 3 app checks: `npm run e2e:r3` (packaged) / `npm run e2e:r3:dev`; report
  `test-results/report-round3.json`. No sound checks. Items 4, 5 and 8 use the private
  reference file `TestData/private/Husker-Du_...psarc` and skip without it; its unpacked
  copies and re-export are deleted at the end of the run.
- Round 5 app checks: `npm run e2e:r5` (packaged) / `npm run e2e:r5:dev`; report
  `test-results/report-round5.json`. No sound checks. Effects are checked offline on test
  signals (`src/renderer/src/fxChecks.ts`); recording uses a simulated cable (output -> delay ->
  input, `recorder.openSimulated`), so no real input device is needed.
- Round 6 app checks: `npm run e2e:r6` (packaged) / `npm run e2e:r6:dev`; report
  `test-results/report-round6.json`. No sound checks (pitch at 50 % speed is measured on the review
  player's own output, speakers 0). Uses a shared test profile `%TEMP%\musicgenie-r6-models` that
  keeps only downloaded models between runs (everything else is wiped before/after);
  `--clean-models` deletes it. Our test songs are rendered once into `test-results/r6-fixtures/`
  (mix + each part + truth JSON). Items 2/4/7 also benchmark the private Hüsker Dü file
  (skipped without it; its derived files are deleted).
- Round 7 app checks: `npm run e2e:r7` (packaged) / `npm run e2e:r7:dev`; report
  `test-results/report-round7.json`, benchmark `test-results/r7-5-benchmark.json`. Sound check: item 3
  only (8 s of the sung Ode to Joy); skip with `--no-sound-check`. Item 5 reads 12 official songs in
  place from `E:\Rocksmith2014\dlc` (read-only) + every .psarc in `TestData/private/`; `--songs=N`
  limits the official list; their audio, stems and transcriptions are deleted after each song
  (~2.5 min per song). Shares the Round 6 model profile `%TEMP%\musicgenie-r6-models`.
- Round 8 app checks: `npm run e2e:r8` (packaged) / `npm run e2e:r8:dev`; report
  `test-results/report-round8.json`. No sound checks. Measures the score area at 1280x720 and
  1920x1080 (window resized with `setContentSize`, still hidden), drives every tour with clicks, audits
  every control for a tooltip. Item 5 also launches a fresh profile with `--tour` (first-run tour).
- Help pages -> user guide: `node scripts/make-user-guide.mjs` (rewrites `Docs/USER-GUIDE.md` from
  `src/renderer/src/help/*.ts`; run it after changing any help page). Example songs:
  `node scripts/make-examples.mjs` (-> `src/renderer/public/examples/`, all public domain / CC0).
- Round 4 app checks: `npm run e2e:r4` (packaged) / `npm run e2e:r4:dev`; report
  `test-results/report-round4.json`. No sound checks (nothing unmutes). Item 7 drives the
  MIDI recorder with a simulated input (`mgTest.midiSimulate`); no keyboard needed.

## Standing facts
- App flags: `--mute` (master gain 0 before any audio), `--hidden` (off-screen
  rendering, never shown or focusable, exposes `window.mgTest`),
  `--profile-dir=DIR`, `--autosave-ms=N` (default 120000), `--open=FILE`,
  `--tour` (start the first-run tour even when hidden; it never starts in a hidden window otherwise).
- **UI layout (Round 8) — where things go.** `App.tsx` = shell: top bar (`Shell.tsx`: `MenuBar` File/Edit/
  View/Song/Tools/Help, `WorkspaceTabs`, `WorkspaceTools`), `PlayBar`, then tracks panel (left) | score |
  band panel (right, Arrange only), bottom panel `Workspace.tsx` `Dock`. Workspaces (`store.WORKSPACES`):
  **Arrange** (no bottom tabs; band panel), **Write** (roll, drums, chords, prog, lyrics, midi + note editing),
  **Mix** (mixer, auto, audio, sounds), **Recordings** (rec). `store.openDock(tab)` switches to the tab's
  workspace; `dock = null` = folded. A new feature goes into the workspace it serves (a bottom tab, the
  workspace tools strip, or a menu item) — never a new always-visible toolbar button. Rocksmith stays
  under File > Export (bonus). Panel sizes/folds, zoom ('fit' or a scale) and page/scroll view are
  `state.layout`, saved in localStorage `mg.layout.v1`; the score keeps >= 60 % of the window at 1280x720.
  The window opens maximized the first time, then at its last size (`settings.json` `window`; not in tests).
  Electron's own menu keeps only edit roles + reload/dev tools (F11 and Ctrl +/-/0 belong to the app).
- **Tooltip + help rule (Round 8):** every new button/select/input/textarea/summary needs a `title`
  (or sits in a `<label title>`) that says what it does AND when you'd use it, in plain words; every new
  panel or dialog needs a `<HelpButton topic=…>` (`HelpUi.tsx`) and a page in `src/renderer/src/help/*.ts`
  (what, when, exactly 3 steps); then regenerate `Docs/USER-GUIDE.md`. Expert settings go in
  `<MoreOptions>` (a `<details>`: children stay in the DOM for tests). Jargon stays in the tooltip, the
  label uses plain words (e.g. "Split into instruments", "Turn audio into notes", "Changes over time").
  `npm run e2e:r8` item 6 fails on any control without a tooltip.
- Home screen (`Shell.tsx` `Home`): shown with no song or via File > Home (`state.home`); example songs in
  `public/examples/` open under their own title (`openExample`); recent files = `settings.json` `recent`
  (8, added on open/save). Tours (`tours.ts`): steps point at real controls by selector; a step with
  `done` moves on only when the user does it (not if it was already true when shown). First-run tour
  once (`settings.json` `tourDone`). `mgTest.clickGenerate` unfolds the band panel for its click.
- Master bus (`src/renderer/src/audio/masterBus.ts`) patches
  `AudioNode.connect` so everything bound for the speakers goes pre-analyser ->
  gain -> post-analyser. `post` peak is the proof of silence; `pre` peak proves
  audio was really produced. It must stay the FIRST import in `main.tsx`.
- Hidden windows use `webPreferences.offscreen` in test mode: plain
  `show:false` windows returned stale `capturePage()` screenshots.
- alphaTab 1.9 quirks: key signatures live on `Bar`, not `MasterBar`; every bar
  of a staff needs the same voice count; string 1 = LOWEST string (our model
  uses the same; tuning arrays are lowest-first, alphaTab's highest-first);
  `clearPlaybackRangeHighlight()` leaves private `_selectionStart/_selectionEnd`
  that crash the next render, so `ScorePlayer.clearRange()` resets them.
  Rendering runs on the page thread (`core.useWorkers = false`) so errors surface.
- Model ticks: PPQ 960 (same as alphaTab). MIDI import quantises to 16ths and
  splits one two-hand piano track into treble/bass staves at middle C.
- Recovery: `userData/recovery/session.lock` + `autosave.mgproj`; a lock left by
  a crash turns the autosave into a restore offer on next start.
- Default SoundFont: GeneralUser GS 2.0.3 (S. Christian Collins), tracked in
  `src/renderer/public/sounds/` with its licence (GeneralUser GS License v2.0: free use,
  "use it in your software projects", may repackage). `public/soundfont/` and
  `public/font/` are gitignored (the alphaTab Vite plugin fills them). The user's
  SoundFont path is in `userData/settings.json` and in the project (`playback.soundFont`).
- Project format v7 (`SCHEMA_VERSION = 7`; v7 adds `beat.lyrics` (verses), `track.voice` (sung rendering), `track.sound` (library sound), `song.describe` (the plan), `rocksmith.vocals`; v6 adds `song.recording` (the original recording's
  track/clip), `track.analysis` (stem / transcription tag) and `track.omr` (bars the sheet-music
  reader was unsure of). v5 adds `song.mix` (master fx/fader, Reverb + Delay
  send buses), `mixer.fx` / `mixer.sends`, `track.automation` (lanes of bar/tick points) and
  `track.audio.clips` (audio tracks; clip files saved RELATIVE to `<project>_media\`, absolute
  in memory: `relativizeMedia` / `absolutizeMedia`). v4 adds `tempos[].ramp` / `tempos[].rampTo` for gradual
  tempo changes and `song.chart` = the chord chart text). Older: v2 = `song.playback` (swing, soundFont),
  `song.band` (panel setup), `track.generated` (style, role, complexity, seed,
  sectionSeeds, contentHash), `track.derived` (split parts), `chordSymbols[].source`;
  v3 adds `song.backing` (recording: path, offsetMs = where bar 1 starts in it, volume,
  mute), `song.rocksmith` (last export settings), `track.rocksmith` (arrangement type,
  tone), techniques `tremolo` and `slideToFret`. Older files open unchanged.
- Frets count from the NUT, also with a capo (pitch = tuning[string-1] + fret), like
  Rocksmith. alphaTab counts from the capo: `toAlphaTab` subtracts the capo, `fromAlphaTab`
  adds it. Typing "0" on a capoed string means the capo fret.
- Note editing (`src/model/noteEdit.ts`): pure cursor edits; every voice is refitted to
  exactly one bar after an edit (rests fill, overflow drops beats from the end). Keys in
  `src/renderer/src/editor.ts`; tests drive them with `mgTest.key()` (window keydown, no
  OS focus needed).
- Rocksmith (`src/model/rocksmith.ts`, pure): the helper turns .psarc/.rs2dlc/.xml into
  JSON (times in ms, strings 0-based, raw note masks, all difficulty levels merged with
  `RemoveDD`) and back. Import: every ebeat = one quarter note at its own tempo (tempo map
  per beat, 32nd grid); stray markers closer than 1/4 beat are dropped. Export adds a
  lead-in (whole bars, >= 2 s, COUNT phrase) and a one-bar tail (END phrase + `noguitar`),
  phrases one per section, auto anchors, chord templates + handshapes; the WAV gets the same
  lead-in so chart and audio line up. Re-importing an export therefore has the lead-in bars
  in front and the tail bar at the end.
- Rocksmith helper (`helpers/rocksmith/MgRocksmith`, F#): Rocksmith2014.NET by iminashi,
  **MIT licence**, git submodule `helpers/rocksmith/Rocksmith2014.NET` pinned to tag
  **v3.5.0** (only `Rocksmith2014.XML` is on NuGet). The library pins Magick.NET 14.7.0,
  which has security advisories: the helper references the patched 14.17.2 and builds with
  `-p:NuGetAudit=false` (the audit otherwise fails the submodule's own restore). Electron
  runs it at Below Normal (`src/main/rocksmithHelper.ts`). Export stops before Wwise if it
  is missing and keeps the XML, WAV, preview, cover and a DLC Builder `.rs2dlc`.
- Wwise on Dan's PC (installed 2026-11-16): **Wwise 2023.1.19.8928**, Authoring only, at
  `C:\Audiokinetic\Wwise2023.1.19.8928` (WwiseConsole in `Authoring\x64\Release\bin`),
  through the Wwise Launcher 2026.2.0 (`C:\Program Files\Wwise Launcher\`). The Launcher
  lists only the newest Wwise (2026.x, unsupported) unless the version filter is set to All.
  The launcher sets `WWISEROOT` in the registry; processes started earlier don't see it, so
  the helper (`ensureWwiseRoot`) fills it in from the registry (User/Machine) or by searching
  `X:\Audiokinetic`, `X:\Program Files (x86)\Audiokinetic`, `X:\Program Files\Audiokinetic`
  on every fixed drive for a 2019/2021/2022/2023 folder.
- Rocksmith 2014 on Dan's PC: `E:\Rocksmith2014` (not in a Steam library folder; Steam's
  manifest still lists app 221680 under C:). The helper searches Steam libraries, then
  `X:\Rocksmith2014`, `X:\SteamLibrary\...`, `X:\Games\...` on every fixed drive. Dan's
  choice is saved as `rocksmithDlc` in `userData/settings.json`.
- Backing track: an `<audio>` element follows the player position (seek on start/jumps,
  re-seek past 120 ms drift) through the master bus, so `--mute` covers it.
- Offline audio (export, Rocksmith WAV, checks): `audio/offline.ts` runs the SAME synth
  (`synth.exportAudio` exporter, split per channel) into the SAME mixer graph in an
  OfflineAudioContext (effects, sends, master, automation, clips), ~4-10x real time. The
  master bus patch skips OfflineAudioContexts (they never reach the speakers).
- Band engine (`src/model/band.ts`) is pure and seeded: same song + settings + seed = same
  notes. "Edited by hand" = staves hash differs from `generated.contentHash`.
- Swing is applied at playback only, in `api.midiLoad` (`src/render/swing.ts`).
- Playback engine (Round 5, `src/renderer/src/audio/engine.ts`): alphaTab's player factory
  (`uiFacade.createWorkerPlayer`) is replaced so the AlphaSynth runs on the PAGE thread; its
  TinySoundFont `_fillWorkingBuffer` is patched to render each MIDI channel into its own buffer
  (`splitByChannel`); an AudioWorklet (`mg-synth`, 17 outputs) plays them and reports played
  frames back (the cursor clock). Each track owns its channel(s) (`toAlphaTab`: 2 per track up
  to 7 melodic tracks, then 1; drums share 9; audio tracks get 15 and their MIDI is dropped);
  outputs feed `MixGraph` strips (`audio/graph.ts`). Volume/pan/mute/solo are Web Audio gains
  (alphaTab's `pb.volume` fixed at 13, balance 8). alphaTab puts the metronome on "highest used
  channel + 1" (`engine.metronomeChannel`), routed to `graph.click` (no effects). Buffer 1 s.
  The engine SUSPENDS its AudioContext after 5 s with nothing playing (`engine.wake()` on play,
  live notes, open audio input): leaving the device streaming silence crashed the page after
  several minutes in hidden test runs.
- Fader law (`src/model/mix.ts`): position 0.8 = 0 dB, dB = 60*log10(pos/0.8); equal-power pan.
- Effects (`audio/fx.ts`): Web Audio nodes plus our own worklet processors `mg-comp`
  (Web Audio's DynamicsCompressor adds automatic makeup gain, so it is not used), `mg-limiter`
  (5 ms look-ahead), `mg-gate`, `mg-recorder`. Only CHANGED parameters are applied on a sync
  (re-setting a convolver IR on every edit is expensive). Reverb and cabinet impulse responses
  are generated by our own code from a fixed seed (`reverbIR`, `cabinetIR`): no third-party
  licence. MP3: `@breezystack/lamejs` 1.2.7 (LGPL-3.0), loaded as its own chunk (dynamic import).
- Automation: live = a 25 ms timer sets params from the heard position (`modelTick`), so it
  follows loops/repeats/seeks; offline = one ramp point per 50 ms rendered chunk.
- Audio clips: live `ClipPlayer` starts a clip when the heard position passes its bar (every
  pass), or mid-clip after a seek. Recording: `audioTracksCtl.ts` maps recorded context frames
  to the song through the worklet clock (`engine.anchorLog`) minus the latency setting.
- PDF: main opens a hidden, non-focusable, offscreen window (`?print=1` -> `PrintView`),
  alphaTab page layout at the printable width, then `printToPDF` (page numbers in the footer).
- `.mgpack` = stored ZIP (`src/main/zip.ts`) of `<name>.mgproj` + `<name>_media/`; opening one
  unpacks to `userData/packages/` and leaves the file path empty (Save asks where).
- Never use native dialogs for questions (they would show over a hidden test window):
  `store.ask()` shows an in-app one.
- Round 6 analysis: `src/ml/` is pure (DSP, Demucs/basic-pitch/Beat This! host code, drums,
  WAV I/O, pitch) and unit-tested; `src/main/mlWorker.ts` (utility process, Below Normal, one job at
  a time, Cancel = kill) runs it; `src/main/ml.ts` holds the model catalogue (pinned URLs + exact
  sizes) and downloads into **`userData\models\<id>\`** (beat-this 83 MB, demucs-6s 110 MB,
  basic-pitch 0.23 MB). Audiveris is unpacked (`msiexec /a`, no install, no admin prompt) into
  **`userData\tools\audiveris\`** (`src/main/omr.ts`). Temporary audio: `userData\ml-temp`
  (cleared by `analysis.cleanTemp()`), stems go to the project's `<name>_media` folder (or
  `userData\media` before the first save), OMR output to `userData\omr\`.
- Beat This! runs on the CPU on purpose (DirectML recompiles per chunk shape: ~3x slower);
  Demucs and basic-pitch use DirectML. Beats get sub-frame (parabolic) peaks; the tempo map is
  fitted to the beats (`src/model/beatMap.ts`, 12 ms tolerance). Beat edits (drag, set
  downbeat, tap tempo, re-bar) never move audio clips; rebuilding bars keeps notes at their time.
- basic-pitch onsets are moved 25 ms earlier (measured lag, see `src/ml/basicPitch.ts`); single-
  note parts merge weak re-attacks; bass keeps the lowest strong note (drops harmonics).
- The resampler (`src/ml/dsp.ts`) is a Kaiser-windowed sinc; non-integer ratios (48 kHz) are
  covered by a unit test since a table-index bug once produced NaN.
- Review view (`Review.tsx`): the score switches to alphaTab's horizontal layout; waveform /
  spectrogram drawn per bar from `boundsLookup` so they line up; A/B uses `engine.setListenOnly`
  (no song edit); the recording/stem plays through a second `BackingPlayer` (`<audio>`,
  `preservesPitch`), so 25-100 % speed keeps the pitch.
- Swing is applied at playback only, so test truth for swung styles (Jazz) uses `swingTick`.
- Lyrics (`src/model/lyrics.ts`): `beat.lyrics[verse]`; "Freu-" = the word goes on, "_" = held
  (melisma), "" = none; v6 `beat.lyric` moves into `lyrics[0]` on load. Slots = sounded beats of
  voice 1 (tied continuations and rests skipped). alphaTab's MusicXML importer drops `<syllabic>`, so
  `musicXmlKeepHyphens` adds the "-" first; MIDI lyrics are header meta events (verse 1). The Lyrics
  dock tab pastes (auto syllables), types and drags (`moveSyllables`: that syllable and all later ones).
- Rocksmith vocals: helper `read` returns `vocals` (non-Japanese vocals arrangement), `write` takes
  `vocals` (ms, "-" joins, "+" ends a line; lines end at punctuation, a beat of rest or 8 words) and runs
  `ArrangementChecker.checkVocals` (length, line breaks, default-font characters; `rsLyricText` maps
  the rest). Import makes a muted "Vocals" choir track with one syllable per note.
- Singing (`src/ml/sing.ts`, worker job `sing`): our own phoneme timing (onset consonants end at the
  note start, vowel holds the note, coda <= 40 %), pitch curve (40 ms glides, delayed vibrato), phrases
  split at rests >= 300 ms; the voicebank's variance model predicts breathiness/voicing; acoustic
  (DirectML) -> mel -> vocoder; 44.1 kHz WAV in the project media folder as an audio track tagged
  `track.voice` (hash of notes+lyrics+tempo+settings -> "out of date"; `auto` re-sings 3 s after edits).
  English words: the voicebank's `dsdur/dsdict-en.yaml` (268k words), letter rules otherwise.
  Models unpack into `userData\models\qixuan\Qixuan_v2.7.0_DiffSinger_OpenUtau\` and
  `userData\models\pc-nsf-hifigan\` (`src/main/unzip.ts`, zip deleted after unpacking).
- Vocals from a recording: FCPE (CPU) f0 every 10 ms -> `f0ToNotes` (cent offset, 0.6-semitone /
  energy-dip splits) -> "Vocal melody" track; Whisper (CPU, greedy, 30 s windows cut at quiet points,
  word times from alignment-head cross-attention + DTW) -> `placeWords` onto the notes.
- Transcription refinements (Round 7, on by default; `refine: false` = Round 6 behaviour): cent offset
  from spectral peaks (audio resampled onto the semitone grid when |offset| >= 8 c), bass octave fix
  (Goertzel energy an octave lower >= 15 %), guitar single-note lines vs chords (`guitarLines`), onsets
  moved to the high-band spectral-flux peak within ±60 ms, tuning guessed from the note range
  (written to the track; cent offset to `track.rocksmith.centOffset`).
- Sound library (`soundLib.ts`, settings `soundLibrary`): a track's `sound` = {file, bank, program};
  library file k of a song is loaded after the main SoundFont with all its banks moved up by 256*(k+1)
  (`moveSf2Banks`), and the track plays that bank (alphaTab keeps 11 bank bits: max 7 files per song).
  SFZ is converted to a one-preset SF2 in memory (`sfzToSf2`: key/vel ranges, root, tune, volume, pan,
  loops, ampeg). A missing file falls back to the main SoundFont in that bank range.
- "Describe a song" (`src/model/describe.ts`): parser -> `SongPlan` -> `planToChart` (Round 4 chart)
  -> `generateBand` with the plan's lineup and feel; `song.describe` keeps the plan. With
  `ANTHROPIC_API_KEY` set, `src/main/describe.ts` asks Claude for the plan (structured output) and
  `sanitizePlan` checks it.

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

- Piano roll / drum grid / MIDI takes edit notes as events (`src/model/pianoRoll.ts`):
  `setStaffNotes` rebuilds ONLY the bars an edit touched (plus bars a tied note crosses), so
  untouched bars keep their notation. Overlapping notes go to extra voices (`layoutVoices`;
  alphaTab draws voice 2+ grey). Fretted tracks get string/fret via `assignChord` (capo kept).
  `splitTicks` writes off-grid lengths as triplets, split at beat boundaries.
- Live notes (chord explorer, piano-roll keys, drum lanes, MIDI keyboard):
  `audio/liveSynth.ts` = a SECOND alphaTab `AlphaSynth` on the page thread with a dummy
  output; we call its internal `synthesizer` (TinySoundFont: channelNoteOn/Off, synthesize)
  from a ScriptProcessor in the engine's AudioContext, into the selected track's strip (its
  effects). `playNote` would stop the song, so this is how notes play over it. --mute covers it.
- Playback ticks vs model ticks: alphaTab plays repeats unrolled. `ScorePlayer.barStartTick`
  uses `api.tickCache.getMasterBarStart`; `status.songTick` = position folded back onto the
  model (piano-roll playhead, MIDI recording clock).
- MIDI recording clock: anchors (performance.now, songTick) from position updates once the
  count-in is over; note times are mapped at Stop (`MidiRecorder` + `quantizeNotes`), notes
  before the start bar are dropped. Quantise "none" still snaps to 1/64.
- Tempo ramps: one tempo point per beat; the first carries `rampTo`, the rest `ramp: true`
  (`src/model/songChanges.ts`). Time-signature changes refit bars (`fitVoice`) and regenerate
  the band in the same undo step if no band track was edited.
- Drum patterns saved by the user live in `userData/settings.json` (`drumPatterns`), the
  last MIDI input in `midiInput`; Round 5 adds `fxPresets`, `audioInput`, `latencyMs`.
- Keyboard piano (`kbdPiano.ts`): only while the toggle is on; capture-phase key listener that
  feeds `MidiController.handle`, so hearing/step entry/recording work like a MIDI keyboard.

## Where things stand
**Always check `TODO.md` for the current objective before starting work.**
Rounds 1-7 built the features (import, score/tabs, band, editing, Rocksmith,
composition tools, mixer/effects/export, recording to notes, lyrics/singing,
describe a song). Round 8 (done, 0.8.0) reorganised the UI without new features:
score-first layout, menu bar + play bar + four workspaces, plain words, Home
screen with examples, guided tours, a tooltip on every control and a help page
per panel (`Docs/USER-GUIDE.md`). Rocksmith is a bonus export (File > Export).
Next planned: Round 9, VST3 instruments and effects (see `TODO.md`).
Layout: `src/model` (pure model + edits + undo + .mgproj, chords, split,
sections, band engine, noteEdit, tunings, tempo, rocksmith, pianoRoll, chordTheory,
progressions, drums, songChanges, chart, harmony, recording, mix, loudness, audioClips,
beatMap, transcribe, lyrics, sounds, describe), `src/ml` (pure analysis host code; Round 7: sing,
voice, whisper, refine), `src/export` (MIDI, MusicXML,
Guitar Pro writers), `src/import` (alphaTab + MIDI importers), `src/render/toAlphaTab.ts`,
`src/main` (Electron, settings.json, Rocksmith helper process, ml worker + models, Audiveris),
`src/preload`, `src/renderer` (Round 8 shell: App.tsx, Shell.tsx menus/play bar/home/help/tour overlay,
Workspace.tsx bottom panel, HelpUi.tsx, tours.ts, help/*.ts pages; React UI, Band panel, dialogs, Round3.tsx edit bar/tuning/export
dialog, editor keys, player, store, test API; `audio/` engine, graph, fx, worklet, offline, clips,
recorder; Mixer/Automation/AudioTracks/Round5 export dialog, PrintView; Round6.tsx recording
panel + wizard, analysis.ts, Review.tsx, omr.ts; Round7.tsx lyrics tab, sound library, Describe
dialog; singing.tsx, soundLib.ts), `src/render/sf2.ts` (SoundFont tools, SFZ -> SF2), `src/export/vocal.ts`
(.ustx / .svp), `src/main/describe.ts` (Claude), `src/main/unzip.ts`, `helpers/rocksmith` (.NET helper + library
submodule), `tests/unit`, `tests/e2e`, `TestData` (sources in its README).
