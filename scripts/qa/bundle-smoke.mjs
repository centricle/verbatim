// Smoke the verbatim explorers' production bundle on its deep links, plus the three words pages,
// one /executive/ record view and one /clemency/ title row's link to /executive/.
// Usage: node scripts/qa/bundle-smoke.mjs [base]   default http://localhost:4179 (vite preview of a
// clean-clone build); /api is always answered by verbatim.fyi, so this also runs as-is
// against https://verbatim.fyi after a deploy. API=<base> answers /api from somewhere else
// (API=http://localhost:7033 for an explorer production does not have yet).
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:4179';
const PAGES = [
  ['trades', 'trades', '?member=Pat+Roberts&chamber=senate&year=2019', 'filter-member'],
  // A pre-House link: app.js rewrites senator= to the member and the Senate.
  ['trades', 'trades', '?senator=Ron+L+Wyden', 'filter-member', { select: 'Ron Wyden', url: /[?&]member=Ron\+Wyden&chamber=senate$/ }],
  ['compas', 'compas', '?race=Caucasian&page=2', 'filter-race'],
  ['incidents', 'incidents', '?state=TX&year=2020', 'filter-state'],
  ['finance', 'fec', '?state=MD&party=DEM', 'filter-state'],
  ['qi', 'qi', '?ruling=granted', 'filter-ruling'],
  ['crashes', 'crashes', '?system=ADS&state=CA', 'filter-state'],
  ['corpus', 'corpus', '?speaker=abraham-lincoln&genre=speech', 'filter-speaker'],
  ['executive', 'executive', '?president=barack-obama&type=executive_order', 'filter-president'],
  ['clemency', 'clemency', '?president=richard-nixon&type=pardon', 'filter-president'],
  ['disbursements', 'disbursements', '?quarter=2026q2&category=TRAVEL', 'filter-category'],
  // Sorting moved to the Date and Amount headings (2026-11-19): the deep link
  // lands as the Amount heading's aria-sort.
  ['disbursements', 'disbursements', '?office=OFFICE+OF+THE+SPEAKER&sortBy=amount', 'filter-category', { select: '', sort: 'amount:descending' }],
];
const API = process.env.API || 'https://verbatim.fyi';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.route('**/api/**', async (route) => {
  const u = new URL(route.request().url());
  const res = await fetch(`${API}${u.pathname}${u.search}`);
  route.fulfill({ status: res.status, contentType: 'application/json', body: await res.text() });
});

let failed = 0;
for (const [route, prefix, qs, select, expect] of PAGES) {
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`${BASE}/${route}/${qs}`);
  try {
    await page.waitForFunction((p) => document.querySelectorAll(`#${p}-results tr`).length > 0, prefix, { timeout: 20000 });
    await page.waitForFunction((s) => document.getElementById(s).options.length > 1, select, { timeout: 20000 });
    await page.waitForSelector('[id^="viz-"] svg', { timeout: 20000 });
  } catch (e) { errs.push(`wait: ${e.message.split('\n')[0]}`); }
  await page.waitForTimeout(500);
  const r = await page.evaluate(([p, s]) => ({
    info: document.getElementById(`${p}-results-info`).textContent,
    rows: document.querySelectorAll(`#${p}-results tr`).length,
    select: document.getElementById(s).value,
    charts: document.querySelectorAll('[id^="viz-"] svg').length,
    sort: [...document.querySelectorAll('th[aria-sort]')].map((th) => `${th.dataset.sort}:${th.getAttribute('aria-sort')}`).join(','),
  }), [prefix, select]);
  const want = expect?.select ?? new URLSearchParams(qs).get(select.replace('filter-', ''));
  if (expect?.url && !expect.url.test(page.url())) errs.push(`url: ${page.url()}`);
  if (expect?.sort && r.sort !== expect.sort) errs.push(`sort: ${r.sort}`);
  const ok = errs.length === 0 && r.rows > 0 && r.select === want && r.charts > 0;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${route}${qs} :: ${r.info} | rows=${r.rows} select=${r.select} charts=${r.charts}${r.sort ? ` sort=${r.sort}` : ''}${errs.length ? ' | ' + errs.join(' | ') : ''}`);
  await page.close();
}
// The two words pages built on the corpus: no table, so their own checks.
for (const [route, qs, wait, check] of [
  ['over-time', '?series=inaugural&t=liberty&t=union', '#viz-term-rate svg g',
    () => ({ lines: [...document.querySelectorAll('#viz-term-rate path')].filter((p) => p.style.stroke.includes('series')).length, series: document.getElementById('series').value }),
    (r) => r.lines === 2 && r.series === 'inaugural'],
  ['amendments', '#amendment-xiv', '#amendment-list > li',
    () => ({ entries: document.querySelectorAll('#amendment-list > li').length }),
    (r) => r.entries === 27],
  ['corpus/contents', '#congress', '#genre-list .toc-entry',
    () => ({
      congress: document.querySelectorAll('#congress .toc-entry').length,
      sotu: document.querySelectorAll('#series-sotu tbody tr').length,
      obama: [...document.querySelectorAll('#congress .toc-entry')].find((e) => e.innerText.includes('Barack Obama'))?.querySelector('.toc-dek')?.textContent,
    }),
    (r) => r.congress >= 30 && r.sotu === 245 && r.obama === 'Illinois Senators'],
  // EO 13992: FR's note names eight orders, all in the table, so all eight link.
  ['executive', '?id=059a162ceee8a320966077875d1078378f0321bf3d3eee6ca98cd9c569526eea', '#record-notes-body a',
    () => ({ links: document.querySelectorAll('#record-notes-body a[href^="/executive/?id="]').length, kicker: document.getElementById('record-kicker').textContent, paras: document.querySelectorAll('#record-text p').length }),
    (r) => r.links === 8 && r.kicker === 'Executive Order 13992' && r.paras > 3],
  // The J6 grant is listed by title; its row links Proclamation 10887 in /executive/.
  ['clemency', '?q=Capitol', '#clemency-results .grant-link',
    () => { const a = document.querySelector('#clemency-results .grant-link'); return { text: a.textContent, href: a.getAttribute('href'), reach: document.getElementById('clemency-reach').textContent }; },
    (r) => r.text === 'Proclamation 10887' && /^\/executive\/\?id=[0-9a-f]{64}$/.test(r.href) && /entries, granted 1969 to 20\d\d\.$/.test(r.reach)],
].map(([a, b, c, d, e]) => [a, b, c, [d, e]])) {
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`${BASE}/${route}/${qs}`);
  try { await page.waitForSelector(wait, { timeout: 20000 }); } catch (e) { errs.push(`wait: ${e.message.split('\n')[0]}`); }
  await page.waitForTimeout(300);
  const r = await page.evaluate(check[0]);
  const ok = errs.length === 0 && check[1](r);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${route}/${qs} :: ${JSON.stringify(r)}${errs.length ? ' | ' + errs.join(' | ') : ''}`);
  await page.close();
}
await browser.close();
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
