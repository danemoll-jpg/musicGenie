// Print/PDF view: loaded in a hidden window (never shown) by the main process. Draws the chosen
// parts as pages (title, composer; page numbers come from the PDF footer), then signals ready.
import * as alphaTab from '@coderline/alphatab';
import { useEffect, useRef } from 'react';
import { parseProject, type DisplayMode, type Song } from '../../model';
import { toAlphaTabScore } from '../../render/toAlphaTab';

export interface PrintJob {
  /** The song as project JSON. */
  json: string;
  /** Model track indices to print. */
  tracks: number[];
  /** notation / tab / both (tab only applies to fretted tracks). */
  mode: DisplayMode;
  pageSize: 'Letter' | 'A4';
}

export function PrintView() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void (async () => {
      const job = (await window.mg.printJob()) as PrintJob | null;
      if (!job || !host.current) return;
      // Printable width at 96 px/inch with 0.5 inch margins.
      host.current.style.width = (job.pageSize === 'A4' ? 698 : 720) + 'px';
      const song: Song = parseProject(job.json);
      const printable: Song = {
        ...song,
        tracks: song.tracks.map((t, i) => ({
          ...t,
          display: { visible: job.tracks.includes(i), mode: t.tuning && !t.instrument.percussion ? job.mode : 'notation' },
        })),
      };
      const s = new alphaTab.Settings();
      const base = new URL('./', location.href).href;
      s.core.fontDirectory = base + 'font/';
      s.core.enableLazyLoading = false;
      s.core.useWorkers = false;
      s.player.playerMode = alphaTab.PlayerMode.Disabled;
      s.display.layoutMode = alphaTab.LayoutMode.Page;
      s.display.scale = 0.65;
      const api = new alphaTab.AlphaTabApi(host.current, s);
      api.postRenderFinished.on(() => {
        // alphaTab places its partial images absolutely; stack them so the PDF can break pages between systems.
        const surface = host.current?.querySelector('.at-surface') as HTMLElement | null;
        if (surface) {
          surface.style.height = 'auto';
          for (const c of [...surface.children] as HTMLElement[]) {
            c.style.position = 'static';
            c.style.breakInside = 'avoid';
            c.style.display = 'block';
          }
        }
        setTimeout(() => window.mg.printReady(), 300);
      });
      const score = toAlphaTabScore(printable, s);
      const visible = job.tracks.length ? job.tracks : [0];
      api.renderScore(score, visible);
    })();
  }, []);
  return <div ref={host} className="print-host" style={{ width: '100%', background: '#fff' }} />;
}
