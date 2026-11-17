// Help pages for the Recordings workspace, the band panel, the chord picker and the sound set (Round 8).
import type { HelpTopic } from './types';

export const RECORDING_TOPICS: HelpTopic[] = [
  {
    id: 'recording-to-sheet-music',
    title: 'Recording to sheet music',
    area: 'Recordings',
    what: 'A step-by-step guide that turns an audio recording (MP3, WAV…) into a normal song with notes and tabs. It finds the beat, splits the instruments apart and writes out what they play.',
    when: 'Use it when you want to learn, play or rearrange a song you only have as a recording. The result is an ordinary song: edit it, play it with a band, print it.',
    steps: [
      'Open the Recordings tab at the top and press Load… to pick your audio file.',
      'Press Run on each step in turn: find the beat, split into instruments, turn audio into notes (tick bass, guitar or vocals).',
      'Open the comparison (step 5) to fix wrong notes by ear, then export it as sheet music, audio or MIDI if you like.',
    ],
    tips: [
      'The recording itself is never changed; every result is a new track you can undo or delete.',
      'Splitting into instruments takes a few minutes but makes the notes much cleaner.',
      'Bonus: step 6 can also make a Rocksmith 2014 custom song (also at File > Export > Rocksmith 2014…).',
      'Grid and timing choices for the notes are under More options in step 4.',
    ],
  },
  {
    id: 'recording-tools',
    title: 'Recording tools',
    area: 'Recordings',
    what: 'The same listening tools as the guided steps, one at a time, for any audio track in the song: find the beat, split into instruments, turn audio into notes, turn drums into a drum track, turn singing into melody and lyrics.',
    when: 'Use them when you only need one thing, for example notes for one guitar part, or when you added an audio track by hand in the Mix workspace.',
    steps: [
      'In the Recordings tab, choose an audio track in the "Split into instruments" row and press Split.',
      'Pick one of the new instrument tracks under "Turn audio into notes", say what instrument it is, and press Turn into notes.',
      'Press Compare with the recording to check the new notes against the audio.',
    ],
    tips: [
      'Turn drums into a drum track and Turn singing into melody + lyrics work best on the split drums or vocals.',
      'The engine and its downloaded models are listed under "Analysis engine and models" (Check engine tests it).',
      'Models download once, the first time a tool needs them; jobs run in the background and can be cancelled.',
    ],
  },
  {
    id: 'sheet-music-from-pdf',
    title: 'Sheet music from a PDF or photo',
    area: 'Recordings',
    what: 'Reads printed sheet music from a PDF or a photo and opens it as a song you can hear and edit. It uses the free program Audiveris, which the app installs once into its own folder.',
    when: 'Use it when you have music on paper or as a PDF and want to hear it, change instruments or add a band.',
    steps: [
      'Open the Recordings tab and press "Read sheet music from a PDF or photo…".',
      'Pick the file and wait while it is read (a page takes a little while).',
      'Click the "Unsure" bar buttons to jump to the bars it was unsure about, listen and fix them.',
    ],
    tips: ['Clear, straight scans give the best results; photos should be sharp and well lit.'],
  },
  {
    id: 'compare-with-recording',
    title: 'Compare with the recording',
    area: 'Recordings',
    what: 'Shows the recording as a waveform (or a colour picture of the pitches) right above the music, bar by bar, with the beat lines drawn on it. You can switch between hearing the original, one instrument, the written notes, or both.',
    when: 'Use it after turning audio into notes, to find and fix wrong notes, or when the bars don\'t line up with the music.',
    steps: [
      'Press Compare with the recording in the Recordings tab (or Open review in step 5).',
      'Choose Instrument + notes and play: notes that don\'t match the audio stand out.',
      'Fix notes in the score; drag a beat line to move it, or double-click one to make it beat 1 of a bar.',
    ],
    tips: [
      'Slow down with Speed: the pitch stays the same.',
      'Select bars and tick Loop to repeat a tricky spot.',
      'Tap and Re-bar fix the tempo and the bar lengths of the selected bars.',
    ],
  },
  {
    id: 'band',
    title: 'The band panel',
    area: 'Arrange',
    what: 'A virtual band (drums, bass, rhythm and lead) that writes its own parts to follow your song\'s chords. It sits on the right in the Arrange workspace, with the chords and the song\'s sections.',
    when: 'Use it when you have a melody or chords and want to hear them with a full band, for practice or to try out ideas.',
    steps: [
      'Press Find the chords (if the song has none yet), then pick a Style such as Rock or Jazz.',
      'Tick the players you want and choose their instruments.',
      'Press Generate, then Play; press Try another if you\'d like different parts.',
    ],
    tips: [
      'Name parts of the song (verse, chorus…) by dragging over bars in the score and pressing Name bars: the band plays each part a little differently.',
      'More options has how busy each player is, the lead\'s octave and "Redo just this part" for one section or player.',
      'Everything can be undone (Edit > Undo).',
    ],
  },
  {
    id: 'chord-picker',
    title: 'Chord picker',
    area: 'Arrange',
    what: 'A small box for setting the chord symbol (like C, Am or G7) at one spot in the song. It opens when you click a chord symbol in the score.',
    when: 'Use it to fix a chord the app guessed wrong, or to write your own chords before generating a band.',
    steps: [
      'Click a chord symbol above the music.',
      'Choose the main note, then the type (major sounds bright, minor sad, 7 bluesy).',
      'Press Set to put it in; Explore… shows all the ways to play it.',
    ],
    tips: ['Leave "no slash" unless you want a different bass note (a slash chord like C/E).'],
  },
  {
    id: 'sound-set',
    title: 'Sound set (SoundFont)',
    area: 'Files',
    what: 'The sound set (a SoundFont file) holds the recorded sounds every instrument plays with. The app comes with a good general one built in.',
    when: 'Load another one when you want nicer or different sounds, for example a better piano; go back to the built-in one if something sounds wrong.',
    steps: [
      'Open Settings and press "Load a sound set… (.sf2 / .sf3)".',
      'Pick a SoundFont you downloaded (for example MuseScore General or FluidR3).',
      'Play the song: all instruments now use the new sounds, and the choice is remembered.',
    ],
    tips: ['Single instruments from other files can be set per track in the Mix workspace (sound library).'],
  },
];
