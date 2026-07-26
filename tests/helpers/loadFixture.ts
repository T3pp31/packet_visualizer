import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '../fixtures');

export function loadFixture(name: string): ArrayBuffer {
  const data = readFileSync(join(fixturesDir, name));
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}
