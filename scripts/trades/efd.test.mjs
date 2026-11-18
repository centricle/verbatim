// The eFD session and list reader against a fake eFD: no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSession, blockedUntil, Blocked } from './efd.mjs';
import { parseIndexRow, readIndex, mergeLedger, goneFromEfd, indexForm } from './efd-index.mjs';

const BASE = 'https://efd.example';
const HOME = '<form><input type="hidden" name="csrfmiddlewaretoken" value="form-token"></form>';

function reply(status, body = '', { server = 'gunicorn', location, cookies = [] } = {}) {
  const headers = new Headers({ server });
  if (location) headers.set('location', location);
  for (const c of cookies) headers.append('set-cookie', c);
  return new Response(body, { status, headers });
}

// A fake eFD: `routes` maps "METHOD path" to a reply or a list of replies,
// taken in turn. Every call is recorded.
function fakeEfd(routes) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const key = `${init.method} ${new URL(url).pathname}`;
    calls.push({ key, headers: init.headers, body: init.body });
    const r = routes[key];
    if (!r) throw new Error(`unexpected ${key}`);
    return Array.isArray(r) ? r.shift()() : r();
  };
  return { fetchImpl, calls };
}

const agreement = () => ({
  'GET /search/home/': () => reply(200, HOME, { cookies: ['csrftoken=tok1; Path=/', 'bm_s=x; Path=/'] }),
  'POST /search/home/': () => reply(302, '', { location: '/search/', cookies: ['sessionid=s1; HttpOnly'] }),
});

async function session(routes, extra = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'efd-test-'));
  const fake = fakeEfd(routes);
  let clock = Date.parse('2026-11-18T12:00:00Z');
  const s = createSession({
    base: BASE, ua: 'test-agent', paceMs: 2000, fetchImpl: fake.fetchImpl,
    logPath: join(dir, 'requests.log'), blockedPath: join(dir, 'blocked-until'),
    now: () => clock, sleep: async (ms) => { clock += ms; }, ...extra,
  });
  return { s, dir, calls: fake.calls };
}

test('handshake once, then search with the jar, the CSRF token and the pace', async () => {
  const { s, calls, dir } = await session({
    ...agreement(),
    'POST /search/report/data/': () => reply(200, JSON.stringify({ recordsTotal: 0, data: [] })),
  });
  await s.search({ start: '0' });
  await s.search({ start: '100' });
  assert.deepEqual(calls.map((c) => c.key), ['GET /search/home/', 'POST /search/home/', 'POST /search/report/data/', 'POST /search/report/data/']);
  assert.match(calls[1].body, /csrfmiddlewaretoken=form-token/);
  assert.match(calls[1].body, /prohibition_agreement=1/);
  const search = calls[2];
  assert.equal(search.headers.Cookie, 'csrftoken=tok1; bm_s=x; sessionid=s1');
  assert.equal(search.headers['X-CSRFToken'], 'tok1');
  assert.equal(search.headers['User-Agent'], 'test-agent');
  assert.match(search.body, /csrfmiddlewaretoken=tok1/);
  const log = (await readFile(join(dir, 'requests.log'), 'utf8')).trim().split('\n');
  assert.equal(log.length, 4);
  assert.match(log[1], /POST \/search\/home\/ -> 302 \/search\/ 0b server=gunicorn/);
  // Two seconds apart on the fake clock.
  const times = log.map((l) => Date.parse(l.split(' ')[0]));
  assert.ok(times.slice(1).every((t, i) => t - times[i] >= 2000));
});

for (const [status, server] of [[403, 'AkamaiGHost'], [429, 'gunicorn'], [503, 'AkamaiNetStorage']]) {
  test(`HTTP ${status} stops the run and writes blocked-until`, async () => {
    const { s, dir } = await session({ ...agreement(), 'POST /search/report/data/': () => reply(status, 'no', { server }) });
    await assert.rejects(s.search({}), Blocked);
    const b = await blockedUntil(join(dir, 'blocked-until'), Date.parse('2026-11-18T13:00:00Z'));
    assert.equal(b.until, '2026-11-19T12:00:04.000Z');
    assert.match(b.why, new RegExp(`HTTP ${status}`));
    assert.equal(await blockedUntil(join(dir, 'blocked-until'), Date.parse('2026-11-19T12:00:07Z')), null);
  });
}

test('a 200 from any server but gunicorn is a CDN page: stop', async () => {
  const { s, dir } = await session({ 'GET /search/home/': () => reply(200, HOME, { server: 'AkamaiGHost' }) });
  await assert.rejects(s.handshake(), /answered by server "AkamaiGHost"/);
  assert.ok(await blockedUntil(join(dir, 'blocked-until'), Date.parse('2026-11-18T12:00:01Z')));
});

test('blockedUntil: no file, or a past date, is no block', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'efd-test-'));
  assert.equal(await blockedUntil(join(dir, 'none')), null);
  await writeFile(join(dir, 'b'), '2026-11-17T00:00:00.000Z\nHTTP 403: x\n');
  assert.equal(await blockedUntil(join(dir, 'b'), Date.parse('2026-11-18T00:00:00Z')), null);
});

test('view: 200 is the page, 302 to /search/ is gone', async () => {
  const { s } = await session({
    ...agreement(),
    'GET /search/view/ptr/a/': () => reply(200, '<h1>x</h1>'),
    'GET /search/view/ptr/b/': () => reply(302, '', { location: 'https://efd.example/search/' }),
  });
  assert.deepEqual(await s.view('/search/view/ptr/a/'), { html: '<h1>x</h1>' });
  assert.deepEqual(await s.view('/search/view/ptr/b/'), { gone: true });
});

test('an expired session gets one fresh agreement, then the run stops', async () => {
  const back = () => reply(302, '', { location: '/search/home/' });
  const { s, calls } = await session({
    'GET /search/home/': () => reply(200, HOME, { cookies: ['csrftoken=t'] }),
    'POST /search/home/': () => reply(302, '', { location: '/search/', cookies: ['sessionid=s'] }),
    'GET /search/view/ptr/a/': [back, () => reply(200, 'page')],
    'GET /search/view/ptr/b/': [back, back],
  });
  assert.deepEqual(await s.view('/search/view/ptr/a/'), { html: 'page' });
  assert.equal(calls.filter((c) => c.key === 'POST /search/home/').length, 2);
  await assert.rejects(s.view('/search/view/ptr/b/'), /agreement twice|after a fresh one/);
});

test('an agreement that does not land on /search/ stops', async () => {
  const { s } = await session({
    'GET /search/home/': () => reply(200, HOME),
    'POST /search/home/': () => reply(200, HOME),
  });
  await assert.rejects(s.handshake(), /agreement: HTTP 200/);
});

// The list reader.
const link = (kind, uuid, title) => `<a href="/search/view/${kind}/${uuid}/" target="_blank">${title}</a>`;
const U1 = 'CDFDAF62-18EA-4298-B0C5-62085A6EC3CD';
const U2 = '21941188-c04d-4713-8e6f-d954918e93fd';

test('parseIndexRow: lowercase key, link case kept, names and office as listed', () => {
  assert.deepEqual(parseIndexRow(['BENJAMIN L ', 'CARDIN', 'Senator', link('paper', U1, 'Periodic Transaction Report for 07/25/2012'), '07/25/2012']), {
    uuid: U1.toLowerCase(), link_uuid: U1, kind: 'paper', title: 'Periodic Transaction Report for 07/25/2012',
    first: 'BENJAMIN L', last: 'CARDIN', office: 'Senator', date_received: '2012-07-25',
  });
  assert.equal(parseIndexRow(['John', 'Boozman', 'Boozman, John (Senator)', link('ptr', U2, 'x (Amendment 1)'), '11/17/2026']).kind, 'electronic');
  assert.throws(() => parseIndexRow(['a', 'b', 'c', '<a href="/search/view/annual/x/">y</a>', '01/01/2020']), /link/);
  assert.throws(() => parseIndexRow(['a', 'b', 'c', link('ptr', U2, 't'), '13/45/2020']), /received date/);
});

test('indexForm asks for PTRs, oldest first, one page', () => {
  const f = indexForm(200, { pageSize: 100, since: '01/01/2012 00:00:00' });
  assert.equal(f.report_types, '[11]');
  assert.equal(f.start, '200');
  assert.equal(f.length, '100');
  assert.equal(f['order[0][column]'], '4');
  assert.equal(f['order[0][dir]'], 'asc');
});

const row = (u, d) => ['A', 'B', 'Senator', link('ptr', u, 'T'), d];
const uuid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

test('readIndex reads every page and holds the list to recordsTotal', async () => {
  const all = [1, 2, 3].map((n) => row(uuid(n), '01/0' + n + '/2020'));
  const pages = { 0: all.slice(0, 2), 2: all.slice(2) };
  const fake = { search: async (f) => ({ recordsTotal: 3, data: pages[f.start] ?? [] }) };
  const { total, entries } = await readIndex(fake, { pageSize: 2, since: 's' });
  assert.equal(total, 3);
  assert.deepEqual(entries.map((e) => e.uuid), [uuid(1), uuid(2), uuid(3)]);

  const dup = { search: async (f) => ({ recordsTotal: 3, data: f.start === '0' ? all.slice(0, 2) : [all[1]] }) };
  await assert.rejects(readIndex(dup, { pageSize: 2, since: 's' }), /twice/);
  let calls = 0;
  const shifting = { search: async () => ({ recordsTotal: 3 + calls++, data: all.slice(0, 2) }) };
  await assert.rejects(readIndex(shifting, { pageSize: 2, since: 's' }), /changed while being read/);
  const short = { search: async (f) => ({ recordsTotal: 3, data: f.start === '0' ? all.slice(0, 2) : [] }) };
  await assert.rejects(readIndex(short, { pageSize: 2, since: 's' }), /empty/);
});

test('mergeLedger keeps every entry; goneFromEfd names the unlisted', () => {
  const e = (n, d) => parseIndexRow(row(uuid(n), d));
  let { ledger, added } = mergeLedger([], [e(1, '01/01/2020'), e(2, '01/02/2020')], '2026-11-01T00:00:00.000Z');
  assert.equal(added, 2);
  ({ ledger, added } = mergeLedger(ledger, [e(2, '01/02/2020'), e(3, '01/03/2020')], '2026-11-18T00:00:00.000Z'));
  assert.equal(added, 1);
  assert.deepEqual(ledger.map((x) => [x.uuid.slice(-1), x.first_seen.slice(5, 10), x.last_seen.slice(5, 10)]), [
    ['1', '11-01', '11-01'], ['2', '11-01', '11-18'], ['3', '11-18', '11-18'],
  ]);
  assert.deepEqual(goneFromEfd(ledger).map((x) => x.uuid), [uuid(1)]);
});

test('mergeLedger keeps page_gone on an entry still listed', () => {
  const e = parseIndexRow(row(uuid(1), '01/01/2016'));
  let { ledger } = mergeLedger([], [e], '2026-11-18T00:00:00.000Z');
  ledger[0].page_gone = '2026-11-18T21:55:00.000Z';
  ({ ledger } = mergeLedger(ledger, [e], '2026-11-19T00:00:00.000Z'));
  assert.equal(ledger[0].page_gone, '2026-11-18T21:55:00.000Z');
  assert.equal(ledger[0].last_seen, '2026-11-19T00:00:00.000Z');
  ({ ledger } = mergeLedger([], [e], '2026-11-19T00:00:00.000Z'));
  assert.ok(!('page_gone' in ledger[0]));
});

test('purgeTargets: departed filers with no page held, nearest purge first', async () => {
  const { purgeTargets } = await import('./build.mjs');
  const e = (n, kind, o = {}) => ({ ...parseIndexRow(row(uuid(n), '01/01/2016')), kind, last_seen: '2026-11-18', ...o });
  const ledger = [
    e(1, 'electronic'),                                 // page held: skipped
    e(2, 'electronic', { page_gone: '2026-11-18T21:55:00.000Z' }),
    e(3, 'paper'),
    e(4, 'paper', { last: 'Runner' }),                  // still serving: skipped
    e(5, 'electronic', { last_seen: '2026-11-01' }),    // no longer listed
  ];
  const clock = (x) => (x.last === 'Runner' ? null : { left: x.uuid === uuid(3) ? '2017-02-08' : '2021-01-03', purge: x.uuid === uuid(3) ? '2023-02-08' : '2027-01-03' });
  const t = purgeTargets(ledger, clock, (u) => u === uuid(1), new Set([uuid(5)]), '2026-11-18');
  assert.deepEqual(t.map((x) => [x.uuid.slice(-1), x.kind, x.purge, x.state, x.ssw]), [
    ['3', 'paper', '2023-02-08', 'listed, past purge date', false],
    ['2', 'electronic', '2027-01-03', 'page gone', false],
    ['5', 'electronic', '2027-01-03', 'unlisted', true],
  ]);
  assert.match(t[0].url, /\/search\/view\/paper\//);
});
