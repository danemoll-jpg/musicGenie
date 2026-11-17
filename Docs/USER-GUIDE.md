# musicGenie user guide

musicGenie lets you **open or write music, see it as sheet music or tabs, give it instruments and a band, and hear it.**
Everything else supports that. This guide is made from the help pages inside the app (the “?” buttons and
Help > Help topics), so the two always say the same thing. Help > Take the tour walks you through the main path.

**The screen:** the menu bar (File, Edit, View, Song, Tools, Help) and the four workspace tabs are at the top,
the play bar under them, the music in the middle, the tracks (instruments) on the left, the band panel on the
right in Arrange, and each workspace's own tools in the bottom panel. Panels fold away and resize by dragging;
⛶ Full score (F11) shows only the music. Every button explains itself when you hover over it.

## Contents
- **Start**: [The start screen (Home)](#home) · [Workspaces: Arrange, Write, Mix, Recordings](#workspaces) · [The menus](#menus) · [Describe a song](#describe)
- **Arrange**: [Tracks (instruments)](#tracks) · [The play bar](#playbar) · [Seeing the music: zoom, page view, full score](#score-view) · [Transpose (move up or down)](#transpose) · [Split into melody / bass / harmony](#split-parts) · [Tuning and capo](#tuning) · [The band panel](#band) · [Chord picker](#chord-picker)
- **Write**: [Write notes in the score](#edit-notes) · [Piano roll](#piano-roll) · [Drum grid](#drum-grid) · [Chords](#chord-explorer) · [Progressions (which chord next?)](#progressions) · [Lyrics](#lyrics) · [MIDI keyboard and keyboard piano](#midi-keyboard) · [Start from chords](#chord-chart) · [Key, time signature and tempo](#song-changes) · [Singing](#singing)
- **Mix**: [Mixer](#mixer) · [Effects](#effects) · [Changes over time](#changes-over-time) · [Audio tracks](#audio-tracks) · [Sounds (sound library)](#sound-library)
- **Recordings**: [Recording to sheet music](#recording-to-sheet-music) · [Recording tools](#recording-tools) · [Sheet music from a PDF or photo](#sheet-music-from-pdf) · [Compare with the recording](#compare-with-recording)
- **Files**: [Export](#export) · [Sound set (SoundFont)](#sound-set)
- **Bonus**: [Export to Rocksmith 2014 (bonus)](#rocksmith-export)
- [Glossary](#glossary)

## Start

Getting around: the Home screen, the four workspaces and the menus.

### <a id="home"></a>The start screen (Home)

The first thing you see: big cards for the ways to start, example songs and the files you used lately. File > Home brings it back at any time.

**When to use it:** When you open the app, or when you want to start something new without closing what you have.

**Try it:**
1. Click “Try an example” and pick “Ode to Joy”.
2. The song opens in the Arrange workspace.
3. File > Home takes you back here; “Back to …” returns to the song.

- Not sure where to begin? Help > Take the tour.

### <a id="workspaces"></a>Workspaces: Arrange, Write, Mix, Recordings

The four tabs at the top split the app by what you are doing. Each shows only its own panels; the music stays in the middle.

**When to use it:** Arrange to open music, choose instruments and add a band; Write to enter notes, chords, drums and lyrics; Mix to balance, add effects and export; Recordings to turn audio or a PDF into notes.

**Try it:**
1. Open a song: you are in Arrange.
2. Click Write: the note tools appear at the bottom.
3. Click Mix: the mixer appears instead. Ctrl+1 to Ctrl+4 switch too.

### <a id="menus"></a>The menus

File (new, open, save, examples, export incl. Rocksmith), Edit (undo, note writing), View (full score, zoom, panels, workspaces), Song (key/time/tempo, transpose, band, split parts), Tools (describe, chords, recordings, PDF, mixer, sounds), Help (tours, topics, glossary).

**When to use it:** When you are looking for something and don’t see a button for it: every tool is in a menu.

**Try it:**
1. Open the File menu.
2. Point at “Try an example” to see the examples.
3. Hover over any item to read what it does.

### <a id="describe"></a>Describe a song

Type what you want in plain words ("12-bar blues in E with piano, bass and drums") and the app makes a plan: key, speed, players, song parts and chords. You can change the plan, then it builds the song with a band playing it.

**When to use it:** Use it to get a backing track to play or sing along with in seconds, or as a starting point for your own song. It is on the Home screen and in File > New.

**Try it:**
1. Open Describe a song from the Home screen and type a description.
2. Press Make a plan and check the key, speed, players and song parts; change anything you like.
3. Press Create song, then Play.

- The built-in reader understands styles, keys, speeds, instruments and parts like verse/chorus. With an ANTHROPIC_API_KEY set, Claude can read freer descriptions.
- Chords can be names (C, Am, G7) or numbers (I IV V), one per bar, separated by |.

## Arrange

See the music, choose instruments, add a band and hear it (the Arrange workspace).

### <a id="tracks"></a>Tracks (instruments)

The list on the left: one row per instrument part. Choose its instrument, show it as sheet music or tab, mute (M) or solo (S) it, set its volume.

**When to use it:** Whenever you want a part played by another instrument, to hide a part, or to hear one part alone.

**Try it:**
1. Pick “Electric Guitar (clean)” in a track’s instrument list.
2. Press Play: the same notes now sound like a guitar.
3. Press S on that track to hear only it; press S again to hear everything.

- Drag the edge of the panel to make it wider; « folds it away.
- Guitar and bass tracks also have a tuning and a capo.

### <a id="playbar"></a>The play bar

The bar under the menus: Play/Stop, where you are (bar and time), the tempo, Loop, Metronome, Count-in, practice Speed, Volume, zoom, page or scrolling view, and Full score.

**When to use it:** Every time you listen: to practise slowly, loop a hard bit, or make the music bigger.

**Try it:**
1. Drag over a few bars in the score to select them and turn on Loop.
2. Set Speed to 70 % and press Play.
3. Press ⛶ Full score (F11) to see only the music; Esc comes back.

### <a id="score-view"></a>Seeing the music: zoom, page view, full score

The score fills the middle of the window. Zoom with + / − or Ctrl + mouse wheel; “Fit” sizes it to the window. Page view wraps lines like printed music; Scrolling view is one long line.

**When to use it:** When the notes are too small or too big, or when you want to read along without distractions.

**Try it:**
1. Hold Ctrl and turn the mouse wheel over the score.
2. Choose “Scrolling view” in the play bar.
3. Press F11 for Full score; Esc to return.

- Side panels and the bottom panel fold away (« / ▾) and resize by dragging their edges. View > Reset the layout puts them back.

### <a id="transpose"></a>Transpose (move up or down)

Moves every note up or down by half steps (semitones). The song keeps its shape, only higher or lower.

**When to use it:** When a song is too high or too low to sing, or to match another instrument.

**Try it:**
1. In Arrange, press + next to “Transpose song” twice.
2. Press Play: the song is a whole step higher.
3. Ctrl+Z undoes it.

- Each track also has its own − / + to move just that part.

### <a id="split-parts"></a>Split into melody / bass / harmony

Makes three new tracks from one (e.g. a piano piece): the tune, the low notes and the chords in between. The original is kept, muted.

**When to use it:** When you want a band to play a piece written for one instrument, e.g. piano to rock band.

**Try it:**
1. Open the Bach Prelude example.
2. Click “Split into melody / bass / harmony” on the piano track (or in the Song menu).
3. Give each new track an instrument and press Play.

### <a id="tuning"></a>Tuning and capo

Sets how a guitar or bass track's strings are tuned (standard, Drop D, …) and where a capo sits. It changes which frets the tab shows for each note.

**When to use it:** Use it when a song is played in another tuning or with a capo, so the tab matches what you play. The tuning and capo lists are on each guitar/bass track in the Arrange workspace's track list; "…" opens the tuning window.

**Try it:**
1. Select a guitar or bass track and open its tuning list (or "…" for the tuning window).
2. Pick a preset, or set each string yourself in the tuning window.
3. Choose "Apply, keep the sound" (notes move to new frets) or "Apply, keep frets" (same fingering, new sound).

- Frets count from the nut, also with a capo, like Rocksmith does.

### <a id="band"></a>The band panel

A virtual band (drums, bass, rhythm and lead) that writes its own parts to follow your song's chords. It sits on the right in the Arrange workspace, with the chords and the song's sections.

**When to use it:** Use it when you have a melody or chords and want to hear them with a full band, for practice or to try out ideas.

**Try it:**
1. Press Find the chords (if the song has none yet), then pick a Style such as Rock or Jazz.
2. Tick the players you want and choose their instruments.
3. Press Generate, then Play; press Try another if you'd like different parts.

- Name parts of the song (verse, chorus…) by dragging over bars in the score and pressing Name bars: the band plays each part a little differently.
- More options has how busy each player is, the lead's octave and "Redo just this part" for one section or player.
- Everything can be undone (Edit > Undo).

### <a id="chord-picker"></a>Chord picker

A small box for setting the chord symbol (like C, Am or G7) at one spot in the song. It opens when you click a chord symbol in the score.

**When to use it:** Use it to fix a chord the app guessed wrong, or to write your own chords before generating a band.

**Try it:**
1. Click a chord symbol above the music.
2. Choose the main note, then the type (major sounds bright, minor sad, 7 bluesy).
3. Press Set to put it in; Explore… shows all the ways to play it.

- Leave "no slash" unless you want a different bass note (a slash chord like C/E).

## Write

Enter and change notes, chords, drums and lyrics (the Write workspace).

### <a id="edit-notes"></a>Write notes in the score

Type notes straight into the sheet music or the tab. A coloured box (the edit cursor) shows where the next note goes; the bar of buttons above the score sets note lengths, rests and guitar techniques.

**When to use it:** Use it to write a melody or riff from scratch, or to fix a few wrong notes in a song you opened. Turn it on with "✎ Write notes" in the play bar or Edit > Write notes, in the Write workspace.

**Try it:**
1. Turn on "✎ Write notes" and click a beat in the score: the edit cursor jumps there.
2. Pick a length (♩ = one beat, ♪ = half a beat), then type a letter A-G (in a tab: a fret number). Arrow keys move along the beats.
3. Press Esc when you are done. Ctrl+Z undoes any step.

- In a tab, ↑ and ↓ move between strings; typing two digits quickly gives frets 10-24.
- Shift + a letter adds the note to a chord instead of replacing it.
- Technique buttons (slide, bend, palm mute …) apply to the note on the cursor string. Hover over each one to see what it does and its key.

### <a id="piano-roll"></a>Piano roll

A grid where each note is a bar: higher rows are higher notes, longer bars are longer notes. It edits the same notes as the score, so the sheet music and tab redraw as you draw.

**When to use it:** Use it when you don't read music: draw notes with the mouse, hear them as you draw, and drag them around until it sounds right. It is in the Write workspace, bottom panel, "Piano roll" tab, and edits the track selected in the track list.

**Try it:**
1. Select a track, then open Write > Piano roll at the bottom of the window.
2. Drag on an empty spot to draw a note; drag a note to move it, or its right edge to make it longer.
3. Press play to hear it. Right-click (or Delete) removes a note; Ctrl+Z undoes.

- "Snap to grid" decides where notes land: 1/16 for fast notes, 1/4 for one note per beat, the "T" choices for triplets.
- The strip at the bottom is loudness (velocity): drag a line up to make that note louder.
- For a guitar or bass, rows the instrument cannot play are greyed out.

### <a id="drum-grid"></a>Drum grid

A step grid for drums: one row per drum (kick, snare, hi-hat …), one box per step of the bar. A filled box is a hit.

**When to use it:** Use it to build or change a drum beat without playing drums: click boxes on and off, reuse ready-made patterns, and copy a good bar across a whole section. Find it in the Write workspace, bottom panel, "Drum grid" tab.

**Try it:**
1. Open Write > Drum grid (if the song has no drums, press "Add a drum track").
2. Click boxes to add hits (Shift+click = accented, right-click = soft ghost note), or pick a Pattern and press Apply.
3. Press "Fill" to copy the bar to its whole section, then play to hear it.

- Drag over bars in the score first to apply a pattern or paste to all of them at once.
- More options has a finer 32-step grid, a triplet grid for shuffles, and extra drums (cowbell, tambourine …).
- Save a bar you like ("Save bar as…") to reuse it in other songs.

### <a id="chord-explorer"></a>Chords

Shows every practical way to play a chord: guitar or bass shapes as chord diagrams (for the selected track's tuning and capo) and piano voicings. Click one to hear it.

**When to use it:** Use it to learn how to play a chord, to find an easier or nicer-sounding shape, or to put a chord into the track. Open it from the Write workspace, bottom panel, "Chords" tab, or by clicking a chord name in the score.

**Try it:**
1. Type a chord name (e.g. Am, G7, D/F#) and press Enter, or pick the root and type from the lists.
2. Click diagrams to hear them; the one you clicked is chosen.
3. Press "Insert" to write it into the selected track at the edit cursor (and set the chord name above the score).

- In a diagram, dots are where fingers go, × = don't play that string, ○ = play it open.
- More options adds altered notes (b5, #9 …) and a different bass note (slash chords).
- "Set symbol" only writes the chord name: the band follows chord names when it plays.

### <a id="progressions"></a>Progressions (which chord next?)

Suggests chords that fit the song: the chords of its key, what usually comes next, more surprising choices, and well-known chord sequences (progressions) you can drop in.

**When to use it:** Use it when you are writing a song and wonder which chord could come next, or want a quick, proven chord sequence for a verse or chorus. Find it in the Write workspace, bottom panel, "Progressions" tab.

**Try it:**
1. Click a bar in the score (or drag over several bars) to choose where chords go.
2. Click chord names to hear them; press ⤓ next to one to put it at that bar.
3. Or pick a sequence under "Common progressions" and press "Insert over bars …"; then play to hear the band follow it.

- Hover over a suggestion to see why it works.
- "Key change…" moves the song into a new key from that bar.

### <a id="lyrics"></a>Lyrics

Puts words on the notes of a melody, one syllable per note, with several verses if you like. The words show under the score and can be sung by the built-in singer.

**When to use it:** Use it to add the words of a song, to line them up with the melody, or before letting the app sing the part. Find it in the Write workspace, bottom panel, "Lyrics" tab; it works on the selected melody track.

**Try it:**
1. Select the melody track and open Write > Lyrics.
2. Paste or type the words in the box and press "Put on notes": words are split into syllables automatically.
3. Fix any syllable by typing in its box under the note, or drag it to move it (and every later one).

- Write "Freu-de" to split a word yourself, "word_" to hold a syllable over the next note, "*" to skip a note.
- Pick the last entry in "Verse" to add another verse on the same notes.

### <a id="midi-keyboard"></a>MIDI keyboard and keyboard piano

Play notes on a plugged-in MIDI keyboard, or on the computer keyboard (the keyboard piano), to hear them, write them one at a time, or record them while the song plays.

**When to use it:** Use it when playing a part is quicker than drawing it, or to try ideas over the song. Find it in the Write workspace, bottom panel, "MIDI keyboard" tab.

**Try it:**
1. Choose your MIDI keyboard in the list, or turn on "⌨ Keyboard piano" (A S D F … are the white keys).
2. To write slowly without worrying about timing, tick "One note at a time (step entry)": each key you press is written at the edit cursor.
3. To record in time, press "● Record", play after the count-in clicks, then press Stop. Ctrl+Z undoes a take.

- More options: "Snap to grid" (quantise) tidies your timing; choose whether a take adds to or replaces the notes already there.
- While the keyboard piano is on, Z/X change octave and C/V change loudness (velocity).

### <a id="chord-chart"></a>Start from chords

Make a whole song by typing its chords bar by bar. The app builds the bars, sections and chord names, and a virtual band plays them in the style you pick.

**When to use it:** Use it when you know a song's chords (or want to try a chord sequence) and want to hear it played by a band straight away. Open it from File > New > Start from chords…; edit it later from the Song menu.

**Try it:**
1. Open File > New > Start from chords… and give the song a title, a speed (bpm) and a style.
2. Type the chords between | signs, e.g. | G | Em | C | D |, with section names like [Verse] on their own line.
3. Press "Create and generate the band", then play.

- % repeats the last bar; "C / / G" = C for three beats, G for one.
- {key: Em}, {3/4} and {tempo: 90} change the key, beats per bar and speed from the next bar on.

### <a id="song-changes"></a>Key, time signature and tempo

Change the song's key (its home note), its time signature (beats per bar, e.g. 4/4 or 3/4) or its tempo (speed) from any bar on, including gradual speed-ups and slow-downs.

**When to use it:** Use it when a song changes key or speed part-way, has a bar with a different number of beats, or should slow down at the end. Open it from the Song menu (Key, time and tempo…).

**Try it:**
1. Open Song > Key, time and tempo… and type the bar where the change starts.
2. Choose the new key, time signature or speed (tick "gradually to" for a smooth change).
3. Press the "Set …" button next to it, then Done. Ctrl+Z undoes it.

- A key change does not move any notes: use Transpose for that.
- Changing the time signature refits the bars; the band is regenerated if you have not edited it by hand.

### <a id="singing"></a>Singing

A computer voice sings a melody track with its lyrics. The result is a new audio track you can mix like any other. It uses the free Qixuan voice (DiffSinger); songs you publish must credit it and say the vocal is AI-made.

**When to use it:** Use it to hear how a melody and its words sound sung, or to make a guide vocal. It is under the lyrics in the Write workspace (Lyrics tab).

**Try it:**
1. Select the melody track and put lyrics on its notes in the Lyrics tab.
2. Press Sing (the voice downloads the first time) and wait for the new sung track.
3. Play the song; after changing notes or words press Sing again, or tick "re-sing after edits".

- Vibrato and Voice change the character; More options has speed of the vibrato, dynamics, breath and quality.
- Prefer another singing program? "Use another singing program" saves an OpenUtau or Synthesizer V file and brings the result back.

## Mix

Balance the instruments, add effects and other sounds (the Mix workspace).

### <a id="mixer"></a>Mixer

One column (strip) per track with its volume slider, left/right position (pan), mute and solo buttons, a level meter, Reverb and Echo amounts and its effects. The last columns are the shared Reverb, the shared Echo and Master (the whole song).

**When to use it:** Use it when one part is too loud or too quiet, when everything sounds bunched in the middle, or when you want to hear one part on its own. It lives in the Mix workspace, bottom panel tab Mixer.

**Try it:**
1. Open the Mix workspace and pick the Mixer tab at the bottom, then press Play.
2. Drag a track's volume slider down if it covers the others; double-click it to go back to normal.
3. Drag Pan a little left on one guitar and right on another, and add some Reverb to the vocals or piano.

- S (solo) lets you hear just that part; M (mute) silences it.
- If the red light on a meter comes on, that part got too loud and distorted: turn it down and click the meter to reset the light.
- Ready-made sound applies a set of effects made for guitar, bass, drums, keys or voice in one go.

### <a id="effects"></a>Effects

Effects change how a track sounds: an amp or distortion for guitar, an EQ to make it brighter or warmer, a compressor to even it out, reverb for space, echo for repeats. Each track has its own list (chain) of effects, worked through from top to bottom.

**When to use it:** Use them to make a part sound more like a real recording, to give it character, or to help it stand out from the others. They are in each strip of the Mixer (Mix workspace).

**Try it:**
1. In the Mixer, open "+ Effect…" under a guitar track and pick Guitar amp.
2. Click the effect's name to show its knobs and turn Gain up for a rougher sound.
3. Press the power button (Off / bypass) to compare with and without the effect, and use the arrows to change the order.

- Hover over any knob to see what it does.
- A Limiter as the last effect on Master stops the whole song from distorting.
- Under "Save as preset" you can keep a set of effects to reuse on other tracks.

### <a id="changes-over-time"></a>Changes over time

Lines that move a setting by themselves while the song plays (also called automation): volume, left/right position, or any effect knob. Each point on the line sits on a bar, so it follows the music.

**When to use it:** Use it for a fade-out at the end, a guitar that gets louder in the chorus, or more echo on the last line. It is in the Mix workspace, bottom panel tab Changes over time, for the selected track.

**Try it:**
1. Select a track, open the Changes over time tab and choose Volume in "+ Setting to change…".
2. Click on the line to add points: one high near the end of the song, one at the bottom on the last bar.
3. Press Play: the volume now fades out by itself. Drag a point to move it, right-click it to delete it.

- A setting that has a line is locked in the Mixer (the line is in charge).
- Changes over time are also used when you export.

### <a id="audio-tracks"></a>Audio tracks

Tracks that hold real sound (audio files or your own recordings) instead of notes. Each piece of sound is a clip you can move, shorten, split, fade and make louder or quieter.

**When to use it:** Use them to add your own singing or playing on top of the band, or to bring in a drum loop or a recorded part. They are in the Mix workspace, bottom panel tab Audio tracks.

**Try it:**
1. Press "+ Audio track", then "Import audio…" to add a file, or choose your microphone under Input.
2. Turn on Count-in and Metronome, then press Record and play along; press Stop when done.
3. Drag the clip to move it, drag an edge to shorten it, and set Fade in / Fade out to smooth the start and end.

- Use headphones when "Hear input" is on, so the speakers don't feed back into the microphone.
- If recordings come out a little late, open More options and press "Measure it" (needs a cable from the output to the input) or type a delay correction.

### <a id="sound-library"></a>Sounds (sound library)

Lets a track play with a different instrument sound from a sound set you downloaded (a SoundFont .sf2/.sf3 or an SFZ instrument), for example a real recorded grand piano. Nothing is bundled; the panel lists free ones to download.

**When to use it:** Use it when the built-in sound of an instrument isn't good enough for you. It is in the Mix workspace, bottom panel tab Sounds.

**Try it:**
1. Copy a link from "Free libraries to download", download it in your browser and unzip it.
2. Press "Add sound set (SoundFont / SFZ)…" and choose the downloaded file.
3. Select a track, pick a sound in "Sound of the track" and press Preview.

- The choice is saved with the song; if the file goes missing the track falls back to the normal sound.
- Drum tracks always use the song's main sound set.

## Recordings

Turn a recording or printed sheet music into a song (the Recordings workspace).

### <a id="recording-to-sheet-music"></a>Recording to sheet music

A step-by-step guide that turns an audio recording (MP3, WAV…) into a normal song with notes and tabs. It finds the beat, splits the instruments apart and writes out what they play.

**When to use it:** Use it when you want to learn, play or rearrange a song you only have as a recording. The result is an ordinary song: edit it, play it with a band, print it.

**Try it:**
1. Open the Recordings tab at the top and press Load… to pick your audio file.
2. Press Run on each step in turn: find the beat, split into instruments, turn audio into notes (tick bass, guitar or vocals).
3. Open the comparison (step 5) to fix wrong notes by ear, then export it as sheet music, audio or MIDI if you like.

- The recording itself is never changed; every result is a new track you can undo or delete.
- Splitting into instruments takes a few minutes but makes the notes much cleaner.
- Bonus: step 6 can also make a Rocksmith 2014 custom song (also at File > Export > Rocksmith 2014…).
- Grid and timing choices for the notes are under More options in step 4.

### <a id="recording-tools"></a>Recording tools

The same listening tools as the guided steps, one at a time, for any audio track in the song: find the beat, split into instruments, turn audio into notes, turn drums into a drum track, turn singing into melody and lyrics.

**When to use it:** Use them when you only need one thing, for example notes for one guitar part, or when you added an audio track by hand in the Mix workspace.

**Try it:**
1. In the Recordings tab, choose an audio track in the "Split into instruments" row and press Split.
2. Pick one of the new instrument tracks under "Turn audio into notes", say what instrument it is, and press Turn into notes.
3. Press Compare with the recording to check the new notes against the audio.

- Turn drums into a drum track and Turn singing into melody + lyrics work best on the split drums or vocals.
- The engine and its downloaded models are listed under "Analysis engine and models" (Check engine tests it).
- Models download once, the first time a tool needs them; jobs run in the background and can be cancelled.

### <a id="sheet-music-from-pdf"></a>Sheet music from a PDF or photo

Reads printed sheet music from a PDF or a photo and opens it as a song you can hear and edit. It uses the free program Audiveris, which the app installs once into its own folder.

**When to use it:** Use it when you have music on paper or as a PDF and want to hear it, change instruments or add a band.

**Try it:**
1. Open the Recordings tab and press "Read sheet music from a PDF or photo…".
2. Pick the file and wait while it is read (a page takes a little while).
3. Click the "Unsure" bar buttons to jump to the bars it was unsure about, listen and fix them.

- Clear, straight scans give the best results; photos should be sharp and well lit.

### <a id="compare-with-recording"></a>Compare with the recording

Shows the recording as a waveform (or a colour picture of the pitches) right above the music, bar by bar, with the beat lines drawn on it. You can switch between hearing the original, one instrument, the written notes, or both.

**When to use it:** Use it after turning audio into notes, to find and fix wrong notes, or when the bars don't line up with the music.

**Try it:**
1. Press Compare with the recording in the Recordings tab (or Open review in step 5).
2. Choose Instrument + notes and play: notes that don't match the audio stand out.
3. Fix notes in the score; drag a beat line to move it, or double-click one to make it beat 1 of a bar.

- Slow down with Speed: the pitch stays the same.
- Select bars and tick Loop to repeat a tricky spot.
- Tap and Re-bar fix the tempo and the bar lengths of the selected bars.

## Files

Saving, sounds and exporting.

### <a id="export"></a>Export

Saves your song as files other people and programs can use: an MP3 or WAV of the whole song, one audio file per instrument, sheet music as a PDF, and MIDI, MusicXML or Guitar Pro files.

**When to use it:** Use it when the song is ready to share, to print the parts, or to carry on in another program. It is in File > Export….

**Try it:**
1. Choose File > Export… and check the folder and file name.
2. Tick MP3 under Whole song (mixdown), and Score PDF if you want printed music.
3. Press Export, then Show in folder to find your files.

- More options holds the MP3 quality, the loudness setting (LUFS) and extra time at the end for reverb to ring out; the defaults suit most songs.
- Each instrument separately (stems) is handy for practising with one part missing.
- Rocksmith 2014 export is its own item: File > Export > Rocksmith 2014….

### <a id="sound-set"></a>Sound set (SoundFont)

The sound set (a SoundFont file) holds the recorded sounds every instrument plays with. The app comes with a good general one built in.

**When to use it:** Load another one when you want nicer or different sounds, for example a better piano; go back to the built-in one if something sounds wrong.

**Try it:**
1. Open Settings and press "Load a sound set… (.sf2 / .sf3)".
2. Pick a SoundFont you downloaded (for example MuseScore General or FluidR3).
3. Play the song: all instruments now use the new sounds, and the choice is remembered.

- Single instruments from other files can be set per track in the Mix workspace (sound library).

## Bonus

Extras that are not part of the main path.

### <a id="rocksmith-export"></a>Export to Rocksmith 2014 (bonus)

Turns the guitar and bass parts of a song into a Rocksmith 2014 custom song (.psarc) you can play in the game, with all its difficulty levels made automatically.

**When to use it:** Use it if you own Rocksmith 2014 and want to play a song you made or imported in the game. Open it from File > Export > Rocksmith 2014….

**Try it:**
1. Open File > Export > Rocksmith 2014… and tick the guitar/bass parts to include (Lead, Rhythm or Bass).
2. Check the title and artist, and choose the audio: the full mix, the mix without your parts, or a recording.
3. Press Export. Tick "Copy into" to put the song straight into Rocksmith's dlc folder.

- Converting the audio needs Wwise (2019-2023) installed; without it the export stops early and keeps a DLC Builder project you can finish by hand.
- Only 6-string guitar and 4-string bass parts can be exported.

## <a id="glossary"></a>Glossary

- **Bar (measure)**: A small block of beats, e.g. 4 beats. Music is counted in bars; the vertical lines in the score separate them.
- **Beat**: The steady pulse you tap your foot to.
- **Tempo (bpm)**: How fast the beats go, in beats per minute. 60 = one per second.
- **Time signature**: How many beats a bar has (the top number, e.g. 3/4 = three beats).
- **Key**: The home note and scale a song uses (e.g. G major). It decides which sharps or flats are written.
- **Track**: One instrument’s part in the song (guitar, bass, drums…).
- **Tab (tablature)**: Guitar/bass notation: lines are strings, numbers are frets. No music reading needed.
- **Sheet music (notation)**: Notes written on five lines (the staff); higher on the staff = higher note.
- **Chord**: Several notes played together.
- **Chord symbol**: The chord name written above the music (C, Am, G7); the band plays from these.
- **Section**: A named part of a song: intro, verse, chorus, bridge…
- **Transpose**: Move all notes up or down by the same amount.
- **Semitone (half step)**: The smallest step between notes: one fret on a guitar, one key (black or white) on a piano.
- **Capo**: A clamp across the guitar neck that raises every string; frets are still counted from the nut.
- **Tuning**: The notes the open strings of a guitar or bass are tuned to (standard E A D G B E, drop D…).
- **Stem**: One instrument separated out of a recording (drums, bass, vocals…). “Split into instruments” makes stems.
- **Transcription**: Writing down the notes heard in audio. “Turn audio into notes” does it automatically.
- **Mixer / fader**: Where you set each instrument’s volume; the fader is the slider.
- **Pan**: Where a sound sits between the left and right speaker.
- **Mute / Solo (M / S)**: Mute silences a track; Solo plays only that track (and other soloed ones).
- **Effect**: Something that changes a sound: reverb (room), echo (delay), EQ (bass/treble), distortion…
- **Automation (changes over time)**: A setting that changes during the song by itself, e.g. a fade-out.
- **Metronome / count-in**: A click on every beat; the count-in is one bar of clicks before the music starts.
- **Quantise (snap to grid)**: Moving notes onto the nearest beat (or part of a beat) so they line up.
- **Velocity (loudness)**: How hard a note is played: louder or softer.
- **MIDI**: Notes as data, not sound. MIDI files and MIDI keyboards send notes the app can play with any instrument.
- **SoundFont (sound set)**: A file of recorded instrument sounds the app plays notes with (.sf2/.sf3).
- **Mixdown**: The whole song rendered into one audio file (WAV/MP3).
- **Rocksmith 2014**: A guitar game. As a bonus, musicGenie can export guitar/bass parts as custom songs for it.
