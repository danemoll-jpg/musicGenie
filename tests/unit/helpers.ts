import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const TEST_DATA = join(__dirname, '..', '..', 'TestData');

export function readTestFile(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(TEST_DATA, name)));
}
