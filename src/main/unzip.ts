// Unpacks downloaded ZIP archives (voicebanks, vocoder packages): stored or deflate, no ZIP64.
// Reads entry by entry so a 420 MB archive never sits in memory whole; refuses entries that would
// land outside the target folder.
import { closeSync, fstatSync, mkdirSync, openSync, readSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { inflateRawSync } from 'node:zlib';

export function unzipToDir(zipPath: string, dest: string): number {
  const fd = openSync(zipPath, 'r');
  try {
    const size = fstatSync(fd).size;
    const tailLen = Math.min(size, 65557);
    const tail = Buffer.alloc(tailLen);
    readSync(fd, tail, 0, tailLen, size - tailLen);
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('Not a ZIP file: ' + zipPath);
    const count = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOff = tail.readUInt32LE(eocd + 16);
    const cd = Buffer.alloc(cdSize);
    readSync(fd, cd, 0, cdSize, cdOff);
    const root = resolve(dest);
    let p = 0;
    let n = 0;
    for (let k = 0; k < count; k++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error('Damaged ZIP directory');
      const method = cd.readUInt16LE(p + 10);
      const csize = cd.readUInt32LE(p + 20);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      const local = cd.readUInt32LE(p + 42);
      const name = cd.subarray(p + 46, p + 46 + nameLen).toString('utf8');
      p += 46 + nameLen + extraLen + commentLen;
      const target = resolve(root, name);
      if (target !== root && !target.startsWith(root + sep)) throw new Error('Unsafe path in ZIP: ' + name);
      if (name.endsWith('/')) { mkdirSync(target, { recursive: true }); continue; }
      const lh = Buffer.alloc(30);
      readSync(fd, lh, 0, 30, local);
      const start = local + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
      const data = Buffer.alloc(csize);
      readSync(fd, data, 0, csize, start);
      mkdirSync(dirname(target), { recursive: true });
      if (method === 0) writeFileSync(target, data);
      else if (method === 8) writeFileSync(target, inflateRawSync(data));
      else throw new Error(`Unsupported ZIP compression (${method}) for ${name}`);
      n++;
    }
    return n;
  } finally {
    closeSync(fd);
  }
}
