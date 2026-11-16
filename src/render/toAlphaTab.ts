// musicGenie model -> alphaTab Score, for display and playback only.
// alphaTab objects are throwaway: rebuilt from the model whenever it changes.
import * as alphaTab from '@coderline/alphatab';
import { assignChord } from '../model/fretting';
import type { Clef, Song, Track } from '../model/types';
import { barTicks, durationTicks } from '../model/timing';

const m = alphaTab.model;

const CLEF: Record<Clef, alphaTab.model.Clef> = {
  treble: m.Clef.G2, bass: m.Clef.F4, alto: m.Clef.C3, tenor: m.Clef.C4, neutral: m.Clef.Neutral,
};
const VELOCITY_DYN = (v: number) => Math.max(0, Math.min(7, Math.round((v - 16) / 15.8))) as alphaTab.model.DynamicValue;

export interface RenderOptions {
  /** Index of the track that shows chord symbols (defaults to the first visible track). */
  chordTrackIndex?: number;
}

export function toAlphaTabScore(song: Song, settings: alphaTab.Settings, opts: RenderOptions = {}): alphaTab.model.Score {
  const score = new m.Score();
  score.title = song.title;
  score.artist = song.artist;
  score.album = song.album;
  score.music = song.composer;

  song.bars.forEach((b, i) => {
    const mb = new m.MasterBar();
    mb.timeSignatureNumerator = b.timeSignature.numerator;
    mb.timeSignatureDenominator = b.timeSignature.denominator;
    if (b.repeatStart) mb.isRepeatStart = true;
    if (b.repeatEnd) mb.repeatCount = b.repeatEnd;
    for (const tc of song.tempos.filter((x) => x.bar === i)) {
      mb.tempoAutomations.push(m.Automation.buildTempoAutomation(false, tc.tick / barTicks(b), tc.bpm, 2));
    }
    const sec = song.sections.find((s) => s.bar === i);
    if (sec) {
      const section = new m.Section();
      section.text = sec.name;
      section.marker = '';
      mb.section = section;
    }
    score.addMasterBar(mb);
  });

  const chordTrack = opts.chordTrackIndex ?? Math.max(0, song.tracks.findIndex((t) => t.display.visible));
  let channel = 0;
  const nextChannel = () => {
    if (channel === 9) channel++;
    return Math.min(15, channel++);
  };

  song.tracks.forEach((t, ti) => {
    const track = new m.Track();
    track.name = t.name;
    track.shortName = t.name.slice(0, 10);
    const pb = track.playbackInfo;
    pb.program = t.instrument.program;
    if (t.instrument.percussion) {
      pb.primaryChannel = 9;
      pb.secondaryChannel = 9;
    } else {
      pb.primaryChannel = nextChannel();
      pb.secondaryChannel = nextChannel();
    }
    pb.volume = Math.round(t.mixer.volume * 16);
    pb.balance = Math.round(8 + t.mixer.pan * 8);
    pb.isMute = t.mixer.mute;
    pb.isSolo = t.mixer.solo;
    score.addTrack(track);
    buildStaves(track, t, song, ti === chordTrack);
  });

  score.finish(settings);
  return score;
}

function buildStaves(track: alphaTab.model.Track, t: Track, song: Song, showChords: boolean) {
  const fretted = !!t.tuning && !t.instrument.percussion;
  t.staves.forEach((s, si) => {
    const staff = new m.Staff();
    track.addStaff(staff);
    if (t.instrument.percussion) {
      staff.isPercussion = true;
      staff.showTablature = false;
      staff.showStandardNotation = true;
    } else if (fretted) {
      staff.stringTuning = new m.Tuning('', [...t.tuning!].reverse(), false);
      staff.capo = t.capo ?? 0;
      staff.showTablature = t.display.mode !== 'notation';
      staff.showStandardNotation = t.display.mode !== 'tab';
    } else {
      staff.showTablature = false;
      staff.showStandardNotation = true;
    }
    staff.displayTranspositionPitch = t.displayTranspose ?? 0;

    // Hammer-on/pull-off origins: last alphaTab note per string, per voice.
    const lastOnString = new Map<string, alphaTab.model.Note>();
    let chordId = 0;

    // alphaTab needs the same voice count in every bar of a staff.
    const voiceCount = Math.max(1, ...s.measures.map((x) => x.voices.length));
    s.measures.forEach((meas0, bi) => {
      const meas = { voices: [...meas0.voices] };
      while (meas.voices.length < voiceCount) meas.voices.push({ beats: [] });
      const bar = new m.Bar();
      bar.clef = CLEF[s.clef] ?? m.Clef.G2;
      const key = song.bars[bi].key;
      bar.keySignature = key.fifths as alphaTab.model.KeySignature;
      bar.keySignatureType = key.mode === 'minor' ? m.KeySignatureType.Minor : m.KeySignatureType.Major;
      staff.addBar(bar);
      const chordsHere = showChords && si === 0 ? song.chordSymbols.filter((c) => c.bar === bi) : [];
      meas.voices.forEach((v, vi) => {
        const voice = new m.Voice();
        bar.addVoice(voice);
        let tick = 0;
        for (const b of v.beats) {
          const beat = new m.Beat();
          beat.duration = b.duration.base as alphaTab.model.Duration;
          beat.dots = b.duration.dots;
          if (b.duration.tuplet) {
            beat.tupletNumerator = b.duration.tuplet.num;
            beat.tupletDenominator = b.duration.tuplet.den;
          }
          if (b.grace) beat.graceType = m.GraceType.BeforeBeat;
          if (b.lyric) beat.lyrics = [b.lyric];
          if (b.text) beat.text = b.text;
          beat.isEmpty = false;

          const beatTicks = durationTicks(b.duration);
          if (vi === 0 && !b.grace) {
            const cs = chordsHere.find((c) => c.tick >= tick && c.tick < tick + beatTicks);
            if (cs) {
              const id = `c${bi}_${chordId++}`;
              const chord = new m.Chord();
              chord.name = cs.name;
              chord.showDiagram = false;
              staff.addChord(id, chord);
              beat.chordId = id;
            }
          }
          if (!b.grace) tick += beatTicks;

          // Display-only fret positions for fretted tracks whose notes have none (e.g. piano part on guitar).
          const needsFrets = fretted && b.notes.some((n) => n.string === undefined || n.fret === undefined);
          const computed = needsFrets
            ? assignChord(b.notes.map((n) => n.pitch), t.tuning!, { capo: t.capo ?? 0 })
            : null;

          b.notes.forEach((n, ni) => {
            const note = new m.Note();
            const pos = n.string !== undefined && n.fret !== undefined ? { string: n.string, fret: n.fret } : computed?.[ni];
            if (t.instrument.percussion) {
              note.percussionArticulation = n.pitch;
            } else if (fretted && pos) {
              note.string = pos.string;
              note.fret = pos.fret;
            } else {
              note.octave = Math.floor(n.pitch / 12);
              note.tone = n.pitch % 12;
            }
            note.dynamics = VELOCITY_DYN(n.velocity);
            if (n.tieFromPrevious) note.isTieDestination = true;
            const tq = n.techniques;
            if (tq) {
              if ((tq.hammerOn || tq.pullOff) && pos) {
                const origin = lastOnString.get(`${vi}:${pos.string}`);
                if (origin) origin.isHammerPullOrigin = true;
              }
              if (tq.slideIn === 'fromBelow') note.slideInType = m.SlideInType.IntoFromBelow;
              if (tq.slideIn === 'fromAbove') note.slideInType = m.SlideInType.IntoFromAbove;
              if (tq.slideOut) {
                note.slideOutType = {
                  shift: m.SlideOutType.Shift, legato: m.SlideOutType.Legato,
                  outUp: m.SlideOutType.OutUp, outDown: m.SlideOutType.OutDown,
                }[tq.slideOut];
              }
              if (tq.bend?.length) {
                note.bendType = m.BendType.Custom;
                for (const p of tq.bend) note.addBendPoint(new m.BendPoint(p.position, p.value));
              }
              if (tq.vibrato) note.vibrato = tq.vibrato === 'wide' ? m.VibratoType.Wide : m.VibratoType.Slight;
              if (tq.palmMute) note.isPalmMute = true;
              if (tq.harmonic) {
                note.harmonicType = {
                  natural: m.HarmonicType.Natural, artificial: m.HarmonicType.Artificial, pinch: m.HarmonicType.Pinch,
                  tap: m.HarmonicType.Tap, semi: m.HarmonicType.Semi,
                }[tq.harmonic];
              }
              if (tq.tap) beat.tap = true;
              if (tq.slap) beat.slap = true;
              if (tq.pop) beat.pop = true;
              if (tq.accent) note.accentuated = tq.accent === 'heavy' ? m.AccentuationType.Heavy : m.AccentuationType.Normal;
              if (tq.letRing) note.isLetRing = true;
              if (tq.dead) note.isDead = true;
              if (tq.ghost) note.isGhost = true;
              if (tq.staccato) note.isStaccato = true;
            }
            beat.addNote(note);
            if (pos) lastOnString.set(`${vi}:${pos.string}`, note);
          });
          voice.addBeat(beat); // grace beats already sit before their main beat in the model
        }
        if (v.beats.length === 0) {
          // Empty voice: a full-bar rest so the bar still has a duration.
          const rest = new m.Beat();
          rest.duration = m.Duration.Whole;
          rest.isEmpty = vi > 0;
          voice.addBeat(rest);
        }
      });
    });
  });
}
