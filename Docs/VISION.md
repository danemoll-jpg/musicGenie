# musicGenie: Vision

What it is: a sheet-music reader, composition studio, virtual band and
recording studio in one. **The defining feature:** take a piece of music,
import it, assign instruments, change the arrangement (e.g. piano piece to a
rock band), and hear it immediately. Approachable for someone who doesn't
read music; assisted features are optional, never a replacement for editing
by hand.

## Feature areas (roadmap order)
1. Foundation: model, import (MusicXML, Guitar Pro, MIDI), notation + tabs,
   instruments, playback with score following, save/load.
2. Virtual band: split parts, chord recognition, style-based accompaniment,
   "band conductor" controls (simplify drums, bass follows kick, piano melody
   to guitar solo).
3. Tabs for guitar and bass (Rocksmith 2014 import/export is a **bonus**
   export, File > Export > Rocksmith 2014…, not the centre of the app).
4. Composition: staff entry, piano roll, chord explorer (inversions, voicings,
   fingerings), drum machine, harmonisation, chord suggestions.
5. Production: mixer + effects, audio tracks, export.
6. Advanced (plug in existing tools): singing synthesis with lyrics, PDF score
   reading, audio to notes, stem separation, VST3 instruments, MIDI keyboard.

## Decisions
- 2026-11-16: Electron + TypeScript + alphaTab; one shared music model is the
  source of truth; notes carry string/fret/technique data from day one;
  Rocksmith via a .NET helper using Rocksmith2014.NET.
- Sound quality depends on the sample library: plan for better SoundFonts or
  VST3 instruments rather than expecting the default sounds to be realistic.
- 2026-11-17 (Dan): Rocksmith is a bonus, not the centre. The app is for
  opening or writing music, seeing it as sheet music/tabs, giving it
  instruments and a band, and hearing it. The UI must put the score first
  and explain every tool in plain words (Round 8).
- 2026-11-17 (Round 8): the layout follows what you're doing. Menu bar (File,
  Edit, View, Song, Tools, Help), one play bar, and four workspaces:
  **Arrange** (default: score, tracks, band), **Write** (notes, piano roll,
  drums, chords, lyrics, MIDI), **Mix** (mixer, effects, changes over time,
  audio tracks, sounds) and **Recordings** (recording or PDF to sheet music).
  The score gets most of the window; a Home screen, guided tours, a "?" help
  page on every panel and a tooltip on every control explain the rest.
