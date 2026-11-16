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
3. Tabs + Rocksmith 2014 import/export (guitar and bass).
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
