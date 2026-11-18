// One eFD session per run: a cookie jar held in memory, the agreement
// accepted once, one request every PACE_MS, and every response logged with
// its status and `server` header to tmp/trades/senate/requests.log.
//
// eFD is Django behind Akamai. Every answer eFD itself gives comes from
// `gunicorn`; a 403, 429 or 503, or an answer from any other server (Akamai's
// bot block is a 403 from AkamaiGHost, its outage page a 503 from
// AkamaiNetStorage), is the publisher or its CDN saying no. That stops the
// run with no retry and writes `blocked-until`, 24 hours on, which every later
// run respects. Check eFD by hand in a browser before deleting it.
//
// Redirects are read, never followed. The agreement answers 302 to /search/.
// A report eFD no longer serves answers 302 to /search/ too (`gone`). An
// expired session sends a request to /search/home/: one re-handshake per run,
// then the run stops. Phase 0 of the 2026-11-18 Senate eFD plan measured all
// of this (notes/2026-11-18-senate-efd-spike.md).
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const EXPECTED_SERVER = 'gunicorn';
export const STOP_STATUS = new Set([403, 429, 503]);
export const BLOCK_HOURS = 24;

export class Blocked extends Error {}

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function blockedUntil(path, now = Date.now()) {
  let text;
  try { text = await readFile(path, 'utf8'); } catch { return null; }
  const until = Date.parse(text.split('\n')[0]);
  return Number.isFinite(until) && until > now ? { until: new Date(until).toISOString(), why: text.split('\n').slice(1).join(' ').trim() } : null;
}

export function createSession({ base, ua, paceMs, logPath, blockedPath, fetchImpl = fetch, now = () => Date.now(), sleep = realSleep }) {
  const jar = new Map();
  let last = 0;
  let handshakes = 0;
  let requests = 0;

  const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  function absorb(res) {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }
  const log = async (line) => {
    await mkdir(dirname(logPath), { recursive: true });
    await appendFile(logPath, line + '\n');
  };
  async function stop(line, why) {
    const until = new Date(now() + BLOCK_HOURS * 3600e3).toISOString();
    await mkdir(dirname(blockedPath), { recursive: true });
    await writeFile(blockedPath, `${until}\n${why}: ${line}\n`);
    throw new Blocked(`eFD ${why}: ${line}. Stopped with no retry; blocked until ${until}. Check eFD by hand in a browser.`);
  }

  async function request(method, path, { form, referer, xhr } = {}) {
    const wait = last + paceMs - now();
    if (wait > 0) await sleep(wait);
    last = now();
    requests++;
    const headers = { 'User-Agent': ua, Accept: xhr ? 'application/json, text/javascript, */*; q=0.01' : 'text/html,application/xhtml+xml' };
    if (jar.size) headers.Cookie = cookieHeader();
    if (referer) headers.Referer = base + referer;
    let body;
    if (form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
      body = new URLSearchParams(form).toString();
    }
    if (xhr) {
      headers['X-Requested-With'] = 'XMLHttpRequest';
      if (jar.has('csrftoken')) headers['X-CSRFToken'] = jar.get('csrftoken');
    }
    const res = await fetchImpl(base + path, { method, headers, body, redirect: 'manual' });
    absorb(res);
    const text = await res.text();
    const loc = res.headers.get('location');
    const location = loc ? new URL(loc, base).pathname : null;
    const server = res.headers.get('server');
    const line = `${new Date(last).toISOString()} ${method} ${path} -> ${res.status}${location ? ` ${location}` : ''} ${text.length}b server=${server}`;
    await log(line);
    if (STOP_STATUS.has(res.status)) await stop(line, `HTTP ${res.status}`);
    if (server !== EXPECTED_SERVER) await stop(line, `answered by server "${server}"`);
    return { status: res.status, location, text };
  }

  async function handshake() {
    if (handshakes++ > 1) throw new Error('eFD sent the session back to the agreement twice in one run. Stopping.');
    const home = await request('GET', '/search/home/');
    const token = /name="csrfmiddlewaretoken" value="([^"]+)"/.exec(home.text)?.[1];
    if (home.status !== 200 || !token) throw new Error(`eFD home: HTTP ${home.status}${token ? '' : ', no agreement form'}`);
    const agree = await request('POST', '/search/home/', { form: { csrfmiddlewaretoken: token, prohibition_agreement: '1' }, referer: '/search/home/' });
    if (agree.status !== 302 || agree.location !== '/search/') throw new Error(`eFD agreement: HTTP ${agree.status} to ${agree.location}`);
    if (!jar.has('sessionid')) throw new Error('eFD agreement set no session cookie');
  }

  // A redirect to the agreement means the session ended: handshake again,
  // once per run, and repeat the request.
  async function withSession(fn) {
    if (!handshakes) await handshake();
    let r = await fn();
    if (r.status === 302 && r.location === '/search/home/') {
      await handshake();
      r = await fn();
      if (r.status === 302 && r.location === '/search/home/') throw new Error('eFD sent the session back to the agreement after a fresh one. Stopping.');
    }
    return r;
  }

  // The PTR list, one page. `form` is efd-index.mjs's indexForm().
  async function search(form) {
    const r = await withSession(() => request('POST', '/search/report/data/', {
      form: { ...form, csrfmiddlewaretoken: jar.get('csrftoken') ?? '' }, referer: '/search/', xhr: true,
    }));
    if (r.status !== 200) throw new Error(`eFD search: HTTP ${r.status}${r.location ? ` to ${r.location}` : ''}`);
    try { return JSON.parse(r.text); } catch { throw new Error(`eFD search: not JSON (${r.text.slice(0, 80)})`); }
  }

  // One report page: { html } when served, { gone: true } when eFD answers
  // a report link with its search page.
  async function view(path) {
    const r = await withSession(() => request('GET', path, { referer: '/search/' }));
    if (r.status === 200) return { html: r.text };
    if (r.status === 302 && r.location === '/search/') return { gone: true };
    throw new Error(`eFD ${path}: HTTP ${r.status}${r.location ? ` to ${r.location}` : ''}`);
  }

  return { handshake, search, view, stats: () => ({ requests, handshakes, cookies: [...jar.keys()] }) };
}
