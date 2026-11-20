import { test } from 'node:test';
import assert from 'node:assert/strict';
import { senateVolumes, unitFor } from './senate-sources.mjs';

const vol = (id, label) => `<li><a href="https://www.govinfo.gov/app/details/${id}/${id}-1/context">${label}</a>
  <a href="https://www.govinfo.gov/content/pkg/${id}/pdf/${id}.pdf">Full Report</a>
  <a href="https://www.govinfo.gov/content/pkg/${id}/pdf/${id}-1.pdf">Part I</a>
  <a href="https://www.govinfo.gov/content/pkg/${id}/pdf/${id}-2.pdf">Part II</a></li>`;

test('reads every volume, oldest first, Full Report only', () => {
  const html = `<ul>${vol('GPO-CDOC-119sdoc6', 'October 1, 2025 to March 31, 2026')}${vol('GPO-CDOC-112sdoc4', 'April 1, 2011 to September 30, 2011')}</ul>`;
  assert.deepEqual(senateVolumes(html), [
    { id: 'GPO-CDOC-112sdoc4', label: 'April 1, 2011 to September 30, 2011', start: '2011-04-01', end: '2011-09-30', unit: 'senate-fy2011h2', url: 'https://www.govinfo.gov/content/pkg/GPO-CDOC-112sdoc4/pdf/GPO-CDOC-112sdoc4.pdf' },
    { id: 'GPO-CDOC-119sdoc6', label: 'October 1, 2025 to March 31, 2026', start: '2025-10-01', end: '2026-03-31', unit: 'senate-fy2026h1', url: 'https://www.govinfo.gov/content/pkg/GPO-CDOC-119sdoc6/pdf/GPO-CDOC-119sdoc6.pdf' },
  ]);
});

test('stops on a period that is not a half year, or a missing Full Report', () => {
  assert.throws(() => senateVolumes(vol('GPO-CDOC-119sdoc6', 'October 1, 2025 to June 30, 2026')), /not a half/);
  assert.throws(() => senateVolumes('<a href="https://www.govinfo.gov/app/details/GPO-CDOC-1sdoc1/x">April 1, 2011 to September 30, 2011</a>'), /no Full Report/);
  assert.throws(() => senateVolumes(vol('GPO-CDOC-1sdoc1', 'Report of the Secretary')), /not a period/);
});

test('units name the fiscal half', () => {
  assert.equal(unitFor('2025-10-01', '2026-03-31'), 'senate-fy2026h1');
  assert.equal(unitFor('2025-04-01', '2025-09-30'), 'senate-fy2025h2');
  assert.equal(unitFor('2025-04-01', '2025-10-31'), null);
});
