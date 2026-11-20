// The network side of `npm run scotus -- fetch`: one client per host, which
// reads the host's robots.txt before its first request, keeps one request in
// flight, and waits MIN_PACE_MS (or the host's Crawl-delay, when longer)
// between the end of one request and the start of the next.
//
// A 403, 429 or 503 means the publisher said no. The host is marked blocked
// and every later request to it fails at once, whichever source asks; there
// is no retry. A robots.txt that answers anything but 200 or 404 blocks the
// host the same way.
//
// Redirects are followed once, and only within the host. Downloads stream to
// <file>.part and resume with a Range request when a .part is left over.
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { hashFile } from '../lib/archive.mjs';
import { UA, MIN_PACE_MS } from './sources.mjs';
import { parseRobots, robotsAllows } from './links.mjs';
import { sizeOf } from './manifest.mjs';

const STOP = new Set([403, 429, 503]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const headerObject = (res) => Object.fromEntries(res.headers);

export class Blocked extends Error {}

class HostClient {
  constructor(host) {
    this.host = host;
    this.queue = Promise.resolve();
    this.last = 0;
    this.paceMs = MIN_PACE_MS;
    this.robots = null;
    this.blocked = null;
  }

  // fn runs when the host is free and the pace has elapsed.
  #run(fn) {
    const p = this.queue.then(async () => {
      if (this.blocked) throw new Blocked(this.blocked);
      const wait = this.last + this.paceMs - Date.now();
      if (wait > 0) await sleep(wait);
      try {
        return await fn();
      } finally {
        this.last = Date.now();
      }
    });
    this.queue = p.catch(() => {});
    return p;
  }

  async #fetch(url, init = {}) {
    const opts = { ...init, headers: { 'User-Agent': UA, ...init.headers }, redirect: 'manual' };
    let res = await fetch(url, opts);
    let servedFrom = null;
    const to = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && to) {
      const next = new URL(to, url);
      if (next.host !== this.host) return { res, servedFrom, note: `redirect off host to ${next.href}` };
      await res.body?.cancel();
      servedFrom = next.href;
      res = await fetch(next.href, opts);
    }
    if (STOP.has(res.status)) {
      await res.body?.cancel();
      this.blocked = `${this.host} answered HTTP ${res.status} for ${url}; stopping this host, no retry`;
      throw new Blocked(this.blocked);
    }
    return { res, servedFrom };
  }

  async robotsFor(url, exception) {
    this.robotsLoad ??= this.#loadRobots();
    await this.robotsLoad;
    const path = new URL(url).pathname;
    if (!robotsAllows(this.robots, path) && !exception) {
      throw new Blocked(`${this.host}/robots.txt disallows ${path}, and the source records no exception`);
    }
  }

  async #loadRobots() {
    const r = await this.#run(async () => {
      const res = await fetch(`https://${this.host}/robots.txt`, { headers: { 'User-Agent': UA }, redirect: 'manual' });
      return { status: res.status, text: await res.text() };
    });
    if (r.status !== 200 && r.status !== 404) {
      this.blocked = `${this.host}/robots.txt answered HTTP ${r.status}; not fetching from this host`;
      throw new Blocked(this.blocked);
    }
    this.robots = parseRobots(r.status === 200 ? r.text : '', UA);
    if (this.robots.crawlDelay) this.paceMs = Math.max(MIN_PACE_MS, this.robots.crawlDelay * 1000);
    console.log(`${this.host}: robots.txt ${r.status}; pace ${this.paceMs / 1000} s`);
  }

  // Whole body in memory: list pages and small files.
  async get(url, { exception } = {}) {
    await this.robotsFor(url, exception);
    return this.#run(async () => {
      const { res, servedFrom, note } = await this.#fetch(url);
      const buf = Buffer.from(await res.arrayBuffer());
      return { status: res.status, headers: headerObject(res), buf, servedFrom, note };
    });
  }

  async head(url, { exception } = {}) {
    await this.robotsFor(url, exception);
    return this.#run(async () => {
      const { res, servedFrom, note } = await this.#fetch(url, { method: 'HEAD' });
      const len = res.headers.get('content-length');
      return {
        status: res.status,
        bytes: len === null ? null : Number(len),
        lastModified: res.headers.get('last-modified'),
        etag: res.headers.get('etag'),
        servedFrom,
        note,
        at: new Date().toISOString(),
      };
    });
  }

  // Streams url to path. Returns { bytes, sha256, headers, servedFrom }, or
  // { status } for any answer but 200 or 206.
  async download(url, path, { exception } = {}) {
    await this.robotsFor(url, exception);
    await mkdir(dirname(path), { recursive: true });
    const part = `${path}.part`;
    const got = await this.#run(async () => {
      const have = (await sizeOf(part)) ?? 0;
      const { res, servedFrom, note } = await this.#fetch(url, have ? { headers: { Range: `bytes=${have}-` } } : {});
      if (res.status !== 200 && res.status !== 206) {
        await res.body?.cancel();
        return { status: res.status, note };
      }
      const append = res.status === 206 && have > 0;
      await pipeline(Readable.fromWeb(res.body), createWriteStream(part, { flags: append ? 'a' : 'w' }));
      const total = res.status === 206
        ? Number(/\/(\d+)$/.exec(res.headers.get('content-range') ?? '')?.[1])
        : Number(res.headers.get('content-length'));
      return { status: res.status, headers: headerObject(res), servedFrom, total };
    });
    if (got.status !== 200 && got.status !== 206) return got;
    const { size, sha256 } = await hashFile(part, ['sha256']);
    if (Number.isFinite(got.total) && got.total > 0 && size !== got.total) {
      await rm(part, { force: true });
      throw new Error(`${url}: got ${size} bytes of ${got.total}; removed the partial file`);
    }
    await rename(part, path);
    return { bytes: size, sha256, headers: got.headers, servedFrom: got.servedFrom };
  }
}

const clients = new Map();
export function client(url) {
  const host = new URL(url).host;
  if (!clients.has(host)) clients.set(host, new HostClient(host));
  return clients.get(host);
}
