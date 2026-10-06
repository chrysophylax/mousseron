// Usage: node test/import.test.mjs path/to/grambank-v1.0.3.zip
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { importArchive } from '../js/grambank.js';
import { parseCsv } from '../js/csv.js';
import { roll } from '../js/generate.js';

assert.deepEqual(parseCsv('a,b\n"x,""y""\nz",\r\n1,2'), [{ a: 'x,"y"\nz', b: '' }, { a: '1', b: '2' }]);

const file = await readFile(process.argv[2]);
const t = performance.now();
const data = await importArchive(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
console.log(`imported in ${Math.round(performance.now() - t)} ms`);
assert.equal(data.features.length, 195);
assert.ok(data.features.every((f) => f.codes.length >= 2));
const gb020 = data.features.find((f) => f.id === 'GB020');
console.log('GB020', gb020.frequency, 'languages', data.languages.length);

const features = new Map(data.features.map((f) => [f.id, f]));
const ids = ['GB020', 'GB024', 'GB025', 'GB130'];
for (const mode of ['uniform', 'weighted', 'mix']) {
  const r = roll({ featureIds: ids, features, languages: data.languages, mode });
  assert.equal(r.entries.length, ids.length);
  for (const e of r.entries) assert.ok(features.get(e.featureId).codes.some((c) => c.value === e.value));
  console.log(mode, JSON.stringify(r));
}
const first = roll({ featureIds: ids, features, languages: data.languages, mode: 'mix' });
const locked = new Map([[first.entries[0].featureId, first.entries[0]]]);
const second = roll({ featureIds: ids, features, languages: data.languages, mode: 'uniform', locked });
assert.deepEqual({ ...second.entries[0], locked: false }, { ...first.entries[0], locked: false });
console.log('ok');
