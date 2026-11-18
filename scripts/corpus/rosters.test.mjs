// rosters.json against speakers.json. A check that has never failed is not
// known to work, so each planted defect below must be named, and the real
// file must pass clean.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const load = async (name) => JSON.parse(await readFile(resolve(HERE, name), 'utf8'));

function problems(rosters, speakers) {
  const out = [];
  const hosts = Object.fromEntries(Object.entries(rosters.rosters)
    .map(([k, r]) => [k, new URL(r.source_url).host]));
  for (const slug of Object.keys(speakers)) {
    if (!Array.isArray(rosters.speakers[slug])) out.push(`${slug}: missing`);
  }
  for (const [slug, entries] of Object.entries(rosters.speakers)) {
    if (!(slug in speakers)) out.push(`${slug}: not in speakers.json`);
    const seen = new Set();
    for (const e of entries) {
      if (!(e.roster in hosts)) { out.push(`${slug}: unknown roster ${e.roster}`); continue; }
      if (typeof e.as !== 'string' || !e.as.trim()) out.push(`${slug}: empty as`);
      let url;
      try { url = new URL(e.url); } catch { out.push(`${slug}: bad url ${e.url}`); continue; }
      if (url.protocol !== 'https:') out.push(`${slug}: url not https`);
      if (url.host !== hosts[e.roster]) out.push(`${slug}: ${e.roster} url on ${url.host}`);
      const key = `${e.roster}\u0000${e.as}\u0000${e.url}`;
      if (seen.has(key)) out.push(`${slug}: duplicate ${e.roster} entry`);
      seen.add(key);
    }
  }
  for (const slug of rosters.bodies) {
    if (!(slug in speakers)) out.push(`${slug}: body not in speakers.json`);
    else if (rosters.speakers[slug]?.length) out.push(`${slug}: body has roster entries`);
  }
  return out;
}

const fresh = async () => [await load('rosters.json'), await load('speakers.json')];

test('rosters.json passes clean', async () => {
  const [rosters, speakers] = await fresh();
  assert.deepEqual(problems(rosters, speakers), []);
});

const PLANTED = {
  'a speaker with no entry': (r) => { delete r.speakers['abraham-lincoln']; return /abraham-lincoln: missing/; },
  'a slug speakers.json lacks': (r) => { r.speakers['road-runner'] = []; return /road-runner: not in speakers/; },
  'an unknown roster key': (r) => { r.speakers['abraham-lincoln'][0].roster = 'cabinet'; return /unknown roster cabinet/; },
  'a url on the wrong host': (r) => {
    r.speakers['hugo-black'].find((e) => e.roster === 'senate').url = 'https://history.house.gov/x';
    return /hugo-black: senate url on history\.house\.gov/;
  },
  'an empty as': (r) => { r.speakers['abraham-lincoln'][0].as = ' '; return /abraham-lincoln: empty as/; },
  'a duplicate entry': (r) => {
    const es = r.speakers['john-marshall'];
    es.push({ ...es[0] });
    return /john-marshall: duplicate supreme_court/;
  },
  'a body with entries': (r) => {
    r.speakers['continental-congress'] = [{ ...r.speakers['abraham-lincoln'][0] }];
    return /continental-congress: body has roster entries/;
  },
};

for (const [name, plant] of Object.entries(PLANTED)) {
  test(`names ${name}`, async () => {
    const [rosters, speakers] = await fresh();
    const want = plant(rosters);
    const got = problems(rosters, speakers);
    assert.ok(got.some((p) => want.test(p)), `expected ${want}, got ${JSON.stringify(got)}`);
  });
}
