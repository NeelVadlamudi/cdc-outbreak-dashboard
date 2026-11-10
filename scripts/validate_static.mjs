import { readFileSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(process.argv[2] || 'site/data/static');
const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json')));
assert.equal(manifest.schema_version, 1);
assert.ok(manifest.data_date);
assert.ok(Object.keys(manifest.endpoints).length > 0);
for (const file of [manifest.database, manifest.queries, ...Object.values(manifest.endpoints)]) {
  const path = resolve(root, file);
  assert.ok(path.startsWith(root + sep), 'Data file outside generation');
  assert.ok(statSync(path).size > 0, `Missing data: ${file}`);
}
console.log(`Complete generation: ${Object.keys(manifest.endpoints).length} responses`);
