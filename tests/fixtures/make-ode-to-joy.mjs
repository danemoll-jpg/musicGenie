// Generates TestData/ode-to-joy-piano.musicxml: Beethoven's "Ode to Joy" theme (public domain),
// simple two-hand piano arrangement written for musicGenie's tests (CC0).
// Run: node tests/fixtures/make-ode-to-joy.mjs
import { writeFileSync } from 'node:fs';

const STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
// note spec: "E4:q" pitch:duration, "r:h" rest. Durations in divisions (2 per quarter).
const DUR = { e: 1, q: 2, 'q.': 3, h: 4, w: 8 };
const TYPE = { 1: 'eighth', 2: 'quarter', 3: 'quarter', 4: 'half', 8: 'whole' };

const rh = [
  'E4:q E4:q F4:q G4:q', 'G4:q F4:q E4:q D4:q', 'C4:q C4:q D4:q E4:q', 'E4:q. D4:e D4:h',
  'E4:q E4:q F4:q G4:q', 'G4:q F4:q E4:q D4:q', 'C4:q C4:q D4:q E4:q', 'D4:q. C4:e C4:h',
  'D4:q D4:q E4:q C4:q', 'D4:q E4:e F4:e E4:q C4:q', 'D4:q E4:e F4:e E4:q D4:q', 'C4:q D4:q G3:h',
  'E4:q E4:q F4:q G4:q', 'G4:q F4:q E4:q D4:q', 'C4:q C4:q D4:q E4:q', 'D4:q. C4:e C4:h',
];
// Left hand: chords "C3+G3:h"
const lh = [
  'C3+G3:w', 'G2+G3:w', 'C3+G3:w', 'G2+G3:h G2+B2:h',
  'C3+G3:w', 'G2+G3:w', 'C3+G3:w', 'G2+B2:h C3+E3:h',
  'G2+B2:h C3+G3:h', 'G2+B2:h C3+G3:h', 'G2+B2:h D3+F#3:h', 'C3+E3:h G2+D3:h',
  'C3+G3:w', 'G2+G3:w', 'C3+G3:w', 'G2+B2:h C3+E3:h',
];
const chords = ['C', 'G', 'C', 'G', 'C', 'G', 'C', 'G C', 'G C', 'G C', 'G D', 'C G', 'C', 'G', 'C', 'G C'];
const lyrics = { 0: ['Joy', 'ful,', 'joy', 'ful,'] };

function pitchXml(p) {
  const m = /^([A-G])(#|b)?(\d)$/.exec(p);
  const alter = m[2] === '#' ? '<alter>1</alter>' : m[2] === 'b' ? '<alter>-1</alter>' : '';
  return `<pitch><step>${m[1]}</step>${alter}<octave>${m[3]}</octave></pitch>`;
}

function notesXml(spec, staff, voice, barIdx) {
  let out = '';
  spec.split(' ').forEach((tok, i) => {
    const [ps, d] = tok.split(':');
    const dur = DUR[d];
    const dot = d.endsWith('.') ? '<dot/>' : '';
    const lyr = staff === 1 && lyrics[barIdx]?.[i]
      ? `<lyric number="1"><text>${lyrics[barIdx][i]}</text></lyric>` : '';
    ps.split('+').forEach((p, k) => {
      out += `<note>${k ? '<chord/>' : ''}${pitchXml(p)}<duration>${dur}</duration><voice>${voice}</voice>` +
        `<type>${TYPE[dur]}</type>${dot}${p.includes('#') ? '<accidental>sharp</accidental>' : ''}<staff>${staff}</staff>${k ? '' : lyr}</note>\n`;
    });
  });
  return out;
}

function harmonyXml(name) {
  const root = name[0];
  return `<harmony><root><root-step>${root}</root-step></root><kind>major</kind></harmony>\n`;
}

let measures = '';
for (let i = 0; i < 16; i++) {
  let m = `<measure number="${i + 1}">\n`;
  if (i === 0) {
    m += `<attributes><divisions>2</divisions><key><fifths>0</fifths><mode>major</mode></key>` +
      `<time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves>` +
      `<clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>\n` +
      `<direction placement="above"><direction-type><rehearsal>A</rehearsal></direction-type></direction>\n` +
      `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>100</per-minute></metronome></direction-type><sound tempo="100"/></direction>\n`;
  }
  if (i === 8) m += `<direction placement="above"><direction-type><rehearsal>B</rehearsal></direction-type></direction>\n`;
  const cs = chords[i].split(' ');
  // first chord symbol at beat 1, second (if any) at beat 3 via forward after notes.
  m += harmonyXml(cs[0]);
  m += notesXml(rh[i], 1, 1, i);
  m += `<backup><duration>8</duration></backup>\n`;
  if (cs[1]) {
    m += notesXml(lh[i].split(' ')[0], 2, 2, i);
    m += harmonyXml(cs[1]);
    m += notesXml(lh[i].split(' ').slice(1).join(' '), 2, 2, i);
  } else {
    m += notesXml(lh[i], 2, 2, i);
  }
  if (i === 15) m += `<barline location="right"><bar-style>light-heavy</bar-style></barline>\n`;
  m += `</measure>\n`;
  measures += m;
}

const xml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
<work><work-title>Ode to Joy (piano)</work-title></work>
<identification><creator type="composer">Ludwig van Beethoven</creator><rights>Arrangement CC0 (musicGenie test data)</rights></identification>
<part-list><score-part id="P1"><part-name>Piano</part-name>
<score-instrument id="P1-I1"><instrument-name>Piano</instrument-name></score-instrument>
<midi-instrument id="P1-I1"><midi-channel>1</midi-channel><midi-program>1</midi-program></midi-instrument>
</score-part></part-list>
<part id="P1">
${measures}</part>
</score-partwise>
`;
writeFileSync(new URL('../../TestData/ode-to-joy-piano.musicxml', import.meta.url), xml);
console.log('wrote TestData/ode-to-joy-piano.musicxml');
