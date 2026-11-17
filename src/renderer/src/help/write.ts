// Help pages for the Write workspace panels (plus Tuning and Rocksmith export). Pure data.
import type { HelpTopic } from './types';

export const WRITE_TOPICS: HelpTopic[] = [
  {
    id: 'edit-notes',
    title: 'Write notes in the score',
    area: 'Write',
    what: 'Type notes straight into the sheet music or the tab. A coloured box (the edit cursor) shows where the next note goes; the bar of buttons above the score sets note lengths, rests and guitar techniques.',
    when: 'Use it to write a melody or riff from scratch, or to fix a few wrong notes in a song you opened. Turn it on with "✎ Write notes" in the play bar or Edit > Write notes, in the Write workspace.',
    steps: [
      'Turn on "✎ Write notes" and click a beat in the score: the edit cursor jumps there.',
      'Pick a length (♩ = one beat, ♪ = half a beat), then type a letter A-G (in a tab: a fret number). Arrow keys move along the beats.',
      'Press Esc when you are done. Ctrl+Z undoes any step.',
    ],
    tips: [
      'In a tab, ↑ and ↓ move between strings; typing two digits quickly gives frets 10-24.',
      'Shift + a letter adds the note to a chord instead of replacing it.',
      'Technique buttons (slide, bend, palm mute …) apply to the note on the cursor string. Hover over each one to see what it does and its key.',
    ],
  },
  {
    id: 'piano-roll',
    title: 'Piano roll',
    area: 'Write',
    what: 'A grid where each note is a bar: higher rows are higher notes, longer bars are longer notes. It edits the same notes as the score, so the sheet music and tab redraw as you draw.',
    when: 'Use it when you don\'t read music: draw notes with the mouse, hear them as you draw, and drag them around until it sounds right. It is in the Write workspace, bottom panel, "Piano roll" tab, and edits the track selected in the track list.',
    steps: [
      'Select a track, then open Write > Piano roll at the bottom of the window.',
      'Drag on an empty spot to draw a note; drag a note to move it, or its right edge to make it longer.',
      'Press play to hear it. Right-click (or Delete) removes a note; Ctrl+Z undoes.',
    ],
    tips: [
      '"Snap to grid" decides where notes land: 1/16 for fast notes, 1/4 for one note per beat, the "T" choices for triplets.',
      'The strip at the bottom is loudness (velocity): drag a line up to make that note louder.',
      'For a guitar or bass, rows the instrument cannot play are greyed out.',
    ],
  },
  {
    id: 'drum-grid',
    title: 'Drum grid',
    area: 'Write',
    what: 'A step grid for drums: one row per drum (kick, snare, hi-hat …), one box per step of the bar. A filled box is a hit.',
    when: 'Use it to build or change a drum beat without playing drums: click boxes on and off, reuse ready-made patterns, and copy a good bar across a whole section. Find it in the Write workspace, bottom panel, "Drum grid" tab.',
    steps: [
      'Open Write > Drum grid (if the song has no drums, press "Add a drum track").',
      'Click boxes to add hits (Shift+click = accented, right-click = soft ghost note), or pick a Pattern and press Apply.',
      'Press "Fill" to copy the bar to its whole section, then play to hear it.',
    ],
    tips: [
      'Drag over bars in the score first to apply a pattern or paste to all of them at once.',
      'More options has a finer 32-step grid, a triplet grid for shuffles, and extra drums (cowbell, tambourine …).',
      'Save a bar you like ("Save bar as…") to reuse it in other songs.',
    ],
  },
  {
    id: 'chord-explorer',
    title: 'Chords',
    area: 'Write',
    what: 'Shows every practical way to play a chord: guitar or bass shapes as chord diagrams (for the selected track\'s tuning and capo) and piano voicings. Click one to hear it.',
    when: 'Use it to learn how to play a chord, to find an easier or nicer-sounding shape, or to put a chord into the track. Open it from the Write workspace, bottom panel, "Chords" tab, or by clicking a chord name in the score.',
    steps: [
      'Type a chord name (e.g. Am, G7, D/F#) and press Enter, or pick the root and type from the lists.',
      'Click diagrams to hear them; the one you clicked is chosen.',
      'Press "Insert" to write it into the selected track at the edit cursor (and set the chord name above the score).',
    ],
    tips: [
      'In a diagram, dots are where fingers go, × = don\'t play that string, ○ = play it open.',
      'More options adds altered notes (b5, #9 …) and a different bass note (slash chords).',
      '"Set symbol" only writes the chord name: the band follows chord names when it plays.',
    ],
  },
  {
    id: 'progressions',
    title: 'Progressions (which chord next?)',
    area: 'Write',
    what: 'Suggests chords that fit the song: the chords of its key, what usually comes next, more surprising choices, and well-known chord sequences (progressions) you can drop in.',
    when: 'Use it when you are writing a song and wonder which chord could come next, or want a quick, proven chord sequence for a verse or chorus. Find it in the Write workspace, bottom panel, "Progressions" tab.',
    steps: [
      'Click a bar in the score (or drag over several bars) to choose where chords go.',
      'Click chord names to hear them; press ⤓ next to one to put it at that bar.',
      'Or pick a sequence under "Common progressions" and press "Insert over bars …"; then play to hear the band follow it.',
    ],
    tips: [
      'Hover over a suggestion to see why it works.',
      '"Key change…" moves the song into a new key from that bar.',
    ],
  },
  {
    id: 'lyrics',
    title: 'Lyrics',
    area: 'Write',
    what: 'Puts words on the notes of a melody, one syllable per note, with several verses if you like. The words show under the score and can be sung by the built-in singer.',
    when: 'Use it to add the words of a song, to line them up with the melody, or before letting the app sing the part. Find it in the Write workspace, bottom panel, "Lyrics" tab; it works on the selected melody track.',
    steps: [
      'Select the melody track and open Write > Lyrics.',
      'Paste or type the words in the box and press "Put on notes": words are split into syllables automatically.',
      'Fix any syllable by typing in its box under the note, or drag it to move it (and every later one).',
    ],
    tips: [
      'Write "Freu-de" to split a word yourself, "word_" to hold a syllable over the next note, "*" to skip a note.',
      'Pick the last entry in "Verse" to add another verse on the same notes.',
    ],
  },
  {
    id: 'midi-keyboard',
    title: 'MIDI keyboard and keyboard piano',
    area: 'Write',
    what: 'Play notes on a plugged-in MIDI keyboard, or on the computer keyboard (the keyboard piano), to hear them, write them one at a time, or record them while the song plays.',
    when: 'Use it when playing a part is quicker than drawing it, or to try ideas over the song. Find it in the Write workspace, bottom panel, "MIDI keyboard" tab.',
    steps: [
      'Choose your MIDI keyboard in the list, or turn on "⌨ Keyboard piano" (A S D F … are the white keys).',
      'To write slowly without worrying about timing, tick "One note at a time (step entry)": each key you press is written at the edit cursor.',
      'To record in time, press "● Record", play after the count-in clicks, then press Stop. Ctrl+Z undoes a take.',
    ],
    tips: [
      'More options: "Snap to grid" (quantise) tidies your timing; choose whether a take adds to or replaces the notes already there.',
      'While the keyboard piano is on, Z/X change octave and C/V change loudness (velocity).',
    ],
  },
  {
    id: 'chord-chart',
    title: 'Start from chords',
    area: 'Write',
    what: 'Make a whole song by typing its chords bar by bar. The app builds the bars, sections and chord names, and a virtual band plays them in the style you pick.',
    when: 'Use it when you know a song\'s chords (or want to try a chord sequence) and want to hear it played by a band straight away. Open it from File > New > Start from chords…; edit it later from the Song menu.',
    steps: [
      'Open File > New > Start from chords… and give the song a title, a speed (bpm) and a style.',
      'Type the chords between | signs, e.g. | G | Em | C | D |, with section names like [Verse] on their own line.',
      'Press "Create and generate the band", then play.',
    ],
    tips: [
      '% repeats the last bar; "C / / G" = C for three beats, G for one.',
      '{key: Em}, {3/4} and {tempo: 90} change the key, beats per bar and speed from the next bar on.',
    ],
  },
  {
    id: 'song-changes',
    title: 'Key, time signature and tempo',
    area: 'Write',
    what: 'Change the song\'s key (its home note), its time signature (beats per bar, e.g. 4/4 or 3/4) or its tempo (speed) from any bar on, including gradual speed-ups and slow-downs.',
    when: 'Use it when a song changes key or speed part-way, has a bar with a different number of beats, or should slow down at the end. Open it from the Song menu (Key, time and tempo…).',
    steps: [
      'Open Song > Key, time and tempo… and type the bar where the change starts.',
      'Choose the new key, time signature or speed (tick "gradually to" for a smooth change).',
      'Press the "Set …" button next to it, then Done. Ctrl+Z undoes it.',
    ],
    tips: [
      'A key change does not move any notes: use Transpose for that.',
      'Changing the time signature refits the bars; the band is regenerated if you have not edited it by hand.',
    ],
  },
  {
    id: 'tuning',
    title: 'Tuning and capo',
    area: 'Arrange',
    what: 'Sets how a guitar or bass track\'s strings are tuned (standard, Drop D, …) and where a capo sits. It changes which frets the tab shows for each note.',
    when: 'Use it when a song is played in another tuning or with a capo, so the tab matches what you play. The tuning and capo lists are on each guitar/bass track in the Arrange workspace\'s track list; "…" opens the tuning window.',
    steps: [
      'Select a guitar or bass track and open its tuning list (or "…" for the tuning window).',
      'Pick a preset, or set each string yourself in the tuning window.',
      'Choose "Apply, keep the sound" (notes move to new frets) or "Apply, keep frets" (same fingering, new sound).',
    ],
    tips: [
      'Frets count from the nut, also with a capo, like Rocksmith does.',
    ],
  },
  {
    id: 'rocksmith-export',
    title: 'Export to Rocksmith 2014 (bonus)',
    area: 'Bonus',
    what: 'Turns the guitar and bass parts of a song into a Rocksmith 2014 custom song (.psarc) you can play in the game, with all its difficulty levels made automatically.',
    when: 'Use it if you own Rocksmith 2014 and want to play a song you made or imported in the game. Open it from File > Export > Rocksmith 2014….',
    steps: [
      'Open File > Export > Rocksmith 2014… and tick the guitar/bass parts to include (Lead, Rhythm or Bass).',
      'Check the title and artist, and choose the audio: the full mix, the mix without your parts, or a recording.',
      'Press Export. Tick "Copy into" to put the song straight into Rocksmith\'s dlc folder.',
    ],
    tips: [
      'Converting the audio needs Wwise (2019-2023) installed; without it the export stops early and keeps a DLC Builder project you can finish by hand.',
      'Only 6-string guitar and 4-string bass parts can be exported.',
    ],
  },
];
