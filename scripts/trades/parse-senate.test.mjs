import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parsePtr } from './parse-senate.mjs';

const dir = new URL('./fixtures/efd/', import.meta.url);
const fixtures = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => {
  const fx = JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
  return { ...fx, html: readFileSync(new URL(`${fx.uuid}.html`, dir), 'utf8') };
});
const fx = (prefix) => fixtures.find((f) => f.uuid.startsWith(prefix)).html;

for (const f of fixtures) {
  test(`${f.uuid.slice(0, 8)}: ${f.why}`, () => {
    assert.deepEqual(parsePtr(f.html), f.expect);
  });
}

test('title and filed date as printed; # is row_num, top row first', () => {
  const r = parsePtr(fx('21941188'));
  assert.equal(r.title, 'Periodic Transaction Report for 11/17/2026');
  assert.equal(r.filed, '11/17/2026');
  assert.deepEqual(r.rows.map((x) => x.row_num), [2, 1]);
  assert.equal(r.rows[1].asset_description, 'iShares 10-20 Year Treasury Bond ETF');
});

test('a ticker link is its text; "--" is NULL', () => {
  const [row] = parsePtr(fx('21941188')).rows;
  assert.equal(row.ticker, 'CMBS');
  assert.equal(row.comment, null);
  assert.equal(parsePtr(fx('deb8df2a')).rows[0].ticker, null);
});

test('the text-muted line joins the asset name as Senate Stock Watcher has it', () => {
  const [row] = parsePtr(fx('deb8df2a')).rows;
  assert.equal(row.asset_description, 'Bank of America Rate/Coupon: 3.0% Matures: 06/21/2019');
  assert.equal(row.asset_type, 'Corporate Bond');
});

test('an amendment restates every row; #9 is the correction', () => {
  const orig = parsePtr(fx('691f9cb6'));
  const amend = parsePtr(fx('07935a4d'));
  assert.equal(amend.title, `${orig.title} (Amendment 1)`);
  assert.equal(amend.rows.length, orig.rows.length);
  const nine = (r) => r.rows.find((x) => x.row_num === 9);
  assert.equal(nine(orig).amount, '$15,001 - $50,000');
  assert.equal(nine(amend).amount, '$1,001 - $15,000');
  assert.match(nine(amend).comment, /^Due to clerical error/);
});

test('a filed time on the hour prints without minutes', () => {
  const html = fx('21941188').replace(/Filed\s+11\/17\/2026 @ [^<]+/, 'Filed  05/26/2016 @ 12 PM');
  assert.equal(parsePtr(html).filed, '05/26/2016');
});

test('an unknown column throws', () => {
  const html = fx('deb8df2a').replace('<th scope="col">Comment</th>', '<th scope="col">Notes</th>');
  assert.throws(() => parsePtr(html), /unknown column "Notes"/);
});

test('rows short of the printed total throw', () => {
  const html = fx('21941188').replace(/<tr>[\s\S]*?<\/tr>/, '');
  assert.throws(() => parsePtr(html), /1 rows, 2 transactions total/);
});

test('# out of sequence is kept as printed, in page order', () => {
  const html = fx('21941188').replace('<td>2</td>', '<td>@</td>').replace('<td>1</td>', '<td>2</td>').replace('<td>@</td>', '<td>1</td>');
  assert.deepEqual(parsePtr(html).rows.map((x) => [x.row_num, x.ticker]), [[1, 'CMBS'], [2, 'TLH']]);
});

test('a # outside 1 to N, or not a number, throws', () => {
  for (const n of ['3', '0', '--']) {
    const html = fx('21941188').replace('<td>2</td>', `<td>${n}</td>`);
    assert.throws(() => parsePtr(html), /not each a whole number from 1 to 2/, n);
  }
});

test('a repeated #, as on five 2015 pages: renumbered from the bottom', () => {
  const html = fx('deb8df2a').replace(/<td>1<\/td>/, '<td>5</td>');
  const r = parsePtr(html);
  assert.equal(r.renumbered, true);
  assert.deepEqual(r.rows.map((x) => x.row_num), [5, 4, 3, 2, 1]);
  assert.equal(parsePtr(fx('deb8df2a')).renumbered, false);
});

test('a page that is not a PTR throws', () => {
  const html = fx('21941188').replace(/<h1[\s\S]*?<\/h1>/, '<h1>United States Senate Financial Disclosures (eFD)</h1>');
  assert.throws(() => parsePtr(html), /^Error: title/);
  assert.throws(() => parsePtr('<html><body><p>Agreement</p></body></html>'), /0 h1 elements/);
});
