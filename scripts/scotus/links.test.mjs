import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collisions, links, localName, parseRobots, pdfLinks, robotsAllows, usReportsVolumes } from './links.mjs';
import { currentTerm, ordersPage, slipPage, transcriptPage } from './sources.mjs';

const PAGE = 'https://www.supremecourt.gov/oral_arguments/argument_transcript/2024';

test('links resolve, drop fragments, dedupe and skip mailto and anchors', () => {
  const html = `
    <a href='../argument_transcripts/2024/22-7466_c9dh.pdf'>a</a>
    <a href="/opinions/preliminaryprint/604US1PP_Ord.pdf#page=12">b</a>
    <a href="/opinions/preliminaryprint/604US1PP_Ord.pdf#page=40">c</a>
    <a href="#top">d</a><a href="mailto:x@example">e</a>
    <a href="https://www.supremecourt.gov/x.aspx?a=1&amp;b=2">f</a>`;
  assert.deepEqual(links(html, PAGE), [
    'https://www.supremecourt.gov/oral_arguments/argument_transcripts/2024/22-7466_c9dh.pdf',
    'https://www.supremecourt.gov/opinions/preliminaryprint/604US1PP_Ord.pdf',
    'https://www.supremecourt.gov/x.aspx?a=1&b=2',
  ]);
  assert.equal(pdfLinks(html, PAGE).length, 2);
});

test('usReportsVolumes reads all three URL forms', () => {
  const html = `
    <a href='/pdfs/USReports/USREPORTS-2_PDFA.pdf'></a>
    <a href='/pdfs/USReports/USREPORTS-501_PDFA.pdf'></a>
    <a href='boundvolumes/502bv.pdf'></a>
    <a href='boundvolumes/587BV.pdf'></a>
    <a href='preliminaryprint/588US1PP_final.pdf'></a>
    <a href='preliminaryprint/588US2PP_final.pdf'></a>
    <a href='preliminaryprint/593US1PP_Web.pdf'></a>
    <a href='../publicinfo/reportersguide.pdf'></a>`;
  const vols = usReportsVolumes(html, 'https://www.supremecourt.gov/opinions/USReports.aspx');
  assert.deepEqual([...vols.keys()], [2, 501, 502, 587, 588, 593]);
  assert.equal(vols.get(502)[0], 'https://www.supremecourt.gov/opinions/boundvolumes/502bv.pdf');
  assert.equal(vols.get(588).length, 2);
});

test('localName keeps a safe basename and refuses an empty one', () => {
  assert.equal(localName('https://static.case.law/us/347.zip'), '347.zip');
  assert.equal(localName('https://example.example/a/b%20c(1).pdf'), 'b_c_1_.pdf');
  assert.throws(() => localName('https://example.example/'));
  assert.throws(() => localName('https://example.example/..'));
});

test('collisions finds two URLs bound for one file', () => {
  assert.deepEqual(collisions([
    { file: 'slip/2024/a.pdf', url: 'https://x.example/24pdf/a.pdf' },
    { file: 'slip/2024/a.pdf', url: 'https://x.example/24pdf/a.pdf' },
    { file: 'slip/2024/b.pdf', url: 'https://x.example/24pdf/b.pdf' },
    { file: 'slip/2024/b.pdf', url: 'https://x.example/25pdf/b.pdf' },
  ]), [{ file: 'slip/2024/b.pdf', urls: ['https://x.example/24pdf/b.pdf', 'https://x.example/25pdf/b.pdf'] }]);
});

test('robots: the * group, crawl delay, and disallow everything', () => {
  const ua = 'verbatim.fyi data loader (+https://github.com/centricle/verbatim)';
  const court = parseRobots('User-agent:discobot\nDisallow:/\n\nUser-agent:*\nDisallow: /images/\nDisallow: /cdn/\nCrawl-delay:1\n', ua);
  assert.equal(court.crawlDelay, 1);
  assert.ok(robotsAllows(court, '/opinions/boundvolumes/573BV.pdf'));
  assert.ok(!robotsAllows(court, '/images/x.png'));
  const cap = parseRobots('User-agent: *\nDisallow: / \n', ua);
  assert.ok(!robotsAllows(cap, '/us/347.zip'));
  assert.ok(robotsAllows(parseRobots('', ua), '/anything'));
});

test('robots: a group naming our agent beats *, Allow wins a tie, wildcards', () => {
  const ua = 'verbatim.fyi data loader';
  const r = parseRobots('User-agent: *\nDisallow: /\n\nUser-agent: verbatim.fyi\nDisallow: /private\nAllow: /misc/*.css$\nDisallow: /misc/\n', ua);
  assert.ok(robotsAllows(r, '/us/1.zip'));
  assert.ok(!robotsAllows(r, '/private/x'));
  assert.ok(robotsAllows(r, '/misc/a.css'));
  assert.ok(!robotsAllows(r, '/misc/a.css?x'));
  const fjc = parseRobots('User-agent: *\nCrawl-delay: 30\nDisallow: /research/idb/\n', ua);
  assert.equal(fjc.crawlDelay, 30);
  assert.ok(robotsAllows(fjc, '/sites/default/files/history/judges.csv'));
});

test('terms and page names', () => {
  assert.equal(currentTerm(new Date(2026, 10, 20)), 2026);
  assert.equal(currentTerm(new Date(2026, 8, 30)), 2025);
  assert.equal(slipPage(2018).url, 'https://www.supremecourt.gov/opinions/slipopinion/18');
  assert.equal(ordersPage(2024).file, 'pages/relatingtoorders-24.html');
  assert.equal(transcriptPage(1968).url, 'https://www.supremecourt.gov/oral_arguments/archived_transcripts/1968');
  assert.equal(transcriptPage(2000).url, 'https://www.supremecourt.gov/oral_arguments/argument_transcript/2000');
});
