// The page keys each series member in JS (public/js/series-member.js); the
// release builder keys each record in Python (member_key). A drift between
// them would show a record as "Not in the corpus", so both must give the same
// key for every member of series.json, and no two members may share one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { memberKey } from '../../public/js/series-member.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const { series } = JSON.parse(readFileSync(resolve(HERE, 'series.json'), 'utf8'));

const PY = `
import json, sys
sys.path.insert(0, ${JSON.stringify(HERE)})
from build_release import SERIES, member_key
print(json.dumps({k: [member_key(k, m) for m in s["members"]] for k, s in SERIES.items()}))
`;

test('JS and Python key every series member alike', () => {
  const run = spawnSync('python3', ['-c', PY], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const python = JSON.parse(run.stdout);
  for (const [key, spec] of Object.entries(series)) {
    assert.deepEqual(spec.members.map((m) => memberKey(key, m)), python[key], key);
  }
});

test('no two members of a series share a key', () => {
  for (const [key, spec] of Object.entries(series)) {
    const keys = spec.members.map((m) => memberKey(key, m));
    assert.equal(new Set(keys).size, keys.length, key);
  }
});

// The plan's first key, year and speaker, collided on Washington's two 1790
// addresses. Without this, a regression to it passes the first test as long
// as both sides regress together.
test('a dated member is keyed by its date, not its year', () => {
  const both = series.sotu.members.filter((x) => x.year === 1790 && x.speaker === 'george-washington');
  assert.equal(both.length, 2);
  assert.notEqual(memberKey('sotu', both[0]), memberKey('sotu', both[1]));
});
