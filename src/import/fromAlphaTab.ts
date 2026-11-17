// alphaTab Score (from its MusicXML / Guitar Pro importers) -> musicGenie model.
import * as alphaTab from '@coderline/alphatab';
import { instrumentForProgram } from '../model/instruments';
import {

  type BarHeader, type Beat, type Clef, type DurationBase, type Note, type Song, type Staff,
  type Techniques, type Track,
} from '../model/types';
import { barTicks } from '../model/timing';
import { musicXmlKeepHyphens } from '../model/lyrics';

const m = alphaTab.model;

export function importWithAlphaTab(bytes: Uint8Array): Song {
  const settings = new alphaTab.Settings();
  // MusicXML: alphaTab drops <syllabic>; keep the hyphens of split words in the syllable text.
  const head = new TextDecoder().decode(bytes.subarray(0, 2000));
  if (/<score-(partwise|timewise)|<\?xml/.test(head)) {
    const text = new TextDecoder().decode(bytes);
    if (/<syllabic>/.test(text)) bytes = new TextEncoder().encode(musicXmlKeepHyphens(text));
  }
  const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes, settings);
  return fromAlphaTabScore(score);
}

const CLEF: Record<number, Clef> = {
  [m.Clef.G2]: 'treble', [m.Clef.F4]: 'bass', [m.Clef.C3]: 'alto', [m.Clef.C4]: 'tenor', [m.Clef.Neutral]: 'neutral',
};

/** Collapse whitespace (MusicXML import yields non-breaking spaces) and trim. */
const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

const DYN_VELOCITY = [16, 33, 49, 64, 80, 96, 112, 127]; // PPP..FFF

export function fromAlphaTabScore(score: alphaTab.model.Score): Song {
  const bars: BarHeader[] = score.masterBars.map((mb) => {
    const b: BarHeader = {
      timeSignature: { numerator: mb.timeSignatureNumerator, denominator: mb.timeSignatureDenominator },
      key: { fifths: mb.keySignature as number, mode: mb.keySignatureType === m.KeySignatureType.Minor ? 'minor' : 'major' },
    };
    if (mb.isRepeatStart) b.repeatStart = true;
    if (mb.repeatCount > 0) b.repeatEnd = mb.repeatCount;
    return b;
  });

  const tempos: Song['tempos'] = [];
  score.masterBars.forEach((mb, i) => {
    for (const a of mb.tempoAutomations) {
      const tick = Math.round(a.ratioPosition * barTicks(bars[i]));
      const last = tempos[tempos.length - 1];
      if (last && last.bpm === a.value) continue; // drop repeated identical tempo marks
      tempos.push({ bar: i, tick, bpm: a.value });
    }
  });
  if (!tempos.length || tempos[0].bar !== 0 || tempos[0].tick !== 0) {
    tempos.unshift({ bar: 0, tick: 0, bpm: score.tempo || 120 });
  }

  const sections: Song['sections'] = [];
  score.masterBars.forEach((mb, i) => {
    if (mb.section) sections.push({ bar: i, name: clean(mb.section.text) || clean(mb.section.marker) || `Section ${sections.length + 1}` });
  });

  const chordSymbols: Song['chordSymbols'] = [];
  const chordSeen = new Set<string>();

  const tracks: Track[] = score.tracks.map((t, ti) => {
    const pb = t.playbackInfo;
    const percussion = t.isPercussion || t.staves.some((s) => s.isPercussion);
    const c = instrumentForProgram(pb.program, percussion);
    const first = t.staves[0];
    const fretted = !percussion && first.isStringed && first.tuning.length > 0 &&
      (first.showTablature || (pb.program >= 24 && pb.program <= 39));

    const track: Track = {
      id: `t${ti + 1}`,
      name: clean(t.name) || c.name,
      instrument: { id: c.id, program: percussion ? 0 : pb.program, percussion },
      mixer: {
        volume: Math.max(0, Math.min(1, pb.volume / 16)),
        pan: Math.max(-1, Math.min(1, (pb.balance - 8) / 8)),
        mute: pb.isMute,
        solo: pb.isSolo,
      },
      display: { visible: true, mode: fretted ? (first.showStandardNotation ? 'both' : 'tab') : 'notation' },
      staves: [],
    };
    if (fretted) {
      track.tuning = [...first.tuning].reverse();
      if (first.capo) track.capo = first.capo;
    }
    if (first.displayTranspositionPitch) track.displayTranspose = first.displayTranspositionPitch;

    track.staves = t.staves.map((s): Staff => ({
      clef: CLEF[s.bars[0]?.clef ?? m.Clef.G2] ?? 'treble',
      measures: s.bars.map((bar, bi) => {
        const voices = bar.voices.filter((v, vi) => vi === 0 || !v.isEmpty);
        return {
          voices: voices.map((v) => ({
            beats: v.beats
              .filter((b) => !b.isEmpty)
              .map((b): Beat => {
                if (b.chordId && s.hasChord(b.chordId)) {
                  const ch = s.getChord(b.chordId)!;
                  const tick = Math.round(b.playbackStart) /* alphaTab uses 960 ticks per quarter = PPQ */;
                  const key = `${bi}:${tick}`;
                  if (clean(ch.name) && !chordSeen.has(key)) {
                    chordSeen.add(key);
                    chordSymbols.push({ bar: bi, tick, name: clean(ch.name) });
                  }
                }
                return convertBeat(b, fretted);
              }),
          })),
        };
      }),
    }));
    return track;
  });

  chordSymbols.sort((a, b) => a.bar - b.bar || a.tick - b.tick);

  return {
    title: clean(score.title) || 'Untitled',
    artist: clean(score.artist),
    album: clean(score.album),
    composer: clean(score.music),
    bars, tempos, sections, chordSymbols, tracks,
  };
}

function convertBeat(b: alphaTab.model.Beat, fretted: boolean): Beat {
  const base = Math.max(1, Math.min(64, b.duration as number)) as DurationBase;
  const beat: Beat = {
    duration: { base, dots: Math.min(2, b.dots) as 0 | 1 | 2 },
    notes: [],
  };
  if (b.hasTuplet) beat.duration.tuplet = { num: b.tupletNumerator, den: b.tupletDenominator };
  if (b.graceType !== m.GraceType.None) beat.grace = true;
  if (b.lyrics?.some((l) => l && l.trim())) {
    const l = b.lyrics.map((x) => (x ?? '').trim());
    while (l.length && !l[l.length - 1]) l.pop();
    beat.lyrics = l;
  }
  if (b.text) beat.text = b.text;
  if (!b.isRest) beat.notes = b.notes.filter((n) => n.isVisible || true).map((n) => convertNote(n, b, fretted));
  return beat;
}

function convertNote(n: alphaTab.model.Note, b: alphaTab.model.Beat, fretted: boolean): Note {
  const note: Note = {
    pitch: n.realValueWithoutHarmonic,
    velocity: DYN_VELOCITY[n.dynamics as number] ?? 96,
  };
  if (fretted && n.isStringed) {
    note.string = n.string;
    // alphaTab counts frets from the capo; our model counts from the nut.
    note.fret = n.fret + (b.voice.bar.staff.capo ?? 0);
  }
  if (n.isTieDestination) note.tieFromPrevious = true;
  const t: Techniques = {};
  if (n.isHammerPullDestination && n.hammerPullOrigin) {
    if (n.realValue >= n.hammerPullOrigin.realValue) t.hammerOn = true;
    else t.pullOff = true;
  }
  if (n.slideInType === m.SlideInType.IntoFromBelow) t.slideIn = 'fromBelow';
  if (n.slideInType === m.SlideInType.IntoFromAbove) t.slideIn = 'fromAbove';
  switch (n.slideOutType) {
    case m.SlideOutType.Shift: t.slideOut = 'shift'; break;
    case m.SlideOutType.Legato: t.slideOut = 'legato'; break;
    case m.SlideOutType.OutUp: t.slideOut = 'outUp'; break;
    case m.SlideOutType.OutDown: case m.SlideOutType.PickSlideDown: t.slideOut = 'outDown'; break;
  }
  if (n.hasBend && n.bendPoints) t.bend = n.bendPoints.map((p) => ({ position: p.offset, value: p.value }));
  if (n.vibrato === m.VibratoType.Slight) t.vibrato = 'slight';
  if (n.vibrato === m.VibratoType.Wide) t.vibrato = 'wide';
  if (n.isPalmMute || b.isPalmMute) t.palmMute = true;
  const H: Record<number, Techniques['harmonic']> = {
    [m.HarmonicType.Natural]: 'natural', [m.HarmonicType.Artificial]: 'artificial', [m.HarmonicType.Pinch]: 'pinch',
    [m.HarmonicType.Tap]: 'tap', [m.HarmonicType.Semi]: 'semi', [m.HarmonicType.Feedback]: 'natural',
  };
  if (n.harmonicType !== m.HarmonicType.None) t.harmonic = H[n.harmonicType];
  if (n.isLeftHandTapped || b.tap) t.tap = true;
  if (b.slap) t.slap = true;
  if (b.pop) t.pop = true;
  if (n.accentuated === m.AccentuationType.Normal) t.accent = 'normal';
  if (n.accentuated === m.AccentuationType.Heavy) t.accent = 'heavy';
  if (n.isLetRing || b.isLetRing) t.letRing = true;
  if (n.isDead) t.dead = true;
  if (n.isGhost) t.ghost = true;
  if (n.isStaccato) t.staccato = true;
  if (b.isTremolo) t.tremolo = true;
  if (Object.keys(t).length) note.techniques = t;
  return note;
}
