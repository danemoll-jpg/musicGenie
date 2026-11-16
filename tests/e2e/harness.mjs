// Test harness: starts musicGenie HIDDEN and MUTED, never shows or focuses a window.
// Screenshots come from webContents.capturePage() in the main process.
import { _electron as electron } from 'playwright-core';
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

export const ROOT = resolve(import.meta.dirname, '..', '..');
export const RESULTS = join(ROOT, 'test-results');
mkdirSync(RESULTS, { recursive: true });

export const PACKAGED_EXE = join(ROOT, 'dist', 'win-unpacked', 'musicGenie.exe');

export function newProfileDir() {
  return mkdtempSync(join(tmpdir(), 'musicgenie-test-'));
}

/**
 * @param {{ exe?: string, dev?: boolean, profileDir?: string, extraArgs?: string[] }} opts
 */
export async function launch(opts = {}) {
  const profileDir = opts.profileDir ?? newProfileDir();
  // --mute and --hidden are ALWAYS passed. Never remove them (CLAUDE.md standing rules).
  const flags = ['--mute', '--hidden', `--profile-dir=${profileDir}`, ...(opts.extraArgs ?? [])];
  const app = opts.dev
    ? await electron.launch({ args: [ROOT, ...flags], cwd: ROOT })
    : await electron.launch({ executablePath: opts.exe ?? PACKAGED_EXE, args: flags, cwd: ROOT });
  const page = await app.firstWindow();
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log(`  [renderer ${m.type()}] ${m.text()}`);
  });
  await page.waitForFunction(() => !!window.mgTest?.hasPlayer(), null, { timeout: 30000 });
  return { app, page, profileDir };
}

/** Window visibility/focus as the OS sees it. */
export async function windowInfo(app) {
  return app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((w) => ({ visible: w.isVisible(), focused: w.isFocused(), focusable: w.isFocusable() })),
  );
}

export async function screenshot(app, name) {
  const b64 = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    // Hidden windows can keep stale tiles: force a full repaint, let it land, then capture.
    w.webContents.invalidate();
    await new Promise((r) => setTimeout(r, 400));
    const img = await w.webContents.capturePage();
    return img.toPNG().toString('base64');
  });
  const file = join(RESULTS, `${name}.png`);
  writeFileSync(file, Buffer.from(b64, 'base64'));
  return file;
}

export const td = (name) => join(ROOT, 'TestData', name);

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
