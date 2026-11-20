// Parity and behavior checks: the local `netlify dev` (verbatim.test, port
// 7033) against verbatim.fyi, explorer by explorer: rows, deep links, back
// button, aborts, the error line, escaping.
// Usage: node scripts/qa/parity.mjs [outfile]   (default tmp/qa/parity-results.json)
// Both sides call production's /api, so a run spends function invocations;
// it is the check for an explorer change, not a routine one.
// Explorers marked localOnly have no production page yet: their cases run on
// local alone (deep link, back button, controls), with no comparison to prod.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright';

const LOCAL = 'http://localhost:7033';
const PROD = 'https://verbatim.fyi';
const OUT = process.argv[2] || resolve(import.meta.dirname, '../../tmp/qa/parity-results.json');
// Every HTML page, for the masthead checks.
const PAGES = ['/', '/about.html', '/corpus/', '/corpus/contents/', '/amendments/', '/over-time/', '/compas/', '/trades/', '/incidents/', '/finance/', '/qi/', '/crashes/', '/executive/', '/clemency/', '/disbursements/house/', '/disbursements/senate/', '/vs/'];

const EXPLORERS = {
  // Compared against production again since the House trades push (3644e20).
  trades: { prefix: 'trades', api: '/api/trades', statsSelects: ['member'], cases: [
    [{ select: 'member', index: 5 }, { select: 'year', value: '2019' }],
    [{ q: 'Gore' }],
    [{ select: 'type', value: 'Purchase' }, { next: 2 }],
    [{ select: 'chamber', value: 'house' }, { select: 'type', value: 'Sale (Full)' }, { next: 1 }],
  ] },
  compas: { prefix: 'compas', api: '/api/compas', statsSelects: [], cases: [
    [{ select: 'race', index: 1 }, { select: 'score', index: 3 }],
    [{ q: 'smith' }],
    [{ select: 'recid', index: 1 }, { next: 3 }],
  ] },
  incidents: { prefix: 'incidents', api: '/api/incidents', statsSelects: ['state'], cases: [
    [{ select: 'state', index: 5 }, { select: 'armed', index: 1 }],
    [{ q: 'john' }],
    [{ select: 'year', index: 2 }, { next: 2 }],
  ] },
  finance: { prefix: 'fec', route: 'finance', api: '/api/finance', statsSelects: ['state'], cases: [
    [{ select: 'party', index: 1 }, { select: 'office', index: 1 }],
    [{ select: 'state', index: 20 }],
    [{ q: 'smith' }, { next: 1 }],
  ] },
  qi: { prefix: 'qi', api: '/api/qi', statsSelects: ['circuit', 'ruling', 'violation'], cases: [
    [{ select: 'circuit', index: 3 }, { select: 'ruling', index: 1 }],
    [{ q: 'police' }],
    [{ select: 'violation', index: 2 }, { next: 1 }],
  ] },
  crashes: { prefix: 'crashes', api: '/api/crashes', statsSelects: ['make', 'state', 'year', 'severity'], cases: [
    [{ select: 'system', value: 'ADS' }, { select: 'state', value: 'CA' }],
    [{ q: 'pedestrian' }],
    [{ select: 'make', value: 'TESLA' }, { select: 'year', value: '2024' }, { next: 2 }],
    [{ select: 'period', value: 'archive' }, { select: 'severity', value: 'Fatality' }],
  ] },
  executive: { prefix: 'executive', api: '/api/executive', statsSelects: ['president', 'relation'], cases: [
    [{ select: 'president', value: 'barack-obama' }, { select: 'type', value: 'executive_order' }],
    [{ q: 'tariff' }],
    [{ input: 'from', value: '2001' }, { input: 'to', value: '2001' }, { next: 1 }],
    [{ select: 'relation', value: 'Revoked by' }, { select: 'president', value: 'joe-biden' }],
  ] },
  clemency: { prefix: 'clemency', api: '/api/clemency', statsSelects: ['president', 'year'], cases: [
    [{ select: 'president', value: 'richard-nixon' }, { select: 'type', value: 'pardon' }],
    [{ q: 'Capitol' }],
    [{ select: 'year', value: '2025' }, { next: 2 }],
    [{ select: 'type', value: 'commutation' }, { select: 'president', value: 'joe-biden' }, { q: 'Texas' }],
  ] },
  // Local only until it ships. Totals past 10,000 are capped ("10,000+").
  disbursements: { prefix: 'disbursements', api: '/api/disbursements', statsSelects: ['quarter', 'category'], cases: [
    [{ select: 'quarter', value: '2026q2' }, { select: 'category', value: 'TRAVEL' }],
    // { sort } clicks a heading (2026-11-19, replaced the order select); the
    // second click on Amount sorts smallest first.
    [{ q: 'citibank' }, { sort: 'amount' }],
    [{ input: 'office', value: 'OFFICE OF THE SPEAKER' }, { next: 2 }],
    [{ select: 'category', value: 'PERSONNEL COMPENSATION' }, { sort: 'amount' }, { next: 1 }],
    [{ select: 'quarter', value: '2025q3' }, { sort: 'amount' }, { sort: 'amount' }],
    [{ sort: 'date' }, { next: 1 }],
  ] },
  corpus: { prefix: 'corpus', api: '/api/corpus', statsSelects: ['speaker', 'genre'], cases: [
    [{ select: 'speaker', value: 'abraham-lincoln' }, { select: 'genre', value: 'speech' }],
    [{ q: '"general welfare"' }],
    [{ input: 'from', value: '1860' }, { input: 'to', value: '1869' }, { next: 1 }],
    [{ select: 'collection', value: 'voices' }, { q: 'liberty' }],
    [{ select: 'series', value: 'sotu' }, { q: 'tariff' }, { input: 'from', value: '1889' }, { input: 'to', value: '1889' }],
    [{ select: 'series', value: 'inaugural' }, { next: 1 }],
  ] },
};

const isSearch = (api) => (r) => r.url().includes(api + '?') && !r.url().includes('action=stats');
const isStats = (api) => (r) => r.url().includes(api + '?') && r.url().includes('action=stats');
const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30))));

async function done(promise, page) {
  const res = await promise;
  await res.finished();
  await settle(page);
  return res;
}

async function open(ctx, url, ex) {
  const page = await ctx.newPage();
  const search = page.waitForResponse(isSearch(ex.api), { timeout: 30000 });
  const stats = page.waitForResponse(isStats(ex.api), { timeout: 30000 });
  await page.goto(url);
  await done(search, page);
  await done(stats, page);
  for (const key of ex.statsSelects) {
    await page.waitForFunction((k) => document.getElementById(`filter-${k}`).options.length > 1, key, { timeout: 15000 });
  }
  return page;
}

function snapshot(page, p) {
  return page.evaluate((p) => {
    const pager = document.getElementById(`${p}-pagination`);
    return {
      info: document.getElementById(`${p}-results-info`).textContent,
      pager: pager.classList.contains('hidden') ? null : document.getElementById(`${p}-page-info`).textContent,
      rows: [...document.querySelectorAll(`#${p}-results tr`)].map((tr) =>
        [...tr.cells].map((td) => td.innerText.trim() + (td.title ? ` [title=${td.title}]` : '')).join(' | ')),
      classes: [...document.querySelectorAll(`#${p}-results tr`)].slice(0, 3).map((tr) =>
        [...tr.querySelectorAll('[class]')].map((e) => `${e.tagName}.${e.className}`).join(' ')),
      selects: Object.fromEntries([...document.querySelectorAll('select[id^="filter-"], input[id^="filter-"]')].map((s) => [s.id, s.value])),
      q: document.getElementById(`${p}-search`).value,
    };
  }, p);
}

async function step(page, ex, s, onPush = async () => {}) {
  if (s.next) {
    for (let i = 0; i < s.next; i++) {
      const disabled = await page.$eval(`#${ex.prefix}-next`, (b) => b.disabled || b.closest('.hidden') !== null);
      if (disabled) return 'next-disabled';
      const r = page.waitForResponse(isSearch(ex.api));
      await page.click(`#${ex.prefix}-next`);
      await done(r, page);
      await onPush();
    }
    return 'ok';
  }
  if (s.sort) {
    const r = page.waitForResponse(isSearch(ex.api));
    await page.click(`th[data-sort="${s.sort}"] .sort-button`);
    await done(r, page);
    await onPush();
    return 'ok';
  }
  if (s.input) {
    const r = page.waitForResponse(isSearch(ex.api));
    await page.fill(`#filter-${s.input}`, s.value);
    await page.press(`#filter-${s.input}`, 'Enter');
    await done(r, page);
    await onPush();
    return 'ok';
  }
  if (s.q != null) {
    const r = page.waitForResponse(isSearch(ex.api));
    await page.fill(`#${ex.prefix}-search`, s.q);
    await page.press(`#${ex.prefix}-search`, 'Enter');
    await done(r, page);
    await onPush();
    return 'ok';
  }
  const value = s.value ?? await page.$eval(`#filter-${s.select}`, (el, i) => el.options[i].value, s.index);
  const r = page.waitForResponse(isSearch(ex.api));
  await page.selectOption(`#filter-${s.select}`, value);
  await done(r, page);
  await onPush();
  return 'ok';
}

const fmtInfo = (snap) => ({ ...snap, info: snap.info.replace(/of (\d{4,}) /, (_, n) => `of ${Number(n).toLocaleString('en-US')} `) });
const diff = (a, b) => {
  const out = [];
  for (const k of ['info', 'pager', 'rows', 'classes']) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) {
      if (k === 'rows') {
        const i = a.rows.findIndex((r, j) => r !== b.rows[j]);
        out.push(`rows differ (len ${a.rows.length} vs ${b.rows.length}); first at ${i}: ${JSON.stringify(a.rows[i])} vs ${JSON.stringify(b.rows[i])}`);
      } else out.push(`${k}: ${JSON.stringify(a[k])} vs ${JSON.stringify(b[k])}`);
    }
  }
  return out;
};

const results = [];
const log = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 300) : ''}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });

for (const [name, ex] of Object.entries(EXPLORERS)) {
  const route = ex.route || name;
  // Initial load parity
  if (!ex.localOnly) try {
    const [l, p] = [await open(ctx, `${LOCAL}/${route}/`, ex), await open(ctx, `${PROD}/${route}/`, ex)];
    const d = diff(await snapshot(l, ex.prefix), fmtInfo(await snapshot(p, ex.prefix)));
    log(`${name} initial vs prod`, d.length === 0, d.join('; '));
    await l.close(); await p.close();
  } catch (e) { log(`${name} initial vs prod`, false, e.message); }

  for (const [ci, steps] of ex.cases.entries()) {
    const label = `${name} case ${ci + 1} ${JSON.stringify(steps)}`;
    try {
      const l = await open(ctx, `${LOCAL}/${route}/`, ex);
      const p = ex.localOnly ? null : await open(ctx, `${PROD}/${route}/`, ex);
      const history = [await snapshot(l, ex.prefix)];
      for (const s of steps) {
        const a = await step(l, ex, s, async () => history.push(await snapshot(l, ex.prefix)));
        if (!p) { if (a !== 'ok') throw new Error(`step outcome ${a}`); continue; }
        const b = await step(p, ex, s);
        if (a !== b) throw new Error(`step outcome ${a} vs ${b}`);
      }
      const local = history.at(-1);
      if (p) {
        const prod = fmtInfo(await snapshot(p, ex.prefix));
        const d = diff(local, prod);
        log(`${label} UI vs prod`, d.length === 0, d.join('; '));
      } else {
        log(`${label} UI (local only)`, local.rows.length > 0 && /^Showing /.test(local.info), local.info);
      }

      // Deep link: reopen the URL the UI produced
      const url = l.url();
      const deep = await open(ctx, url, ex);
      const ds = await snapshot(deep, ex.prefix);
      const dd = diff(ds, local);
      const selOk = JSON.stringify(ds.selects) === JSON.stringify(local.selects) && ds.q === local.q;
      log(`${label} deep link ${url.replace(LOCAL, '')}`, dd.length === 0 && selOk, [...dd, selOk ? '' : `controls ${JSON.stringify([ds.selects, ds.q])} vs ${JSON.stringify([local.selects, local.q])}`].filter(Boolean).join('; '));
      await deep.close();

      // Back button: one step back restores the previous state
      const r = l.waitForResponse(isSearch(ex.api));
      await l.goBack();
      await done(r, l);
      const back = await snapshot(l, ex.prefix);
      const prev = history.at(-2);
      const bd = diff(back, prev);
      const bsel = JSON.stringify(back.selects) === JSON.stringify(prev.selects);
      log(`${label} back`, bd.length === 0 && bsel, [...bd, bsel ? '' : `controls ${JSON.stringify(back.selects)} vs ${JSON.stringify(prev.selects)}`].filter(Boolean).join('; '));
      await l.close(); if (p) await p.close();
    } catch (e) { log(label, false, e.message); }
  }
}

// ---- Behavior checks (local only) ----
const T = EXPLORERS.trades;

// Rapid filter changes: earlier searches aborted, final render matches the final filter.
try {
  const page = await open(ctx, `${LOCAL}/trades/`, T);
  const aborted = [];
  page.on('requestfailed', (req) => { if (isSearch(T.api)(req)) aborted.push(req.failure()?.errorText); });
  const last = page.waitForResponse((r) => isSearch(T.api)(r) && r.url().includes('year=2017'));
  await page.evaluate(() => {
    const sel = document.getElementById('filter-year');
    for (const y of ['2019', '2018', '2017']) { sel.value = y; sel.dispatchEvent(new Event('change')); }
  });
  await done(last, page);
  await page.waitForTimeout(500);
  const got = await snapshot(page, 'trades');
  const ref = await open(ctx, `${LOCAL}/trades/?year=2017`, T);
  const want = await snapshot(ref, 'trades');
  const d = diff(got, want);
  log('trades rapid changes abort stale searches', aborted.length === 2 && d.length === 0 && page.url().endsWith('?year=2017'), `aborted=${JSON.stringify(aborted)} url=${page.url()} ${d.join('; ')}`);
  await page.close(); await ref.close();
} catch (e) { log('trades rapid changes', false, e.message); }

// Stats requested once per load.
try {
  const page = await ctx.newPage();
  let n = 0;
  page.on('request', (r) => { if (isStats(T.api)(r)) n++; });
  await page.goto(`${LOCAL}/trades/`);
  await page.waitForTimeout(3000);
  log('trades stats fetched once', n === 1, `count=${n}`);
  await page.close();
} catch (e) { log('trades stats once', false, e.message); }

// Page past the end lands on the last page, computed from the live total so a
// refresh does not break the check.
try {
  const { total } = await (await fetch(`${LOCAL}${T.api}?action=stats`)).json();
  const last = Math.ceil(total / 50);
  const page = await ctx.newPage();
  const settled = page.waitForResponse((r) => isSearch(T.api)(r) && r.url().includes(`offset=${(last - 1) * 50}`));
  await page.goto(`${LOCAL}/trades/?page=9999`);
  await done(settled, page);
  const s = await snapshot(page, 'trades');
  log('trades page=9999 clamps to last page', s.pager === `Page ${last.toLocaleString()} of ${last.toLocaleString()}` && page.url().endsWith(`?page=${last}`), `${s.pager} ${page.url()} want ${last}`);
  await page.close();
} catch (e) { log('trades page clamp', false, e.message); }

// A link from before the House joined (?senator= with the old table's string)
// is rewritten to member= plus chamber=senate and still filters to that senator.
try {
  const page = await ctx.newPage();
  const settled = page.waitForResponse((r) => isSearch(T.api)(r) && r.url().includes('member='));
  await page.goto(`${LOCAL}/trades/?senator=Ron+L+Wyden`);
  await done(settled, page);
  const u = new URL(page.url());
  const names = await page.$$eval('#trades-results .cell-name', (els) => els.map((e) => e.innerText.trim()));
  log('trades old ?senator= link filters', !u.searchParams.has('senator') && u.searchParams.get('chamber') === 'senate' && !!u.searchParams.get('member') && names.length > 0 && names.every((n) => n.startsWith('Sen.') && n.includes('Wyden')), `url=${u.search} rows=${names.length} first=${names[0]}`);
  await page.close();
} catch (e) { log('trades old ?senator= link', false, e.message); }

// ?chamber=house shows House rows only, and the lede's noun follows it.
try {
  const page = await open(ctx, `${LOCAL}/trades/?chamber=house`, T);
  const names = await page.$$eval('#trades-results .cell-name', (els) => els.map((e) => e.innerText.trim()));
  const noun = await page.$eval('[data-stat="noun"]', (e) => e.textContent);
  log('trades ?chamber=house shows House rows', names.length > 0 && names.every((n) => n.startsWith('Rep.')) && noun !== 'members of Congress', `rows=${names.length} first=${names[0]} noun=${noun}`);
  await page.close();
} catch (e) { log('trades ?chamber=house', false, e.message); }

// Error state: trades shows errorText; incidents (no errorText) keeps the table.
for (const [name, ex, want] of [['trades', T, 'Could not load trades. Try again.'], ['incidents', EXPLORERS.incidents, null]]) {
  try {
    const page = await open(ctx, `${LOCAL}/${name}/`, ex);
    const before = await snapshot(page, ex.prefix);
    await page.route((u) => isSearch(ex.api)({ url: () => u.toString() }), (route) => route.fulfill({ status: 500, body: 'boom' }));
    await page.fill(`#${ex.prefix}-search`, 'zzz');
    await page.press(`#${ex.prefix}-search`, 'Enter');
    await page.waitForTimeout(800);
    const after = await snapshot(page, ex.prefix);
    const ok = want ? after.info === want && after.rows.length === 0 && after.pager === null
      : after.info === before.info && after.rows.length === before.rows.length;
    log(`${name} failed search`, ok, `info=${JSON.stringify(after.info)} rows=${after.rows.length}`);
    await page.close();
  } catch (e) { log(`${name} failed search`, false, e.message); }
}

// Escaping: markup in a value renders as text and does not run.
try {
  const page = await ctx.newPage();
  await page.route((u) => isSearch(T.api)({ url: () => u.toString() }), (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ total: 1, rows: [{ transaction_date: '2019-01-02', filed_date: '2019-01-20', chamber: 'senate', member: '<img src=x onerror="window.__xss=1">', url: 'https://filing.example/"><b>x</b>', ticker: 'AT&T', asset_description: 'W.L. Gore &amp; Associates &lt;b&gt;', type: 'Purchase', amount: '$1,001 - $15,000', owner: 'Self' }] }),
  }));
  await page.goto(`${LOCAL}/trades/`);
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => ({ xss: window.__xss, imgs: document.querySelectorAll('#trades-results img').length, bs: document.querySelectorAll('#trades-results b').length, row: document.querySelector('#trades-results tr')?.innerText }));
  log('trades escaping', r.xss === undefined && r.imgs === 0 && r.bs === 0 && r.row.includes('<img src=x') && r.row.includes('W.L. Gore & Associates <b>') && r.row.includes('AT&T'), r);
  await page.close();
} catch (e) { log('trades escaping', false, e.message); }

// Chart click sets the filter and the URL.
try {
  const page = await open(ctx, `${LOCAL}/trades/`, T);
  await page.waitForSelector('#viz-trades-by-year svg rect', { timeout: 15000 });
  const r = page.waitForResponse(isSearch(T.api));
  const bars = page.locator('#viz-trades-by-year svg rect');
  const count = await bars.count();
  await bars.nth(Math.floor(count / 2)).click({ force: true });
  await done(r, page);
  const s = await snapshot(page, 'trades');
  log('trades chart click sets filter + URL', !!s.selects['filter-year'] && page.url().includes(`year=${s.selects['filter-year']}`), `year=${s.selects['filter-year']} url=${page.url()}`);
  await page.close();
} catch (e) { log('trades chart click', false, e.message); }

// ---- crashes (local only until it ships) ----
const C = EXPLORERS.crashes;

try {
  const page = await open(ctx, `${LOCAL}/crashes/`, C);
  await page.route((u) => isSearch(C.api)({ url: () => u.toString() }), (route) => route.fulfill({ status: 500, body: 'boom' }));
  await page.fill('#crashes-search', 'zzz');
  await page.press('#crashes-search', 'Enter');
  await page.waitForTimeout(800);
  const after = await snapshot(page, 'crashes');
  log('crashes failed search', after.info === 'Could not load reports. Try again.' && after.rows.length === 0 && after.pager === null, `info=${JSON.stringify(after.info)} rows=${after.rows.length}`);
  await page.close();
} catch (e) { log('crashes failed search', false, e.message); }

try {
  const page = await ctx.newPage();
  await page.route((u) => isSearch(C.api)({ url: () => u.toString() }), (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ total: 1, rows: [{ report_id: '1-1', report_version: 1, system: 'ADS', incident_date: 'AUG-2026', make: '<img src=x onerror="window.__xss=1">', model: 'X', model_year: 2026, reporting_entity: 'A&B', city: 'Coeur d\uFFFD??Alene', state: 'ID', crash_with: 'SUV', injury_severity: 'Minor', narrative: 'Line one.\n\n<b>Line two</b> &amp; more' }] }),
  }));
  await page.goto(`${LOCAL}/crashes/`);
  await page.waitForTimeout(1500);
  await page.locator('#crashes-results details summary').click();
  const r = await page.evaluate(() => ({ xss: window.__xss, imgs: document.querySelectorAll('#crashes-results img').length, bs: document.querySelectorAll('#crashes-results b').length, open: document.querySelector('#crashes-results details').open, summary: document.querySelector('#crashes-results summary').textContent, row: document.querySelector('#crashes-results tr').innerText }));
  log('crashes escaping + narrative opens', r.xss === undefined && r.imgs === 0 && r.bs === 0 && r.open && r.summary === 'Line one.\n\n<b>Line two</b> & more' && r.row.includes('<img src=x') && r.row.includes('A&B'), r);
  await page.close();
} catch (e) { log('crashes escaping', false, e.message); }

for (const [viz, key] of [['viz-by-month', 'year'], ['viz-by-make', 'make'], ['viz-by-state', 'state'], ['viz-by-severity', 'severity']]) {
  try {
    const page = await open(ctx, `${LOCAL}/crashes/`, C);
    await page.waitForSelector(`#${viz} svg rect`, { timeout: 15000, state: 'attached' });
    const bars = page.locator(`#${viz} svg rect`);
    const count = await bars.count();
    const r = page.waitForResponse(isSearch(C.api));
    // Month rects come in three layers (ADS, ADAS, Other); pick an ADS bar near the end.
    await bars.nth(viz === 'viz-by-month' ? Math.floor(count / 3) - 3 : 1).click({ force: true });
    await done(r, page);
    const s = await snapshot(page, 'crashes');
    const v = s.selects[`filter-${key}`];
    log(`crashes ${viz} click sets ${key}`, !!v && new URL(page.url()).searchParams.get(key) === v, `${key}=${v} url=${page.url()}`);
    await page.close();
  } catch (e) { log(`crashes ${viz} click`, false, e.message); }
}

// ---- corpus (local only until it ships) ----
const K = EXPLORERS.corpus;

try {
  const page = await open(ctx, `${LOCAL}/corpus/`, K);
  await page.route((u) => isSearch(K.api)({ url: () => u.toString() }), (route) => route.fulfill({ status: 500, body: 'boom' }));
  await page.fill('#corpus-search', 'zzz');
  await page.press('#corpus-search', 'Enter');
  await page.waitForTimeout(800);
  const after = await snapshot(page, 'corpus');
  log('corpus failed search', after.info === 'Could not load records. Try again.' && after.rows.length === 0 && after.pager === null, `info=${JSON.stringify(after.info)} rows=${after.rows.length}`);
  await page.close();
} catch (e) { log('corpus failed search', false, e.message); }

// A snippet that holds markup inside a match, an entity and a stray marker.
try {
  const page = await ctx.newPage();
  await page.route((u) => isSearch(K.api)({ url: () => u.toString() }), (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ total: 1, rows: [{ id: 'a'.repeat(64), speaker: 'x', speaker_name: 'A&B <b>bold</b>', date: '1787-09-17', date_precision: 'day', collection: 'core', genre: 'speech', type: 'speech', title: '<img src=x onerror="window.__xss=1">', chars: 999, snippet: 'before \u0001<script>window.__xss=2</script>\u0002 after &amp; more \u0002stray' }] }),
  }));
  await page.goto(`${LOCAL}/corpus/`);
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => {
    const tr = document.querySelector('#corpus-results tr');
    return { xss: window.__xss, imgs: tr.querySelectorAll('img').length, scripts: tr.querySelectorAll('script').length, bs: tr.querySelectorAll('b').length,
      marks: [...tr.querySelectorAll('mark')].map((m) => m.textContent), excerpt: tr.querySelector('.cell-excerpt').textContent, row: tr.innerText };
  });
  log('corpus escaping + highlight', r.xss === undefined && r.imgs === 0 && r.scripts === 0 && r.bs === 0
    && JSON.stringify(r.marks) === JSON.stringify(['<script>window.__xss=2</script>'])
    && r.excerpt === 'before <script>window.__xss=2</script> after & more stray'
    && r.row.includes('<img src=x') && r.row.includes('A&B <b>bold</b>'), r);
  await page.close();
} catch (e) { log('corpus escaping', false, e.message); }

for (const [viz, keys, nth] of [['viz-by-decade', ['from', 'to'], -3], ['viz-by-genre', ['genre'], 1], ['viz-speaker-span', ['speaker'], 1]]) {
  try {
    const page = await open(ctx, `${LOCAL}/corpus/`, K);
    await page.waitForSelector(`#${viz} svg rect`, { timeout: 15000, state: 'attached' });
    const bars = page.locator(`#${viz} svg rect`);
    const count = await bars.count();
    const r = page.waitForResponse(isSearch(K.api));
    // Decade rects come in two layers (core, voices); pick a core bar near the end.
    await bars.nth(nth < 0 ? Math.floor(count / 2) + nth : nth).click({ force: true });
    await done(r, page);
    const s = await snapshot(page, 'corpus');
    const url = new URL(page.url());
    const ok = keys.every((k) => !!s.selects[`filter-${k}`] && url.searchParams.get(k) === s.selects[`filter-${k}`])
      && (keys[0] !== 'from' || Number(s.selects['filter-to']) === Number(s.selects['filter-from']) + 9);
    const pushes = await page.evaluate(() => history.length);
    log(`corpus ${viz} click sets ${keys.join('+')}`, ok && s.rows.length > 0, `${keys.map((k) => `${k}=${s.selects[`filter-${k}`]}`).join(' ')} url=${page.url()} history=${pushes}`);
    await page.close();
  } catch (e) { log(`corpus ${viz} click`, false, e.message); }
}

// Every speaker /vs/ links to resolves on /corpus/.
try {
  const vs = await (await fetch(`${LOCAL}/vs/debates.json`)).json();
  const slugs = [...new Set(vs.pairings.flatMap((p) => p.speakers))];
  const bad = [];
  for (const slug of slugs) {
    const page = await open(ctx, `${LOCAL}/corpus/?speaker=${slug}`, K);
    const s = await snapshot(page, 'corpus');
    if (!(s.rows.length > 0 && s.selects['filter-speaker'] === slug)) bad.push(`${slug}: rows=${s.rows.length} select=${s.selects['filter-speaker']}`);
    await page.close();
  }
  log(`corpus resolves all ${slugs.length} /vs/ speakers`, bad.length === 0, bad.join('; '));
} catch (e) { log('corpus vs speakers', false, e.message); }

// Record view: a title opens the whole record; back returns to the list as it was.
try {
  const page = await open(ctx, `${LOCAL}/corpus/?speaker=winston-churchill&q=parliament`, K);
  const list = await snapshot(page, 'corpus');
  const got = page.waitForResponse((r) => r.url().includes('action=get'));
  await page.click('#corpus-results tr a');
  await done(got, page);
  const rec = await page.evaluate(() => ({
    title: document.getElementById('record-title').textContent, doc: document.title,
    paras: document.querySelectorAll('#record-text p').length,
    meta: [...document.querySelectorAll('#record-meta dt')].map((d) => d.textContent),
    source: document.querySelector('#record-meta a.source-link')?.href,
    indexHidden: document.getElementById('corpus-index').classList.contains('hidden'),
  }));
  log('corpus record view', rec.title && rec.doc.startsWith(rec.title) && rec.paras > 0 && rec.meta.includes('Source') && rec.meta.includes('Rights') && /^https?:/.test(rec.source || '') && rec.indexHidden, rec);
  const back = page.waitForResponse(isSearch(K.api));
  await page.goBack();
  await done(back, page);
  const again = await snapshot(page, 'corpus');
  log('corpus back from record', diff(again, list).length === 0 && JSON.stringify(again.selects) === JSON.stringify(list.selects) && again.q === list.q, diff(again, list).join('; '));
  await page.close();
} catch (e) { log('corpus record view', false, e.message); }

for (const [label, id, check] of [
  // Hansard left the corpus in the 2026-11-18 licensing pass; a Gutenberg
  // record carries PG's notice and the license link instead.
  ['corpus record: Gutenberg shows attribution and license link', '1746a40f5d4131eb7b3332287c0c21489fd56977f586e4d8a5db2f94db5d0264',
    (r) => r.meta.includes('Attribution') && r.dd.some((t) => t.includes('The Full Project Gutenberg License'))],
  ['corpus record: amendment shows ratified, proposed, certified', 'a1b7bf728bb6d7cd29e200ac7730877b498f708af8899b5b2d6e731afed935ce',
    (r) => ['Ratified', 'Proposed', 'Certified'].every((t) => r.meta.includes(t))],
  ['corpus record: Gutenberg text reflowed', 'bb39dd21a3b5fb5a548e233759c8315c85c1a4687f360e578b283c8fa1dd0aa0',
    (r) => r.paras > 0 && r.breaks === 0],
  ['corpus record: unknown id', 'f'.repeat(64), (r) => r.status === 'No record has this address.'],
]) {
  try {
    const page = await ctx.newPage();
    const got = page.waitForResponse((r) => r.url().includes('action=get'));
    await page.goto(`${LOCAL}/corpus/?id=${id}`);
    await done(got, page);
    const r = await page.evaluate(() => ({
      status: document.getElementById('record-status').textContent,
      meta: [...document.querySelectorAll('#record-meta dt')].map((d) => d.textContent),
      dd: [...document.querySelectorAll('#record-meta dd')].map((d) => d.textContent),
      paras: document.querySelectorAll('#record-text p').length,
      breaks: [...document.querySelectorAll('#record-text p')].filter((p) => p.textContent.includes('\n')).length,
    }));
    log(label, check(r), r);
    await page.close();
  } catch (e) { log(label, false, e.message); }
}

// ---- executive (local only until it ships) ----
const X = EXPLORERS.executive;

try {
  const page = await open(ctx, `${LOCAL}/executive/`, X);
  await page.route((u) => isSearch(X.api)({ url: () => u.toString() }), (route) => route.fulfill({ status: 500, body: 'boom' }));
  await page.fill('#executive-search', 'zzz');
  await page.press('#executive-search', 'Enter');
  await page.waitForTimeout(800);
  const after = await snapshot(page, 'executive');
  log('executive failed search', after.info === 'Could not load documents. Try again.' && after.rows.length === 0 && after.pager === null, `info=${JSON.stringify(after.info)} rows=${after.rows.length}`);
  await page.close();
} catch (e) { log('executive failed search', false, e.message); }

// A row with markup in its title and president, no signing date, and a snippet
// holding markup inside a match, an entity and a stray marker.
try {
  const page = await ctx.newPage();
  await page.route((u) => isSearch(X.api)({ url: () => u.toString() }), (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ total: 1, rows: [{ id: 'a'.repeat(64), document_number: '1', type: 'executive_order', number: '<i>1</i>', president: 'x', president_name: 'A&B <b>bold</b>', signing_date: null, publication_date: '2001-01-01', citation: null, title: '<img src=x onerror="window.__xss=1">', chars: 9, snippet: 'before \u0001<script>window.__xss=2</script>\u0002 after &amp; more \u0002stray' }] }),
  }));
  await page.goto(`${LOCAL}/executive/`);
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => {
    const tr = document.querySelector('#executive-results tr');
    return { xss: window.__xss, imgs: tr.querySelectorAll('img').length, scripts: tr.querySelectorAll('script').length, bs: tr.querySelectorAll('b, i').length,
      marks: [...tr.querySelectorAll('mark')].map((m) => m.textContent), snippet: tr.querySelector('.cell-snippet').textContent, row: tr.innerText };
  });
  log('executive escaping + highlight', r.xss === undefined && r.imgs === 0 && r.scripts === 0 && r.bs === 0
    && JSON.stringify(r.marks) === JSON.stringify(['<script>window.__xss=2</script>'])
    && r.snippet === 'before <script>window.__xss=2</script> after & more stray'
    && r.row.includes('<img src=x') && r.row.includes('A&B <b>bold</b>') && r.row.includes('No signing date') && r.row.includes('<i>1</i>'), r);
  await page.close();
} catch (e) { log('executive escaping', false, e.message); }

for (const [viz, keys, pick] of [['viz-by-year', ['from', 'to'], (n) => Math.floor(n / 2) - 3], ['viz-by-president', ['president'], () => 1]]) {
  try {
    const page = await open(ctx, `${LOCAL}/executive/`, X);
    await page.waitForSelector(`#${viz} svg rect`, { timeout: 15000, state: 'attached' });
    const bars = page.locator(`#${viz} svg rect`);
    const r = page.waitForResponse(isSearch(X.api));
    await bars.nth(pick(await bars.count())).click({ force: true });
    await done(r, page);
    const s = await snapshot(page, 'executive');
    const url = new URL(page.url());
    const ok = keys.every((k) => !!s.selects[`filter-${k}`] && url.searchParams.get(k) === s.selects[`filter-${k}`])
      && (keys[0] !== 'from' || s.selects['filter-to'] === s.selects['filter-from']);
    log(`executive ${viz} click sets ${keys.join('+')}`, ok && s.rows.length > 0, `${keys.map((k) => `${k}=${s.selects[`filter-${k}`]}`).join(' ')} url=${page.url()}`);
    await page.close();
  } catch (e) { log(`executive ${viz} click`, false, e.message); }
}

// Record view: a title opens the whole document; back returns to the list as it was.
try {
  const page = await open(ctx, `${LOCAL}/executive/?president=joe-biden&relation=Revoked+by`, X);
  const list = await snapshot(page, 'executive');
  const got = page.waitForResponse((r) => r.url().includes('action=get'));
  await page.click('#executive-results tr a');
  await done(got, page);
  const rec = await page.evaluate(() => ({
    title: document.getElementById('record-title').textContent, doc: document.title,
    paras: document.querySelectorAll('#record-text p').length,
    meta: [...document.querySelectorAll('#record-meta dt')].map((d) => d.textContent),
    corpus: document.querySelector('#record-meta a[href^="/corpus/?speaker="]')?.getAttribute('href'),
    notes: !document.getElementById('record-notes').classList.contains('hidden'),
    relations: [...document.querySelectorAll('#record-notes-body .fr-relation')].map((s) => s.textContent),
    indexHidden: document.getElementById('executive-index').classList.contains('hidden'),
  }));
  log('executive record view', rec.title && rec.doc.startsWith(rec.title) && rec.paras > 0 && ['Signed', 'Published', 'Source', 'Speeches'].every((t) => rec.meta.includes(t))
    && rec.corpus === '/corpus/?speaker=joe-biden' && rec.notes && rec.relations.includes('Revoked by:') && rec.indexHidden, rec);
  const back = page.waitForResponse(isSearch(X.api));
  await page.goBack();
  await done(back, page);
  const again = await snapshot(page, 'executive');
  log('executive back from record', diff(again, list).length === 0 && JSON.stringify(again.selects) === JSON.stringify(list.selects) && again.q === list.q, diff(again, list).join('; '));
  await page.close();
} catch (e) { log('executive record view', false, e.message); }

// A note's link opens the order it names.
try {
  const page = await ctx.newPage();
  let got = page.waitForResponse((r) => r.url().includes('action=get'));
  await page.goto(`${LOCAL}/executive/?id=059a162ceee8a320966077875d1078378f0321bf3d3eee6ca98cd9c569526eea`);
  await done(got, page);
  const links = await page.evaluate(() => [...document.querySelectorAll('#record-notes-body a')].map((a) => a.textContent));
  got = page.waitForResponse((r) => r.url().includes('action=get'));
  await page.click('#record-notes-body a >> text=EO 13771');
  await done(got, page);
  const kicker = await page.evaluate(() => document.getElementById('record-kicker').textContent);
  log('executive note link resolves', links.length === 8 && kicker === 'Executive Order 13771', { links, kicker });
  await page.close();
} catch (e) { log('executive note link', false, e.message); }

for (const [label, where, check] of [
  ['executive record: correction of a document not here', 'c95b31e6348ce2c07f76b9623c66a27653afaffe758c5866b29c2c2b635fdb63',
    (r) => r.meta.includes('Correction of') && r.dd.includes('FR Doc. 2010-27668') && r.metaLinks.every((h) => !h.startsWith('/executive/')) && r.signed === 'No signing date'],
  ['executive record: text reflowed', '059a162ceee8a320966077875d1078378f0321bf3d3eee6ca98cd9c569526eea', (r) => r.paras > 3 && r.breaks === 0],
  ['executive record: unknown id', null, (r) => r.status === 'No document has this address.'],
]) {
  try {
    const id = where ?? 'f'.repeat(64);
    const page = await ctx.newPage();
    const got = page.waitForResponse((r) => r.url().includes('action=get'));
    await page.goto(`${LOCAL}/executive/?id=${id}`);
    await done(got, page);
    const r = await page.evaluate(() => ({
      status: document.getElementById('record-status').textContent,
      signed: document.getElementById('record-date').textContent,
      meta: [...document.querySelectorAll('#record-meta dt')].map((d) => d.textContent),
      dd: [...document.querySelectorAll('#record-meta dd')].map((d) => d.textContent),
      metaLinks: [...document.querySelectorAll('#record-meta a')].map((a) => a.getAttribute('href')),
      paras: document.querySelectorAll('#record-text p').length,
      breaks: [...document.querySelectorAll('#record-text p')].filter((p) => p.textContent.includes('\n')).length,
    }));
    log(label, check(r), r);
    await page.close();
  } catch (e) { log(label, false, e.message); }
}

// Console errors on each local page load.
for (const [name, ex] of Object.entries(EXPLORERS)) {
  try {
    const page = await ctx.newPage();
    const errs = [];
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(`${LOCAL}/${ex.route || name}/`);
    await page.waitForTimeout(2500);
    log(`${name} no console errors`, errs.length === 0, errs.join(' | '));
    await page.close();
  } catch (e) { log(`${name} console`, false, e.message); }
}

// ---- clemency (local only until it ships) ----
const CL = EXPLORERS.clemency;

try {
  const page = await open(ctx, `${LOCAL}/clemency/`, CL);
  await page.route((u) => isSearch(CL.api)({ url: () => u.toString() }), (route) => route.fulfill({ status: 500, body: 'boom' }));
  await page.fill('#clemency-search', 'zzz');
  await page.press('#clemency-search', 'Enter');
  await page.waitForTimeout(800);
  const after = await snapshot(page, 'clemency');
  log('clemency failed search', after.info === 'Could not load entries. Try again.' && after.rows.length === 0 && after.pager === null, `info=${JSON.stringify(after.info)} rows=${after.rows.length}`);
  await page.close();
} catch (e) { log('clemency failed search', false, e.message); }

// An entry with markup in every printed field, and a title row whose FR link
// carries markup in its number.
try {
  const page = await ctx.newPage();
  await page.route((u) => isSearch(CL.api)({ url: () => u.toString() }), (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ total: 2, rows: [
      { id: 'x:1', grant_date: '2001-01-01', type: 'pardon', kind: 'entry', name: '<img src=x onerror="window.__xss=1">', president_name: 'A&B <b>bold</b>',
        district: '<i>D</i>', offense: '<script>window.__xss=2</script>', sentence: 'a &amp; b', terms: null, sentence_began: null, commuted_to: null,
        group_description: null, note: '<u>n</u>', warrant_url: 'https://www.justice.gov/pardon/w.pdf', warrant_label: '<b>W</b>', source_url: 'https://www.justice.gov/pardon/x', executive: null },
      { id: 'x:2', grant_date: '2025-01-20', type: null, kind: 'title', name: 'Group <em>grant</em>', president_name: 'P', district: null, offense: null,
        sentence: null, terms: null, sentence_began: null, commuted_to: null, group_description: 'G & <b>g</b>', note: null, warrant_url: null, warrant_label: null,
        source_url: 'https://www.justice.gov/pardon/y', executive: { id: 'f'.repeat(64), type: 'proclamation', number: '<i>1</i>' } },
    ] }),
  }));
  await page.goto(`${LOCAL}/clemency/`);
  await page.waitForTimeout(1500);
  // Row details (2026-11-19): the offense is the last data cell; the rest
  // opens as a full-width row beneath, via the row's toggle.
  await page.locator('#clemency-results tr').first().locator('.row-toggle').click();
  const r = await page.evaluate(() => {
    const [a, ad, b] = document.querySelectorAll('#clemency-results tr');
    return { xss: window.__xss, tags: document.querySelectorAll('#clemency-results img, #clemency-results script, #clemency-results b, #clemency-results i, #clemency-results u, #clemency-results em').length,
      open: ad.classList.contains('row-detail'), summary: a.cells[5].textContent, row: `${a.innerText}\n${ad.innerText}`,
      warrant: ad.querySelector('a[href$="w.pdf"]')?.textContent, tSummary: b.cells[5].textContent, tType: b.querySelector('.tx-type').textContent,
      tLink: [b.querySelector('.grant-link')?.getAttribute('href'), b.querySelector('.grant-link')?.textContent], tRow: b.innerText };
  });
  log('clemency escaping + title row', r.xss === undefined && r.tags === 0 && r.open && r.summary === '<script>window.__xss=2</script>'
    && r.row.includes('<img src=x') && r.row.includes('A&B <b>bold</b>') && r.row.includes('<i>D</i>') && r.row.includes('a & b') && r.row.includes('<u>n</u>') && r.row.includes('Jan 1, 2001')
    && r.warrant === '<b>W</b>' && r.tSummary === '—' && r.tType === 'Listed by title'
    && r.tLink[0] === `/executive/?id=${'f'.repeat(64)}` && r.tLink[1] === 'Proclamation <i>1</i>' && r.tRow.includes('Group <em>grant</em>'), r);
  await page.close();
} catch (e) { log('clemency escaping', false, e.message); }

// Stacked bars: a year or term with none of a type draws a zero-height rect,
// which cannot be clicked, so click the tallest segment.
for (const [viz, key] of [['viz-by-term', 'president'], ['viz-by-year', 'year']]) {
  try {
    const page = await open(ctx, `${LOCAL}/clemency/`, CL);
    await page.waitForSelector(`#${viz} svg rect`, { timeout: 15000, state: 'attached' });
    const bars = page.locator(`#${viz} svg rect`);
    const tallest = await page.$$eval(`#${viz} svg rect`, (rs) => rs.reduce((m, x, i, a) => (x.getBoundingClientRect().height > a[m].getBoundingClientRect().height ? i : m), 0));
    const r = page.waitForResponse(isSearch(CL.api));
    r.catch(() => {});
    await bars.nth(tallest).click({ force: true });
    await done(r, page);
    const s = await snapshot(page, 'clemency');
    const v = s.selects[`filter-${key}`];
    log(`clemency ${viz} click sets ${key}`, !!v && new URL(page.url()).searchParams.get(key) === v && s.rows.length > 0, `${key}=${v} url=${page.url()}`);
    await page.close();
  } catch (e) { log(`clemency ${viz} click`, false, e.message); }
}

// Dek reach, read off the stats; the J6 title row links its proclamation, and back returns to the list.
try {
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push(e.message));
  const search = page.waitForResponse(isSearch(CL.api));
  const stats = page.waitForResponse(isStats(CL.api));
  await page.goto(`${LOCAL}/clemency/?q=Capitol`);
  await done(search, page); const st = await (await done(stats, page)).json();
  const reach = await page.evaluate(() => document.getElementById('clemency-reach').textContent);
  log('clemency dek reach', reach === ` ${st.total.toLocaleString('en-US')} entries, granted ${st.date_range.min.slice(0, 4)} to ${st.date_range.max.slice(0, 4)}.`, { reach, total: st.total });
  const list = await snapshot(page, 'clemency');
  const link = page.locator('#clemency-results .grant-link').first();
  const text = await link.textContent();
  const got = page.waitForResponse((r) => r.url().includes('/api/executive') && r.url().includes('action=get'));
  await link.click();
  await done(got, page);
  const kicker = await page.evaluate(() => document.getElementById('record-kicker').textContent);
  log('clemency title row opens its proclamation', text === 'Proclamation 10887' && kicker === 'Proclamation 10887' && page.url().includes('/executive/?id='), { text, kicker, url: page.url() });
  const back = page.waitForResponse(isSearch(CL.api));
  await page.goBack();
  await done(back, page);
  const again = await snapshot(page, 'clemency');
  log('clemency back from proclamation', diff(again, list).length === 0 && again.q === 'Capitol', diff(again, list).join('; '));
  log('clemency no console errors', errs.length === 0, errs.join(' | '));
  await page.close();
} catch (e) { log('clemency link + back', false, e.message); }

// The menu entry: desktop Record panel and the mobile menu on every page; current on /clemency/.
try {
  const bad = [];
  for (const p of PAGES) {
    const body = await (await fetch(`${LOCAL}${p}`)).text();
    const nav = body.split('<main')[0];
    const n = (nav.match(/<a [^>]*href="\/clemency\/"[^>]*>Clemency<\/a>/g) || []).length;
    const current = (nav.match(/<a [^>]*aria-current="page"[^>]*href="\/clemency\/"|<a [^>]*href="\/clemency\/"[^>]*aria-current="page"/g) || []).length;
    if (n !== 2 || (p === '/clemency/' ? current !== 2 : current !== 0)) bad.push(`${p} n=${n} current=${current}`);
  }
  log(`clemency menu entry on all ${PAGES.length} pages`, bad.length === 0, bad.join('; '));
} catch (e) { log('clemency menu entry', false, e.message); }

// ---- disbursements (local only until it ships) ----
const DB = EXPLORERS.disbursements;

try {
  const page = await open(ctx, `${LOCAL}/disbursements/`, DB);
  await page.route((u) => isSearch(DB.api)({ url: () => u.toString() }), (route) => route.fulfill({ status: 500, body: 'boom' }));
  await page.fill('#disbursements-search', 'zzz');
  await page.press('#disbursements-search', 'Enter');
  await page.waitForTimeout(800);
  const after = await snapshot(page, 'disbursements');
  log('disbursements failed search', after.info === 'Could not load rows. Try again.' && after.rows.length === 0 && after.pager === null, `info=${JSON.stringify(after.info)} rows=${after.rows.length}`);
  await page.close();
} catch (e) { log('disbursements failed search', false, e.message); }

// Markup in every text field, a payee-less subtotal row, and a date filed
// as no calendar date.
try {
  const page = await ctx.newPage();
  const base = { chamber: 'house', unit: 'house-2026q2', period_start: '2026-04-01', period_end: '2026-06-30', org_year: 2026, funding_year: 'LY2026', start_date: null, end_date: null, document: null };
  await page.route((u) => isSearch(DB.api)({ url: () => u.toString() }), (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ total: 2, total_capped: false, rows: [
      { ...base, row_number: 7, organization: '2026 <b>ORG</b>', office: '<i>OFFICE</i>', program: '<script>window.__xss=2</script>', category: 'A&amp;B <u>c</u>', row_kind: 'detail',
        transaction_date: null, payee: '<img src=x onerror="window.__xss=1">', description: 'AT&T <em>d</em>', amount: -1234.5, document: '"><b>x</b>',
        extras: { vendor_id: '<b>9</b>', dates_as_filed: { transaction_date: '14-MAR-0026' }, unquoted_comma: 'payee' }, source_ref: 'https://www.house.gov/x.csv#row=7"><b>y</b>' },
      { ...base, row_number: 8, organization: '2026 OFFICE', office: 'OFFICE', program: 'GENERAL EXPENDITURES', category: 'PERSONNEL COMPENSATION', row_kind: 'subtotal',
        transaction_date: null, payee: null, description: 'PERSONNEL COMPENSATION TOTALS:', amount: 1000, extras: {}, source_ref: 'https://www.house.gov/x.csv#row=8' },
    ] }),
  }));
  await page.goto(`${LOCAL}/disbursements/`);
  await page.waitForTimeout(1500);
  // Row details (2026-11-19): the program is the last data cell; the rest
  // opens as a full-width row beneath, via the row's toggle.
  await page.locator('#disbursements-results tr').first().locator('.row-toggle').click();
  const r = await page.evaluate(() => {
    const [a, ad, b] = document.querySelectorAll('#disbursements-results tr');
    return { xss: window.__xss, tags: document.querySelectorAll('#disbursements-results img, #disbursements-results script, #disbursements-results b, #disbursements-results i, #disbursements-results u, #disbursements-results em').length,
      open: ad.classList.contains('row-detail'), summary: a.cells[5].textContent, row: `${a.innerText}\n${ad.innerText}`, href: ad.querySelector('dl a').getAttribute('href'),
      bDate: b.cells[0].textContent, bLead: b.querySelector('.cell-lead').textContent.trim(), info: document.getElementById('disbursements-results-info').textContent };
  });
  log('disbursements escaping + subtotal row', r.xss === undefined && r.tags === 0 && r.open && r.summary === '<script>window.__xss=2</script>'
    && r.row.includes('<img src=x') && r.row.includes('AT&T <em>d</em>') && r.row.includes('<i>OFFICE</i>') && r.row.includes('A&B <u>c</u>') && r.row.includes('-$1,234.50')
    && r.row.includes('14-MAR-0026') && r.row.includes('Transaction date: 14-MAR-0026') && r.row.includes('Rejoined in vendor name') && r.row.includes('<b>9</b>')
    && r.href === 'https://www.house.gov/x.csv#row=7"><b>y</b>' && r.bDate === 'Apr–Jun 2026' && r.bLead === 'PERSONNEL COMPENSATION TOTALS:' && r.info === 'Showing 1–2 of 2 rows', r);
  await page.close();
} catch (e) { log('disbursements escaping', false, e.message); }

// A capped total reads 10,000+, and paging stops at page 200: a link past it lands there.
try {
  const page = await open(ctx, `${LOCAL}/disbursements/`, DB);
  const first = await snapshot(page, 'disbursements');
  log('disbursements capped count', first.info === 'Showing 1–50 of 10,000+ rows' && first.pager === 'Page 1 of 200', first);
  await page.close();
  const p2 = await ctx.newPage();
  const settled = p2.waitForResponse((r) => isSearch(DB.api)(r) && r.url().includes('page=200'));
  await p2.goto(`${LOCAL}/disbursements/?page=9999`);
  await done(settled, p2);
  const s = await snapshot(p2, 'disbursements');
  const nextDisabled = await p2.$eval('#disbursements-next', (b) => b.disabled);
  log('disbursements page=9999 lands on page 200', s.pager === 'Page 200 of 200' && s.info === 'Showing 9,951–10,000 of 10,000+ rows' && s.rows.length === 50 && nextDisabled && p2.url().endsWith('?page=200'), `${s.info} ${s.pager} rows=${s.rows.length} ${p2.url()}`);
  await p2.close();
} catch (e) { log('disbursements capped count', false, e.message); }

// Figure 1 and 2 set their filters; Figure 3 sets none.
for (const [viz, key] of [['viz-by-quarter', 'quarter'], ['viz-by-category', 'category']]) {
  try {
    const page = await open(ctx, `${LOCAL}/disbursements/`, DB);
    await page.waitForSelector(`#${viz} svg rect.bar`, { timeout: 15000 });
    const bars = page.locator(`#${viz} svg rect.bar`);
    const r = page.waitForResponse(isSearch(DB.api));
    r.catch(() => {});
    await bars.nth(2).click({ force: true });
    await done(r, page);
    const s = await snapshot(page, 'disbursements');
    const v = s.selects[`filter-${key}`];
    log(`disbursements ${viz} click sets ${key}`, !!v && new URL(page.url()).searchParams.get(key) === v && s.rows.length > 0, `${key}=${v} url=${page.url()}`);
    await page.close();
  } catch (e) { log(`disbursements ${viz} click`, false, e.message); }
}
try {
  const page = await open(ctx, `${LOCAL}/disbursements/`, DB);
  await page.waitForSelector('#viz-top-payees svg rect.bar', { timeout: 15000 });
  let n = 0;
  page.on('request', (r) => { if (isSearch(DB.api)(r)) n++; });
  await page.locator('#viz-top-payees svg rect.bar').first().click({ force: true });
  await page.waitForTimeout(600);
  log('disbursements Figure 3 sets no filter', n === 0 && !page.url().includes('?'), `searches=${n} url=${page.url()}`);
  await page.close();
} catch (e) { log('disbursements Figure 3', false, e.message); }

// Office combobox (public/js/combobox.js, replaced the datalist 2026-11-19):
// a click opens every office, typing narrows without searching, a pick
// searches once, half a name left behind reverts, clear removes the filter.
try {
  const errs = [];
  const page = await open(ctx, `${LOCAL}/disbursements/`, DB);
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push(e.message));
  const st = await (await fetch(`${LOCAL}${DB.api}?action=stats`)).json();
  await page.waitForTimeout(800);
  await page.click('#filter-office');
  const count = await page.$$eval('#filter-office-listbox [role=option]', (o) => o.length);
  log('disbursements office list on click', count === st.office_list.length, `${count} vs ${st.office_list.length}`);
  let n = 0;
  page.on('request', (r) => { if (isSearch(DB.api)(r)) n++; });
  await page.keyboard.type('pelosi', { delay: 5 });
  await page.waitForTimeout(400);
  const typed = n;
  const narrowed = await page.$$eval('#filter-office-listbox [role=option]', (o) => o.map((x) => x.textContent));
  const r = page.waitForResponse(isSearch(DB.api));
  await page.click('#filter-office-listbox [role=option]');
  await done(r, page);
  const s = await snapshot(page, 'disbursements');
  const pick = new URL(page.url()).searchParams.get('office');
  log('disbursements office pick searches once, typing does not', typed === 0 && n === 1 && narrowed.length === 1 && pick === narrowed[0] && s.rows.length > 0, `typed=${typed} n=${n} pick=${pick} ${s.info}`);
  await page.click('#filter-office');
  await page.keyboard.type('hon');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(400);
  const kept = await page.$eval('#filter-office', (i) => i.value);
  log('disbursements office half a name reverts', kept === pick && n === 1, `value=${kept} n=${n}`);
  const r2 = page.waitForResponse(isSearch(DB.api));
  await page.click('.combobox .field-clear');
  await done(r2, page);
  log('disbursements office clear', !new URL(page.url()).searchParams.has('office') && (await page.$eval('#filter-office', (i) => i.value)) === '', page.url());
  log('disbursements no console errors', errs.length === 0, errs.join(' | '));
  await page.close();
} catch (e) { log('disbursements office combobox', false, e.message); }

// Dek reach, read off the stats.
try {
  const page = await ctx.newPage();
  const stats = page.waitForResponse(isStats(DB.api));
  await page.goto(`${LOCAL}/disbursements/house/`);
  const st = await (await done(stats, page)).json();
  await page.waitForFunction(() => document.querySelector('.disbursements-reach').textContent !== '');
  const reach = await page.evaluate(() => document.querySelector('.disbursements-reach').textContent);
  log('disbursements dek reach', reach === ` ${Number(st.total).toLocaleString('en-US')} rows, January 2016 to June 2026.` && st.period_range.min === '2016-01-01' && st.period_range.max === '2026-06-30', { reach, range: st.period_range });
  await page.close();
} catch (e) { log('disbursements dek reach', false, e.message); }

// The slowest search found (text, by amount): time it through the local function.
try {
  const times = [];
  for (const q of ['citibank', 'verizon', 'travel']) {
    const t0 = performance.now();
    const res = await fetch(`${LOCAL}${DB.api}?q=${q}&sortBy=amount&page=1&pageSize=50`);
    await res.json();
    times.push(`${q} ${((performance.now() - t0) / 1000).toFixed(2)} s`);
  }
  log('disbursements text search by amount under 8 s', times.every((t) => parseFloat(t.split(' ')[1]) < 8), times.join(', '));
} catch (e) { log('disbursements timing', false, e.message); }

// The menu entry: desktop Record panel and the mobile menu on every page,
// pointing at the House page since the chamber split (2026-11-20); current on
// both chamber pages.
try {
  const bad = [];
  for (const p of PAGES) {
    const body = await (await fetch(`${LOCAL}${p}`)).text();
    const nav = body.split('<main')[0];
    const n = (nav.match(/<a [^>]*href="\/disbursements\/house\/"[^>]*>Disbursements<\/a>/g) || []).length;
    const current = (nav.match(/<a [^>]*aria-current="page"[^>]*href="\/disbursements\/house\/"|<a [^>]*href="\/disbursements\/house\/"[^>]*aria-current="page"/g) || []).length;
    if (n !== 2 || (p.startsWith('/disbursements/') ? current !== 2 : current !== 0)) bad.push(`${p} n=${n} current=${current}`);
  }
  log(`disbursements menu entry on all ${PAGES.length} pages`, bad.length === 0, bad.join('; '));
} catch (e) { log('disbursements menu entry', false, e.message); }

// ---- /over-time/ and /amendments/ (local only until they ship) ----
// Not explorers: no table, no createExplorer. Deep link, submit, back, forward.
try {
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push(e.message));
  const terms = () => page.waitForResponse((r) => r.url().includes('/api/corpus?action=terms'));
  const lines = () => page.evaluate(() => ({
    paths: [...document.querySelectorAll('#viz-term-rate path')].filter((p) => p.style.stroke.includes('series')).length,
    bars: document.querySelectorAll('#viz-term-rate rect.bar').length,
    inputs: [...document.querySelectorAll('input[name=t]')].map((i) => i.value).join(','),
    series: document.getElementById('series').value,
    rows: document.querySelectorAll('#counts-table tbody tr').length,
  }));
  let got = terms();
  await page.goto(`${LOCAL}/over-time/?series=inaugural&t=liberty&t=union`);
  await done(got, page);
  await page.waitForSelector('#viz-term-rate svg g');
  const deep = await lines();
  log('over-time deep link', deep.paths === 2 && deep.series === 'inaugural' && deep.inputs === 'liberty,union,' && deep.rows > 0, deep);
  await page.fill('input[aria-label="Third word"]', 'freedom');
  got = terms();
  await page.click('#terms-form button[type=submit]');
  await done(got, page);
  const three = await lines();
  log('over-time submit pushes', page.url().endsWith('?series=inaugural&t=liberty&t=union&t=freedom') && three.paths === 3, `${page.url()} ${JSON.stringify(three)}`);
  got = terms();
  await page.goBack();
  await done(got, page);
  const back = await lines();
  log('over-time back restores', back.paths === 2 && back.inputs === 'liberty,union,' && page.url().endsWith('?series=inaugural&t=liberty&t=union'), `${page.url()} ${JSON.stringify(back)}`);
  got = terms();
  await page.goForward();
  await done(got, page);
  log('over-time forward', (await lines()).paths === 3, page.url());
  got = terms();
  await page.goto(`${LOCAL}/over-time/`);
  await done(got, page);
  await page.waitForSelector('#viz-term-rate svg g');
  const bare = await lines();
  log('over-time bare is bars', bare.bars > 0 && bare.paths === 0 && bare.series === 'sotu', bare);
  log('over-time no console errors', errs.length === 0, errs.join(' | '));
  await page.close();
} catch (e) { log('over-time', false, e.message); }

try {
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push(e.message));
  const got = page.waitForResponse((r) => r.url().includes('action=amendments'));
  await page.goto(`${LOCAL}/amendments/#amendment-xiv`);
  await done(got, page);
  const r = await page.evaluate(() => ({
    entries: document.querySelectorAll('#amendment-list > li').length,
    index: document.querySelectorAll('#amendment-index a').length,
    records: document.querySelectorAll('#amendment-list a[href^="/corpus/?id="]').length,
    xiv: Math.round(document.getElementById('amendment-xiv')?.getBoundingClientRect().top ?? -1),
  }));
  log('amendments render', r.entries === 27 && r.index === 27 && r.records === 27, r);
  log('amendments hash lands', r.xiv >= 0 && r.xiv < 120, r);
  log('amendments no console errors', errs.length === 0, errs.join(' | '));
  await page.close();
} catch (e) { log('amendments', false, e.message); }

// ---- /corpus/contents/ (local only until it ships) ----
try {
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push(e.message));
  const api = await (await fetch(`${LOCAL}/api/corpus?action=contents`)).json();
  const got = page.waitForResponse((r) => r.url().includes('action=contents'));
  await page.goto(`${LOCAL}/corpus/contents/#congress`);
  await done(got, page);
  const r = await page.evaluate(() => {
    const rows = (sel) => [...document.querySelectorAll(sel)];
    const speakerLinks = rows('#speaker-groups .toc-title a').map((a) => new URL(a.href).searchParams.get('speaker'));
    return {
      unique: new Set(speakerLinks).size,
      groups: rows('#speaker-groups .contents-group').map((g) => [g.id, g.querySelectorAll('.toc-entry').length]),
      sotu: rows('#series-sotu tbody tr').length,
      sotuAbsent: rows('#series-sotu .series-absent').length,
      inaugural: rows('#series-inaugural tbody tr').length,
      recordLinks: rows('#series-groups a[href^="/corpus/?id="]').length,
      genres: rows('#genre-list .toc-entry').length,
      obama: rows('#congress .toc-entry').find((e) => e.innerText.includes('Barack Obama'))?.querySelector('.toc-dek')?.textContent,
      congressTop: Math.round(document.getElementById('congress').getBoundingClientRect().top),
    };
  });
  log('contents lists every speaker with records', r.unique === api.speakers.length, r);
  log('contents groups', JSON.stringify(r.groups) === JSON.stringify([['presidents', 45], ['supreme-court', 26], ['congress', 37], ['bodies', 4], ['not-on-rosters', 5]]), r.groups);
  log('contents series rows match lists and API', r.sotu === 245 && r.inaugural === 60 && r.recordLinks === api.series.length && r.sotuAbsent === 245 + 60 - api.series.length, r);
  log('contents genres match API', r.genres === api.by_genre.length, r);
  log('contents Senate-only speaker shows Senate list', r.obama === 'Illinois Senators', r.obama);
  log('contents hash lands', r.congressTop >= 0 && r.congressTop < 120, r.congressTop);

  // A speaker link opens the filtered explorer; back returns to the contents.
  const search = page.waitForResponse(isSearch('/api/corpus'));
  await page.click('#congress .toc-entry:has-text("Abraham Lincoln") .toc-title a');
  await done(search, page);
  // The speaker select fills from the stats response, after the search.
  await page.waitForFunction(() => document.getElementById('filter-speaker').options.length > 1, null, { timeout: 15000 });
  const filtered = await page.evaluate(() => ({ url: location.pathname + location.search, speaker: document.getElementById('filter-speaker').value }));
  log('contents speaker link filters corpus', filtered.url === '/corpus/?speaker=abraham-lincoln' && filtered.speaker === 'abraham-lincoln', filtered);
  const back = page.waitForResponse((r) => r.url().includes('action=contents'));
  await page.goBack();
  await done(back, page);
  log('contents back restores page', await page.evaluate(() => location.pathname === '/corpus/contents/' && document.querySelectorAll('#speaker-groups .toc-entry').length > 100), page.url());

  // A series record link opens the record view, title verbatim (escaping).
  const want = api.series.find((s) => s.series_member === 'sotu:1790-12-08:george-washington');
  const rec = page.waitForResponse((r) => r.url().includes('action=get'));
  await page.click(`#series-sotu a[href="/corpus/?id=${want.id}"]`);
  await done(rec, page);
  const title = await page.evaluate(() => document.getElementById('record-title')?.textContent.trim());
  log('contents series record link opens record view', title === want.title, { title, want: want.title });
  log('contents no console errors', errs.length === 0, errs.join(' | '));
  await page.close();
} catch (e) { log('contents', false, e.message); }

await browser.close();
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
