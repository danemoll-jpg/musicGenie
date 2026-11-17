// Writes Docs/USER-GUIDE.md from the in-app help pages (src/renderer/src/help/*.ts) and the glossary.
// Run after changing any help page: node scripts/make-user-guide.mjs   (Node 23.6+: runs the .ts files directly)
import { writeFileSync } from 'node:fs';

const help = (f) => import(new URL(`../src/renderer/src/help/${f}`, import.meta.url).href);
const { CORE_TOPICS, GLOSSARY } = await help('core.ts');
const { WRITE_TOPICS } = await help('write.ts');
const { MIX_TOPICS } = await help('mix.ts');
const { RECORDING_TOPICS } = await help('recordings.ts');
const topics = [...CORE_TOPICS, ...WRITE_TOPICS, ...MIX_TOPICS, ...RECORDING_TOPICS];
const AREAS = ['Start', 'Arrange', 'Write', 'Mix', 'Recordings', 'Files', 'Bonus'];
const INTRO = {
  Start: 'Getting around: the Home screen, the four workspaces and the menus.',
  Arrange: 'See the music, choose instruments, add a band and hear it (the Arrange workspace).',
  Write: 'Enter and change notes, chords, drums and lyrics (the Write workspace).',
  Mix: 'Balance the instruments, add effects and other sounds (the Mix workspace).',
  Recordings: 'Turn a recording or printed sheet music into a song (the Recordings workspace).',
  Files: 'Saving, sounds and exporting.',
  Bonus: 'Extras that are not part of the main path.',
};

let md = `# musicGenie user guide

musicGenie lets you **open or write music, see it as sheet music or tabs, give it instruments and a band, and hear it.**
Everything else supports that. This guide is made from the help pages inside the app (the “?” buttons and
Help > Help topics), so the two always say the same thing. Help > Take the tour walks you through the main path.

**The screen:** the menu bar (File, Edit, View, Song, Tools, Help) and the four workspace tabs are at the top,
the play bar under them, the music in the middle, the tracks (instruments) on the left, the band panel on the
right in Arrange, and each workspace's own tools in the bottom panel. Panels fold away and resize by dragging;
⛶ Full score (F11) shows only the music. Every button explains itself when you hover over it.

## Contents
`;
for (const a of AREAS) {
  const ts = topics.filter((t) => t.area === a);
  if (!ts.length) continue;
  md += `- **${a}**: ${ts.map((t) => `[${t.title}](#${t.id})`).join(' · ')}\n`;
}
md += '- [Glossary](#glossary)\n';
for (const a of AREAS) {
  const ts = topics.filter((t) => t.area === a);
  if (!ts.length) continue;
  md += `\n## ${a}\n\n${INTRO[a]}\n`;
  for (const t of ts) {
    md += `\n### <a id="${t.id}"></a>${t.title}\n\n${t.what}\n\n**When to use it:** ${t.when}\n\n**Try it:**\n`;
    t.steps.forEach((s, i) => { md += `${i + 1}. ${s}\n`; });
    if (t.tips?.length) md += `\n${t.tips.map((s) => `- ${s}`).join('\n')}\n`;
  }
}
md += `\n## <a id="glossary"></a>Glossary\n\n${GLOSSARY.map((g) => `- **${g.term}**: ${g.meaning}`).join('\n')}\n`;
writeFileSync(new URL('../Docs/USER-GUIDE.md', import.meta.url), md);
console.log(`wrote Docs/USER-GUIDE.md: ${topics.length} topics, ${GLOSSARY.length} glossary entries`);
