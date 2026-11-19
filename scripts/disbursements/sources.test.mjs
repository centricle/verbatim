import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quarterFromUrl, detailLinks, mergeLinks } from './sources.mjs';

const base = 'https://www.house.gov/sites/default/files/';

test('quarter from each file name scheme seen since 2016', () => {
  const cases = {
    'uploads/documents/JAN-MAR-2016-SOD-DETAIL-GRID_REVISED_9_26_16.csv': ['2016q1', '2016-01-01', '2016-03-31'],
    'uploads/documents/OCT-DEC%202016%20DETAIL%20GRID.csv': ['2016q4', '2016-10-01', '2016-12-31'],
    'uploads/documents/SODs/2021q3/JULY-2021-SOD-DETAIL-GRID-FINAL.csv': ['2021q3', '2021-07-01', '2021-09-30'],
    'uploads/documents/SODs/2021q1/JAN_MAR_2021_SOD_DETAIL_GRID_FINAL.csv': ['2021q1', '2021-01-01', '2021-03-31'],
    '2024-11/JULY-SEPTEMBER_2024_SOD_DETAIL_GRID-FINAL.csv': ['2024q3', '2024-07-01', '2024-09-30'],
    '2026-08/grids/APRIL-JUNE%202026%20SOD%20DETAIL%20GRID-FINAL.csv': ['2026q2', '2026-04-01', '2026-06-30'],
    'uploads/documents/SODs/JAN-MAR%202019%20SOD%20DETAIL%20GRID.CSV': ['2019q1', '2019-01-01', '2019-03-31'],
  };
  for (const [path, [quarter, start, end]] of Object.entries(cases)) {
    assert.deepEqual(quarterFromUrl(base + path), { quarter, start, end }, path);
  }
  assert.throws(() => quarterFromUrl(`${base}SOD-DETAIL-GRID.csv`));
  assert.throws(() => quarterFromUrl(`${base}FEB-APR-2020-SOD.csv`));
});

const archive = (title, href) => `<ul><li><a href="/x.pdf"><strong>${title}</strong></a> (9MB PDF)<ul><li><a href="${href}">SOD Detail Transactions</a> (17MB CSV)</li><li><a href="/s.csv">SOD Summary Data</a></li></ul></li></ul>`;

test('archive links agree with their volume title, or stop the run', () => {
  const page = 'https://www.house.gov/the-house-explained/open-government/statement-of-disbursements/archive';
  const ok = detailLinks(archive('Statement of Disbursements of the House, July 1, 2021 to September 30, 2021', '/sites/default/files/JULY-2021-SOD-DETAIL-GRID-FINAL.csv'), page);
  assert.deepEqual(ok, [{ url: `${base}JULY-2021-SOD-DETAIL-GRID-FINAL.csv`, quarter: '2021q3', start: '2021-07-01', end: '2021-09-30' }]);
  assert.throws(() => detailLinks(archive('Statement of Disbursements of the House, April 1, 2021 to June 30, 2021', '/sites/default/files/JULY-2021-SOD-DETAIL-GRID-FINAL.csv'), page), /page says/);
});

test('one quarter listed with two different files stops the run', () => {
  const a = { url: 'https://h.example/a.csv', quarter: '2026q2' };
  assert.equal(mergeLinks([[a], [a]]).length, 1);
  assert.throws(() => mergeLinks([[a], [{ ...a, url: 'https://h.example/b.csv' }]]), /listed as both/);
});
