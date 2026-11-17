// Builds the example songs shipped with the app (Home > Try an example) into
// src/renderer/public/examples/. All public domain (see the README written next to them).
// Run: node scripts/make-examples.mjs
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';

const out = new URL('../src/renderer/public/examples/', import.meta.url);
mkdirSync(out, { recursive: true });
copyFileSync(new URL('../TestData/ode-to-joy-piano.musicxml', import.meta.url), new URL('ode-to-joy.musicxml', out));
copyFileSync(new URL('../TestData/bach-prelude-c-bwv846.mid', import.meta.url), new URL('bach-prelude-in-c.mid', out));

// "Twinkle, Twinkle, Little Star" (French folk tune "Ah ! vous dirai-je, maman", 18th century): melody + chord symbols.
const melody = [
  'C4 C4 G4 G4', 'A4 A4 G4:h', 'F4 F4 E4 E4', 'D4 D4 C4:h',
  'G4 G4 F4 F4', 'E4 E4 D4:h', 'G4 G4 F4 F4', 'E4 E4 D4:h',
  'C4 C4 G4 G4', 'A4 A4 G4:h', 'F4 F4 E4 E4', 'D4 D4 C4:h',
];
const chords = ['C', 'F C', 'F C', 'G C', 'C F', 'C G', 'C F', 'C G', 'C', 'F C', 'F C', 'G C'];
const DIV = 2;
const dur = (d) => (d === 'h' ? 2 * DIV : DIV);
const pitch = (p) => `<pitch><step>${p[0]}</step><octave>${p[1]}</octave></pitch>`;
const harmony = (n) => `<harmony><root><root-step>${n}</root-step></root><kind>major</kind></harmony>\n`;
let measures = '';
melody.forEach((bar, i) => {
  let m = `<measure number="${i + 1}">\n`;
  if (i === 0) {
    m += `<attributes><divisions>${DIV}</divisions><key><fifths>0</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>\n`;
    m += `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>96</per-minute></metronome></direction-type><sound tempo="96"/></direction>\n`;
  }
  const cs = chords[i].split(' ');
  let beat = 0;
  for (const tok of bar.split(' ')) {
    const [p, d] = tok.split(':');
    if (cs[1] && beat === 2) m += harmony(cs[1]);
    if (beat === 0) m += harmony(cs[0]);
    m += `<note>${pitch(p)}<duration>${dur(d)}</duration><voice>1</voice><type>${d === 'h' ? 'half' : 'quarter'}</type></note>\n`;
    beat += d === 'h' ? 2 : 1;
  }
  if (i === melody.length - 1) m += `<barline location="right"><bar-style>light-heavy</bar-style></barline>\n`;
  measures += m + `</measure>\n`;
});
writeFileSync(new URL('twinkle-twinkle.musicxml', out), `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
<work><work-title>Twinkle, Twinkle, Little Star</work-title></work>
<identification><creator type="composer">Traditional (French folk tune)</creator><rights>Public domain; this setting CC0 (musicGenie)</rights></identification>
<part-list><score-part id="P1"><part-name>Melody</part-name>
<score-instrument id="P1-I1"><instrument-name>Flute</instrument-name></score-instrument>
<midi-instrument id="P1-I1"><midi-channel>1</midi-channel><midi-program>74</midi-program></midi-instrument>
</score-part></part-list>
<part id="P1">
${measures}</part>
</score-partwise>
`);
writeFileSync(new URL('README.md', out), `# Example songs (Home > Try an example)

| File | What | Source / licence |
|---|---|---|
| ode-to-joy.musicxml | Beethoven, "Ode to Joy" theme, two-hand piano with chord symbols | Melody public domain; arrangement CC0 (made by tests/fixtures/make-ode-to-joy.mjs) |
| bach-prelude-in-c.mid | J. S. Bach, Prelude No. 1 in C, BWV 846 | Mutopia Project piece 5 — Public Domain |
| twinkle-twinkle.musicxml | "Twinkle, Twinkle, Little Star" (French folk tune), melody + chords | Public domain; this setting CC0 (scripts/make-examples.mjs) |
| (built in) 12-bar blues | A chord chart in A, played by the blues band | Written for musicGenie, CC0 |

Rebuild with \`node scripts/make-examples.mjs\`.
`);
console.log('wrote src/renderer/public/examples/');
