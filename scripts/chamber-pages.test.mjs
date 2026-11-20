import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forkChamber } from './chamber-pages.mjs';

const page = `<head>
  <title data-chamber="house">House Disbursements</title>
  <title data-chamber="senate">Senate Disbursements</title>
  <meta name="description" data-chamber="house" content="House">
  <meta name="description" data-chamber="senate" content="Senate">
</head>
<nav>
  <a href="/d/house/" data-chamber-link="house">House</a>
  <a href="/d/senate/" data-chamber-link="senate">Senate</a>
</nav>
<div data-chamber="house"><div><p>Quarterly.</p></div></div>
<div data-chamber="senate"><div><p>Twice a year.</p></div><div>Nested.</div></div>
<p>Both. <span data-chamber="house">A</span><span data-chamber="senate">B</span></p>
`;

test('the Senate page keeps only the Senate copy, with no marks left', () => {
  const out = forkChamber(page, 'senate');
  assert.match(out, /<title>Senate Disbursements<\/title>/);
  assert.doesNotMatch(out, /House Disbursements|content="House"|Quarterly/);
  assert.match(out, /<div><div><p>Twice a year\.<\/p><\/div><div>Nested\.<\/div><\/div>/);
  assert.match(out, /<p>Both\. <span>B<\/span><\/p>/);
  assert.doesNotMatch(out, /data-chamber=/);
});

test('a removed element on a line of its own takes the line with it', () => {
  const out = forkChamber(page, 'house');
  assert.match(out, /<title>House Disbursements<\/title>\n  <meta name="description" content="House">\n<\/head>/);
  assert.match(out, /<div><div><p>Quarterly\.<\/p><\/div><\/div>\n<p>Both/);
});

test("the page's own switch link is current, and only that one", () => {
  const out = forkChamber(page, 'senate');
  assert.match(out, /data-chamber-link="senate" aria-current="page"/);
  assert.doesNotMatch(out, /data-chamber-link="house" aria-current/);
});

test('a page with two titles, or no switch link, fails the build', () => {
  assert.throws(() => forkChamber('<title>a</title><title>b</title><a data-chamber-link="house">', 'house'), /exactly one <title>/);
  assert.throws(() => forkChamber('<title>a</title>', 'house'), /exactly one data-chamber-link/);
});
