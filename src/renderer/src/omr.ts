// Round 6, item 8: sheet music (PDF / photo) -> MusicXML (Audiveris, see src/main/omr.ts) -> a song.
// "Unsure" places: what Audiveris logged as warnings (by page/measure) plus every measure whose
// notes do not add up to its time signature (the usual sign of a misread rhythm).
import type { Store } from './store';
import { analysisCtl } from './Round6';

export interface UnsureBar { page: number; bar?: number; text: string }

/** Measures whose voices do not fill the bar (pickup and last bar allowed to be short). */
export function rhythmIssues(xml: string): UnsureBar[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const out: UnsureBar[] = [];
  const parts = Array.from(doc.getElementsByTagName('part'));
  const bad = new Map<number, string>();
  for (const part of parts) {
    let divisions = 1, beats = 4, beatType = 4;
    const measures = Array.from(part.getElementsByTagName('measure'));
    measures.forEach((m, mi) => {
      const num = (t: string, el: Element = m) => Number(el.getElementsByTagName(t)[0]?.textContent ?? NaN);
      const at = m.getElementsByTagName('attributes')[0];
      if (at) {
        if (!Number.isNaN(num('divisions', at))) divisions = num('divisions', at);
        if (!Number.isNaN(num('beats', at))) beats = num('beats', at);
        if (!Number.isNaN(num('beat-type', at))) beatType = num('beat-type', at);
      }
      const want = (divisions * 4 * beats) / beatType;
      // Position per voice, following backup/forward.
      const voices = new Map<string, number>();
      let pos = 0;
      let maxEnd = 0;
      for (const el of Array.from(m.children)) {
        if (el.tagName === 'backup') pos -= num('duration', el) || 0;
        else if (el.tagName === 'forward') pos += num('duration', el) || 0;
        else if (el.tagName === 'note') {
          if (el.getElementsByTagName('grace').length) continue;
          const d = num('duration', el) || 0;
          if (el.getElementsByTagName('chord').length) continue;
          const v = el.getElementsByTagName('voice')[0]?.textContent ?? '1';
          pos += d;
          voices.set(v, Math.max(voices.get(v) ?? 0, pos));
          maxEnd = Math.max(maxEnd, pos);
        }
      }
      const first = mi === 0, last = mi === measures.length - 1;
      const short = maxEnd < want - 0.5;
      const over = maxEnd > want + 0.5;
      if (over || (short && !first && !last && maxEnd > 0)) {
        bad.set(mi, `rhythm adds up to ${(maxEnd / divisions).toFixed(2)} of ${(want / divisions).toFixed(2)} beats`);
      }
    });
  }
  for (const [bar, text] of [...bad.entries()].sort((a, b) => a[0] - b[0])) out.push({ page: 0, bar, text });
  return out;
}

export const omrCtl = {
  last: null as null | { input: string; files: string[]; issues: UnsureBar[]; ms: number; log: string },
  autoAccept: false,

  async ensureInstalled(store: Store): Promise<boolean> {
    const st = await window.mg.omrStatus();
    if (st.installed) return true;
    const ok = this.autoAccept || (await store.askAsync(`Reading sheet music needs Audiveris ${st.version ?? '5.11.0'} (${(st.size / 1e6).toFixed(0)} MB download, ${st.licence}). Download and unpack it into the app's data folder? Only done once.`, 'Download'));
    if (!ok) return false;
    await analysisCtl.current!.withJob('Installing Audiveris', () => window.mg.omrInstall());
    return true;
  },

  /** Pick a PDF/image, read it, open the result as the current song. */
  async importScore(store: Store, path?: string | null) {
    const p = path ?? (await window.mg.pickFile('Read sheet music', [{ name: 'Score (PDF or image)', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'tif', 'tiff', 'bmp'] }]));
    if (!p) return null;
    if (!(await this.ensureInstalled(store))) return null;
    const { userData } = await window.mg.paths();
    const outDir = `${userData}\\omr\\${Date.now().toString(36)}`;
    const r = await analysisCtl.current!.withJob('Reading sheet music', () => window.mg.omr({ input: p, outDir }));
    const file = r.mxl[0];
    await store.openPath(file);
    let issues: UnsureBar[] = r.issues.map((i) => ({ page: i.sheet, bar: i.measure !== undefined ? i.measure - 1 : undefined, text: i.text }));
    if (/\.(xml|musicxml)$/i.test(file)) {
      const f = await window.mg.readFile(file);
      issues = [...issues, ...rhythmIssues(new TextDecoder().decode(f.bytes))];
    }
    this.last = { input: p, files: r.mxl, issues, ms: r.ms, log: r.log.slice(-20000) };
    const song = store.state.song;
    if (song) {
      // Audiveris names parts "Voice" (no instrument): read scores play as piano until changed.
      const fileTitle = p.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '');
      store.edit((s) => ({
        ...s,
        title: !s.title || s.title === 'Untitled' ? fileTitle : s.title,
        tracks: s.tracks.map((t, i) => ({
          ...t,
          instrument: t.instrument.percussion ? t.instrument : { id: 'acoustic-grand-piano', program: 0, percussion: false },
          omr: i === 0 ? { issues } : t.omr,
        })),
      }), 'Sheet music check');
      const bars = [...new Set(issues.filter((i) => i.bar !== undefined).map((i) => i.bar! + 1))].sort((a, b) => a - b);
      const pages = [...new Set(issues.filter((i) => i.bar === undefined && i.page).map((i) => i.page))];
      store.showInfo(issues.length
        ? `Read ${p.split(/[\\/]/).pop()}. Check ${bars.length ? 'bars ' + bars.slice(0, 30).join(', ') + (bars.length > 30 ? '…' : '') : ''}${bars.length && pages.length ? ' and ' : ''}${pages.length ? 'page(s) ' + pages.join(', ') : ''}: the reader was unsure there.`
        : `Read ${p.split(/[\\/]/).pop()}: no doubtful bars reported.`);
    }
    return { ...this.last, notes: 0 };
  },
};
