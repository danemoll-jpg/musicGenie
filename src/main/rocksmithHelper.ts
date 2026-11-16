// Runs the .NET Rocksmith helper (helpers/rocksmith/bin/MgRocksmith.exe) as a child process at
// Below Normal priority, talking JSON lines over stdin/stdout. One process, requests queued.
import { app } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { constants, setPriority } from 'node:os';
import { join } from 'node:path';

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

export function helperPath(): string {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'rocksmith', 'MgRocksmith.exe')]
    : [join(app.getAppPath(), 'helpers', 'rocksmith', 'bin', 'MgRocksmith.exe'), join(process.cwd(), 'helpers', 'rocksmith', 'bin', 'MgRocksmith.exe')];
  return candidates.find((p) => existsSync(p)) ?? candidates[0];
}

export class RocksmithHelper {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private buffer = '';
  private stderr = '';

  constructor(private readonly onProgress: (msg: string) => void) {}

  private start() {
    const exe = helperPath();
    if (!existsSync(exe)) {
      throw new Error(`The Rocksmith helper is missing (${exe}). Build it with: npm run helper`);
    }
    const p = spawn(exe, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    try {
      if (p.pid) setPriority(p.pid, constants.priority.PRIORITY_BELOW_NORMAL);
    } catch {
      /* not fatal */
    }
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', (d: string) => this.onData(d));
    p.stderr.setEncoding('utf8');
    p.stderr.on('data', (d: string) => {
      this.stderr = (this.stderr + d).slice(-4000);
    });
    p.on('exit', (code) => {
      const err = new Error(`The Rocksmith helper stopped (exit code ${code}). ${this.stderr.trim()}`);
      for (const w of this.pending.values()) w.reject(err);
      this.pending.clear();
      this.proc = null;
    });
    this.proc = p;
  }

  private onData(d: string) {
    this.buffer += d;
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      let msg: { id?: number; ok?: boolean; result?: unknown; error?: string; progress?: string };
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.progress) {
        this.onProgress(msg.progress);
        continue;
      }
      const w = msg.id !== undefined ? this.pending.get(msg.id) : undefined;
      if (!w) continue;
      this.pending.delete(msg.id!);
      if (msg.ok) w.resolve(msg.result);
      else w.reject(new Error(msg.error ?? 'Rocksmith helper error'));
    }
  }

  request<T = unknown>(cmd: string, args: unknown = {}): Promise<T> {
    if (!this.proc) this.start();
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.proc!.stdin.write(JSON.stringify({ id, cmd, args }) + '\n');
    });
  }

  stop() {
    this.proc?.kill();
    this.proc = null;
  }
}
