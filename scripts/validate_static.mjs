import { readFileSync, statSync, readdirSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root = realpathSync(resolve(process.argv[2] || 'site/data/static'));
const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json')));
assert.equal(manifest.schema_version, 1);
assert.ok(manifest.data_date);
assert.ok(Object.keys(manifest.endpoints).length > 0);
for (const file of [manifest.database, manifest.queries, ...Object.values(manifest.endpoints)]) {
  const path = realpathSync(resolve(root, file));
  assert.ok(path.startsWith(root + sep), 'Data file outside generation');
  assert.ok(statSync(path).size > 0, `Missing data: ${file}`);
}
assert.ok(manifest.database.endsWith('.duckdb'));
const validator = fileURLToPath(new URL('./validate_public_db.py', import.meta.url));
function validateFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    assert.ok(!entry.isSymbolicLink(), 'Published data cannot contain symbolic links');
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) validateFiles(path);
    else {
      assert.ok(entry.isFile(), 'Unexpected published data object');
      assert.ok(statSync(path).size > 0, `Empty published file: ${entry.name}`);
      if (entry.name.toLowerCase().endsWith('.json')) JSON.parse(readFileSync(path, 'utf8'));
      if (entry.name.toLowerCase().endsWith('.duckdb')) {
        const result = spawnSync(process.env.PYTHON || 'python3', [validator, path], { encoding: 'utf8' });
        assert.equal(result.status, 0, result.error?.message || result.stderr || 'Public database validation failed');
      }
    }
  }
}
validateFiles(root);
if (process.env.STATIC_NIGHTLY_RUN_ID) {
  const provenance = JSON.parse(readFileSync(resolve(root, 'provenance.json')));
  assert.equal(provenance.source, 'nightly-live');
  assert.equal(provenance.database, 'data/cdc_surveillance.duckdb');
  assert.equal(provenance.run_id, process.env.STATIC_NIGHTLY_RUN_ID);
  assert.equal(provenance.run_attempt, process.env.STATIC_NIGHTLY_RUN_ATTEMPT);
  assert.equal(provenance.repository, process.env.GITHUB_REPOSITORY);
  assert.equal(provenance.commit, process.env.STATIC_NIGHTLY_COMMIT);
  assert.equal(provenance.version, manifest.version);
}
console.log(`Complete generation: ${Object.keys(manifest.endpoints).length} responses`);
