// Help pages for the Mix workspace, export, the sound library, "Describe a song" and singing (Round 8).
import type { HelpTopic } from './types';

export const MIX_TOPICS: HelpTopic[] = [
  {
    id: 'mixer',
    title: 'Mixer',
    area: 'Mix',
    what: 'One column (strip) per track with its volume slider, left/right position (pan), mute and solo buttons, a level meter, Reverb and Echo amounts and its effects. The last columns are the shared Reverb, the shared Echo and Master (the whole song).',
    when: 'Use it when one part is too loud or too quiet, when everything sounds bunched in the middle, or when you want to hear one part on its own. It lives in the Mix workspace, bottom panel tab Mixer.',
    steps: [
      'Open the Mix workspace and pick the Mixer tab at the bottom, then press Play.',
      'Drag a track\'s volume slider down if it covers the others; double-click it to go back to normal.',
      'Drag Pan a little left on one guitar and right on another, and add some Reverb to the vocals or piano.',
    ],
    tips: [
      'S (solo) lets you hear just that part; M (mute) silences it.',
      'If the red light on a meter comes on, that part got too loud and distorted: turn it down and click the meter to reset the light.',
      'Ready-made sound applies a set of effects made for guitar, bass, drums, keys or voice in one go.',
    ],
  },
  {
    id: 'effects',
    title: 'Effects',
    area: 'Mix',
    what: 'Effects change how a track sounds: an amp or distortion for guitar, an EQ to make it brighter or warmer, a compressor to even it out, reverb for space, echo for repeats. Each track has its own list (chain) of effects, worked through from top to bottom.',
    when: 'Use them to make a part sound more like a real recording, to give it character, or to help it stand out from the others. They are in each strip of the Mixer (Mix workspace).',
    steps: [
      'In the Mixer, open "+ Effect…" under a guitar track and pick Guitar amp.',
      'Click the effect\'s name to show its knobs and turn Gain up for a rougher sound.',
      'Press the power button (Off / bypass) to compare with and without the effect, and use the arrows to change the order.',
    ],
    tips: [
      'Hover over any knob to see what it does.',
      'A Limiter as the last effect on Master stops the whole song from distorting.',
      'Under "Save as preset" you can keep a set of effects to reuse on other tracks.',
    ],
  },
  {
    id: 'changes-over-time',
    title: 'Changes over time',
    area: 'Mix',
    what: 'Lines that move a setting by themselves while the song plays (also called automation): volume, left/right position, or any effect knob. Each point on the line sits on a bar, so it follows the music.',
    when: 'Use it for a fade-out at the end, a guitar that gets louder in the chorus, or more echo on the last line. It is in the Mix workspace, bottom panel tab Changes over time, for the selected track.',
    steps: [
      'Select a track, open the Changes over time tab and choose Volume in "+ Setting to change…".',
      'Click on the line to add points: one high near the end of the song, one at the bottom on the last bar.',
      'Press Play: the volume now fades out by itself. Drag a point to move it, right-click it to delete it.',
    ],
    tips: [
      'A setting that has a line is locked in the Mixer (the line is in charge).',
      'Changes over time are also used when you export.',
    ],
  },
  {
    id: 'audio-tracks',
    title: 'Audio tracks',
    area: 'Mix',
    what: 'Tracks that hold real sound (audio files or your own recordings) instead of notes. Each piece of sound is a clip you can move, shorten, split, fade and make louder or quieter.',
    when: 'Use them to add your own singing or playing on top of the band, or to bring in a drum loop or a recorded part. They are in the Mix workspace, bottom panel tab Audio tracks.',
    steps: [
      'Press "+ Audio track", then "Import audio…" to add a file, or choose your microphone under Input.',
      'Turn on Count-in and Metronome, then press Record and play along; press Stop when done.',
      'Drag the clip to move it, drag an edge to shorten it, and set Fade in / Fade out to smooth the start and end.',
    ],
    tips: [
      'Use headphones when "Hear input" is on, so the speakers don\'t feed back into the microphone.',
      'If recordings come out a little late, open More options and press "Measure it" (needs a cable from the output to the input) or type a delay correction.',
    ],
  },
  {
    id: 'export',
    title: 'Export',
    area: 'Files',
    what: 'Saves your song as files other people and programs can use: an MP3 or WAV of the whole song, one audio file per instrument, sheet music as a PDF, and MIDI, MusicXML or Guitar Pro files.',
    when: 'Use it when the song is ready to share, to print the parts, or to carry on in another program. It is in File > Export….',
    steps: [
      'Choose File > Export… and check the folder and file name.',
      'Tick MP3 under Whole song (mixdown), and Score PDF if you want printed music.',
      'Press Export, then Show in folder to find your files.',
    ],
    tips: [
      'More options holds the MP3 quality, the loudness setting (LUFS) and extra time at the end for reverb to ring out; the defaults suit most songs.',
      'Each instrument separately (stems) is handy for practising with one part missing.',
      'Rocksmith 2014 export is its own item: File > Export > Rocksmith 2014….',
    ],
  },
  {
    id: 'sound-library',
    title: 'Sounds (sound library)',
    area: 'Mix',
    what: 'Lets a track play with a different instrument sound from a sound set you downloaded (a SoundFont .sf2/.sf3 or an SFZ instrument), for example a real recorded grand piano. Nothing is bundled; the panel lists free ones to download.',
    when: 'Use it when the built-in sound of an instrument isn\'t good enough for you. It is in the Mix workspace, bottom panel tab Sounds.',
    steps: [
      'Copy a link from "Free libraries to download", download it in your browser and unzip it.',
      'Press "Add sound set (SoundFont / SFZ)…" and choose the downloaded file.',
      'Select a track, pick a sound in "Sound of the track" and press Preview.',
    ],
    tips: [
      'The choice is saved with the song; if the file goes missing the track falls back to the normal sound.',
      'Drum tracks always use the song\'s main sound set.',
    ],
  },
  {
    id: 'describe',
    title: 'Describe a song',
    area: 'Start',
    what: 'Type what you want in plain words ("12-bar blues in E with piano, bass and drums") and the app makes a plan: key, speed, players, song parts and chords. You can change the plan, then it builds the song with a band playing it.',
    when: 'Use it to get a backing track to play or sing along with in seconds, or as a starting point for your own song. It is on the Home screen and in File > New.',
    steps: [
      'Open Describe a song from the Home screen and type a description.',
      'Press Make a plan and check the key, speed, players and song parts; change anything you like.',
      'Press Create song, then Play.',
    ],
    tips: [
      'The built-in reader understands styles, keys, speeds, instruments and parts like verse/chorus. With an ANTHROPIC_API_KEY set, Claude can read freer descriptions.',
      'Chords can be names (C, Am, G7) or numbers (I IV V), one per bar, separated by |.',
    ],
  },
  {
    id: 'singing',
    title: 'Singing',
    area: 'Write',
    what: 'A computer voice sings a melody track with its lyrics. The result is a new audio track you can mix like any other. It uses the free Qixuan voice (DiffSinger); songs you publish must credit it and say the vocal is AI-made.',
    when: 'Use it to hear how a melody and its words sound sung, or to make a guide vocal. It is under the lyrics in the Write workspace (Lyrics tab).',
    steps: [
      'Select the melody track and put lyrics on its notes in the Lyrics tab.',
      'Press Sing (the voice downloads the first time) and wait for the new sung track.',
      'Play the song; after changing notes or words press Sing again, or tick "re-sing after edits".',
    ],
    tips: [
      'Vibrato and Voice change the character; More options has speed of the vibrato, dynamics, breath and quality.',
      'Prefer another singing program? "Use another singing program" saves an OpenUtau or Synthesizer V file and brings the result back.',
    ],
  },
];
