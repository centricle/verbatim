// Senate parser tests. The pages are hand-built at the coordinates the real
// volumes use (2012 and 2026 layouts), with the fake cast's names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPages } from './senate-pdf.mjs';
import { parsePages, moneyCents, isoDate } from './senate-parse.mjs';

const W = 3; // points per character, near enough for every test here
const line = (x0, y, text) => ({ x0, x1: x0 + W * text.length, y0: y - 2.1, y1: y + 2.1, text, words: text.split(' ').map((t) => ({ x0, x1: x0 + W * t.length, text: t })) });
const right = (x1, y, text) => line(x1 - W * text.length, y, text);
const page = (number, lines) => ({ number, width: 423, height: 657, lines: lines.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0) });
const source = { unit: 'senate-fy2026h1', url: 'https://www.govinfo.gov/content/pkg/X/pdf/X.pdf', start: '2025-10-01', end: '2026-03-31', file: 'x' };

// ---- 2026 layout ---------------------------------------------------------
const H26 = {
  banner: 232, office: 62, fy: 62, fyValue: 119, label: 245,
  avail: 410, period: 520, ytd: 587,
  doc: 67, posted: 135, payee: 176, start: 287, end: 325, desc: 356, amount: 590, subtotal: 327, pageLabel: 611,
};
function header26({ office, fy, program, summary, org }) {
  const h = H26;
  const out = [
    line(h.banner, 43, 'DETAILED AND SUMMARY STATEMENT OF EXPENDITURES'),
    line(h.office, 62, office),
    line(278, 65.4, 'DESCRIPTION'), { ...line(373, 65.4, 'NET FUNDS'), x1: 399 }, { ...line(446, 65.4, 'NET EXPENDITURES FOR'), x1: 503 }, { ...line(542, 65.4, 'TOTAL FUNDING'), x1: 579 },
    line(369, 72.3, 'AVAILABLE AS'), line(457, 72.3, 'THE PERIOD OF'), line(556, 72.3, 'YTD'),
    line(370, 79.3, 'OF 10/01/2025'), line(454, 79.3, '10/01/2025 THRU'),
    ...(fy ? [line(h.fy, 81.9, 'Funding Year'), line(h.fyValue, 81.9, fy)] : []),
    line(383, 86, '($)'), line(454, 86, '03/31/2026'), line(488, 86, '($)'), line(558, 86, '($)'),
  ];
  program.forEach((t, i) => out.push(line(h.office, 96.9 + 7.7 * i, t)));
  let y = 99.1;
  for (const [label, avail] of [['Authorization', '3,000,000.00'], ['Supplementals', '0.00'], ['Transfers', '0.00'], ['Resc / Withdrawals', '0.00']]) {
    out.push(line(h.label, y, label), right(h.avail, y, avail));
    y += 8;
  }
  for (const [label, period] of summary) {
    out.push(line(h.label, y, label), right(h.period, y, period), right(h.ytd, y, period));
    y += 8;
  }
  // ORGANIZATION TOTALS with its figures on a line of their own, 2.2 pt
  // above the label, as pdftotext reads several 2026 blocks.
  out.push(right(h.avail, y + 1.6, '3,000,000.00'), right(h.period, y + 1.6, org), right(h.ytd, y + 1.6, org), line(h.label, y + 3.8, 'ORGANIZATION TOTALS'));
  out.push(right(h.ytd, y + 13, '$2,825,544.50'), line(h.label, y + 15.1, 'UNEXPENDED BALANCE AS OF 03/31/2026'));
  return { lines: out, y: y + 25 };
}
function headings26(y) {
  return [
    line(74, y, 'DOCUMENT NO.'), line(140, y, 'DATE'), line(209, y, 'PAYEE NAME'), line(291, y, 'OBLIGATION/SERVICE'), line(426, y, 'DESCRIPTION'), { ...line(547, y, 'AMOUNT ($)'), x1: 574 },
    line(309, y + 5.4, 'DATES'), { ...line(136, y + 8.6, 'POSTED'), x1: 155 }, { ...line(293, y + 15.1, 'START'), x1: 308 }, { ...line(333, y + 15.1, 'END'), x1: 343 },
  ];
}
const h = H26;
const entry = (y, doc, posted, payee, start, end, desc, amount) => [line(h.doc, y, doc), line(h.posted, y, posted), ...(payee ? [line(h.payee, y, payee)] : []), line(h.start, y, start), line(h.end, y, end), line(h.desc, y, desc), right(h.amount, y, amount)];
const person = (y, name, title, amount) => [...(name ? [line(h.payee, y, name)] : []), line(h.desc, y, title), right(h.amount, y, amount)];
const sub26 = (y, label, amount) => [line(h.subtotal, y, label), right(h.amount, y, amount)];

function volume26({ payrollSummary = '-150,000.00', org = '-$174,455.50', ocsSecond = '$3,000.00', ocsSummary = '-23,100.00', fy = '2026', labels = ['B-1', 'B-2'], extra1 = [], summary = null, memo = false } = {}) {
  const top = header26({
    office: 'SENATOR WILE E. COYOTE (I) - COYOTE',
    fy,
    program: ['CONTINGENT EXPENSES OF THE SENATE', "SENATORS' OFFICIAL PERSONNEL AND", 'OFFICE EXPENSE ACCOUNT'],
    summary: summary ?? [
      ['Net Payroll Expenses', payrollSummary],
      ['Travel and Transportation of Persons', '-1,045.50'],
      ['Other Contractual Services', ocsSummary],
      ['Supplies and Materials', '-310.00'],
    ],
    org,
  });
  let y = top.y + 30;
  const p1 = [...top.lines, ...headings26(top.y), line(h.pageLabel, 211.5, labels[0]), ...extra1];
  p1.push(...person(y, 'WOLF, RALPH', 'CHIEF OF STAFF', '$60,000.00')); y += 6.2;
  p1.push(...person(y, 'SHEEPDOG, SAM', 'LEGISLATIVE DIRECTOR', '$40,000.00')); y += 6.2;
  // A name too long for its cell: one fragment above, one below.
  p1.push(line(h.payee, y - 2.6, 'BUNNY-ACME,'), ...person(y, null, 'STAFF ASSISTANT', '$20,000.00'), line(h.payee, y + 2.6, 'BUGS Q')); y += 9.3;
  if (memo) { p1.push(...sub26(y, 'PERSONNEL COMPENSATION', '$120,000.00')); y += 8.3; }
  p1.push(...sub26(y, 'PERSONNEL COMP. FULL-TIME PERMANENT', '$120,000.00')); y += 8.3;
  p1.push(...sub26(y, 'PERSONNEL BENEFITS', '$30,000.00')); y += 8.3;
  p1.push(...sub26(y, 'Net Payroll Expenses', '$150,000.00')); y += 10;
  p1.push(...entry(y, 'DRCC26M00001', '01/15/2026', 'CITIBANK - TRAVEL CBA CARD', '12/15/2025', '12/15/2025', 'STAFF TRANSPORTATION', '$160.30'));

  // Page 2: the last row's description continues above the first row.
  const p2 = [...headings26(48)];
  y = 74.9;
  p2.push(line(h.desc, y, 'AIRFARE FOR R WOLF WASHINGTON DC TO PHOENIX AZ')); y += 6.2;
  p2.push(...entry(y, 'DRCC26M00002', '01/16/2026', 'BUNNY, BUGS', '12/11/2025', '12/12/2025', 'STAFF PER DIEM', '$885.20')); y += 6.5;
  p2.push(...sub26(y, 'TRAVEL AND TRANSPORTATION OF PERSONS', '$1,045.50')); y += 10;
  p2.push(...entry(y, 'VSA2600001', '12/09/2025', 'ACME CORPORATION', '10/01/2025', '09/30/2026', 'APPLICATION SOFTWARE MAINT', '$20,000.00')); y += 6.2;
  p2.push(line(h.desc, y, 'AUDIO, VISUAL EQUIP MAINT'), right(h.amount, y, ocsSecond)); y += 8.4;
  // A payee wrapped around its row, centered.
  p2.push(line(h.payee, y - 2.6, 'DAFFY DUCK INFORMATION TECHNOLOGY'), ...entry(y, 'VSA2600002', '01/08/2026', null, '10/27/2025', '10/27/2025', 'TECHNICAL SUPPORT', '$100.00'), line(h.payee, y + 2.6, 'SOLUTIONS LLC')); y += 8.4;
  p2.push(...sub26(y, 'OTHER CONTRACTUAL SERVICES', '$23,100.00'));
  p2.push(line(h.pageLabel, 211.5, labels[1]));
  return [page(1, p1), page(2, p2)];
}

test('2026 layout: rows, collapsed pay, unitemized and summary-only amounts', () => {
  const r = parsePages(volume26(), source);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.discrepancies, []);
  const rows = r.rows;
  assert.equal(rows.length, 8);
  const sum = rows.reduce((a, x) => a + Math.round(Number(x.amount) * 100), 0);
  assert.equal(sum, 17445550, 'kept rows reconcile with ORGANIZATION TOTALS');
  const by = (d) => rows.find((x) => x.description === d || x.description?.startsWith(d));

  const pay = by('PERSONNEL COMP. FULL-TIME PERMANENT');
  assert.equal(pay.row_kind, 'subtotal');
  assert.equal(pay.amount, '120000.00');
  assert.equal(pay.category, 'NET PAYROLL EXPENSES');
  assert.deepEqual(JSON.parse(pay.extras), { page: 1, page_label: 'B-1', subclass: 'PERSONNEL COMP. FULL-TIME PERMANENT' });

  const benefits = by('PERSONNEL BENEFITS');
  assert.equal(JSON.parse(benefits.extras).unitemized, true);

  const air = by('STAFF TRANSPORTATION');
  assert.equal(air.description, 'STAFF TRANSPORTATION AIRFARE FOR R WOLF WASHINGTON DC TO PHOENIX AZ');
  assert.equal(air.document, 'DRCC26M00001');
  assert.equal(air.transaction_date, '2026-01-15');
  assert.equal(air.start_date, '2025-12-15');
  assert.equal(air.category, 'TRAVEL AND TRANSPORTATION OF PERSONS');
  assert.equal(air.source_ref, `${source.url}#page=1`);

  assert.equal(by('STAFF PER DIEM').payee, 'BUNNY, BUGS', 'a reimbursed person in an entry keeps the payee');

  const cont = by('AUDIO, VISUAL EQUIP MAINT');
  assert.equal(cont.document, 'VSA2600001');
  assert.equal(cont.payee, 'ACME CORPORATION');
  assert.equal(cont.end_date, '2026-09-30');
  assert.equal(JSON.parse(cont.extras).doc_line, 2);

  assert.equal(by('TECHNICAL SUPPORT').payee, 'DAFFY DUCK INFORMATION TECHNOLOGY SOLUTIONS LLC');

  const supplies = by('Supplies and Materials');
  assert.equal(supplies.amount, '310.00');
  assert.equal(supplies.category, 'SUPPLIES AND MATERIALS');
  assert.deepEqual(JSON.parse(supplies.extras), { page: 1, page_label: 'B-1', unitemized: true, from_summary: true });

  for (const x of rows) {
    assert.equal(x.office, 'SENATOR WILE E. COYOTE (I) - COYOTE');
    assert.equal(x.funding_year, '2026');
    assert.equal(x.program, "CONTINGENT EXPENSES OF THE SENATE SENATORS' OFFICIAL PERSONNEL AND OFFICE EXPENSE ACCOUNT");
    assert.equal(x.chamber, 'senate');
  }
  const all = JSON.stringify(rows);
  for (const leak of ['WOLF, RALPH', 'SHEEPDOG', 'BUNNY-ACME', 'CHIEF OF STAFF', 'STAFF ASSISTANT', 'LEGISLATIVE DIRECTOR']) {
    assert.ok(!all.includes(leak), `no person line reaches a row: ${leak}`);
  }
  assert.equal(r.tally.collapsedPersons, 3);
  assert.equal(new Set(rows.map((x) => x.row_number)).size, rows.length);
});

test('a class total that differs from the summary is a discrepancy, not a failure', () => {
  const r = parsePages(volume26({ payrollSummary: '-149,000.00', org: '-$173,455.50' }), source);
  assert.deepEqual(r.problems, []);
  assert.equal(r.discrepancies.length, 1);
  assert.equal(r.discrepancies[0].kind, 'summary');
  assert.equal(r.discrepancies[0].lines - r.discrepancies[0].summary, 100000);
});

test('a line that breaks its printed subtotal fails, unless the summary agrees with the subtotal', () => {
  // The summary agrees with the printed class total: the gap is the report's
  // own, and loads as printed.
  const ok = parsePages(volume26({ ocsSecond: '$3,000.01' }), source);
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(ok.discrepancies.filter((d) => d.kind === 'lines').map((d) => [d.label, d.lines, d.printed]), [['OTHER CONTRACTUAL SERVICES', 2310001, 2310000]]);
  // Nothing printed backs the class total: a misread, never allowed.
  const r = parsePages(volume26({ ocsSecond: '$3,000.01', ocsSummary: '-23,100.01', org: '-$174,455.51' }), source);
  assert.ok(r.problems.some((p) => /class "OTHER CONTRACTUAL SERVICES" is 23100.00, what it covers sums to 23100.01/.test(p)), r.problems.join('\n'));
});

test('the committees: B-2-n labels, no funding year, rules drawn as text', () => {
  const r = parsePages(volume26({
    fy: null,
    labels: ['B-2-1', 'B-2-2'],
    // The label again at the foot of the page, part dropped, and a rule.
    extra1: [line(560, 400, 'B- 1'), line(230, 150, 'f----'), line(380, 150, ',-- -')],
  }), source);
  assert.deepEqual(r.problems, []);
  assert.equal(r.rows.length, 8);
  for (const x of r.rows) {
    assert.equal(x.funding_year, null);
    assert.equal(x.office, 'SENATOR WILE E. COYOTE (I) - COYOTE');
    assert.equal(x.program, "CONTINGENT EXPENSES OF THE SENATE SENATORS' OFFICIAL PERSONNEL AND OFFICE EXPENSE ACCOUNT");
  }
  assert.deepEqual([...new Set(r.rows.map((x) => JSON.parse(x.extras).page_label))], ['B-2-1', 'B-2-2']);
});

test('a page printed as an image: its transcription is parsed, and without one it fails', () => {
  const plain = parsePages(volume26(), source);
  const pages = volume26();
  const label = pages[1].lines.find((l) => l.text === 'B-2');
  const lines = pages[1].lines.filter((l) => l !== label);
  pages[1].lines = [label];
  const r = parsePages(pages, source, { 2: { lines } });
  assert.deepEqual(r.problems, []);
  assert.equal(r.rows.length, plain.rows.length);
  for (const x of r.rows) assert.equal(JSON.parse(x.extras).ocr, JSON.parse(x.extras).page === 2 ? true : undefined);
  // The raw scan sees no text on the page: its money is out of the count.
  assert.ok(r.tally.money < plain.tally.money);
  assert.equal(r.tally.moneyPages, plain.tally.moneyPages - 1);

  const bare = volume26();
  bare[1].lines = [label];
  assert.ok(parsePages(bare, source).problems.some((p) => /page 2: no text but its page label/.test(p)));
});

test('a memo subtotal of the staff pay lines never loads, and is listed', () => {
  // PERSONNEL COMPENSATION over the person lines, outside the figures: the
  // pay sub-class below it then covers nothing printed (unitemized).
  const r = parsePages(volume26({ memo: true }), source);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.discrepancies.map((d) => [d.kind, d.label, d.lines]), [['memo', 'PERSONNEL COMPENSATION', 12000000]]);
  assert.equal(r.rows.length, 8);
  assert.ok(!r.rows.some((x) => x.description === 'PERSONNEL COMPENSATION'));
  assert.equal(JSON.parse(r.rows.find((x) => x.description === 'PERSONNEL COMP. FULL-TIME PERMANENT').extras).unitemized, true);
  assert.equal(r.tally.keptCents, r.tally.orgCents);
});

test('a class total the summary leaves out, its money in another class', () => {
  // The summary charges OTHER CONTRACTUAL SERVICES to Travel: two listed
  // gaps that cancel. Another office's summary names the class, so the
  // volume knows it for one.
  const other = header26({ office: 'SENATOR ROAD RUNNER (I) - RUNNER', fy: '2026', program: ['CONTINGENT EXPENSES OF THE SENATE'], summary: [['Other Contractual Services', '0.00']], org: '$0.00' });
  const pages = [...volume26({ summary: [['Net Payroll Expenses', '-150,000.00'], ['Travel and Transportation of Persons', '-24,145.50'], ['Supplies and Materials', '-310.00']] }), page(3, [...other.lines, line(h.pageLabel, 211.5, 'B-3')])];
  const r = parsePages(pages, source);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.discrepancies.map((d) => [d.kind, d.label, d.lines - d.summary]).sort(), [['summary', 'OTHER CONTRACTUAL SERVICES', 2310000], ['summary', 'TRAVEL AND TRANSPORTATION OF PERSONS', -2310000]]);
});

// ---- 2012 layout ---------------------------------------------------------
const H12 = { office: 40, label: 245, avail: 409, period: 520, ytd: 595, doc: 77, posted: 129, payee: 167, start: 293, end: 331, desc: 361, amount: 595, klass: 313 };
function volume12(persons) {
  const g = H12;
  const lines = [
    line(268, 40.2, 'DETAILED AND SUMMARY STATEMENT OF EXPENDITURES'),
    line(g.office, 58.3, 'MAJORITY CONFERENCE COMMITTEE (D)'),
    line(274, 61, 'DESCRIPTION'), { ...line(374, 61, 'NET FUNDS'), x1: 399 }, { ...line(449, 61, 'NET EXPENDITURES FOR'), x1: 504 }, { ...line(544, 61, 'TOTAL FUNDING'), x1: 580 },
    line(558, 67, 'YTD'), line(370, 68.5, 'AVAILABLE AS'), line(460, 68.5, 'THE PERIOD OF'),
    line(368, 76.4, 'OF 04/01/2012'), line(458, 76.4, '04/01/2012'), line(488, 76.4, 'THRU'),
    line(384, 83, '($)'), line(458, 83, '09/30/2012'), line(492, 83, '($)'), line(560, 83, '($)'),
    line(g.office, 90, 'Funding Year'), line(85, 90, 'X'),
    line(g.office, 97, 'MISCELLANEOUS ITEMS'),
    line(g.label, 95, 'Authorization'), right(g.avail, 95, '$900,000.00'),
    line(g.label, 102.5, 'Supplementals'), right(g.avail, 102.5, '0.00'),
    line(g.label, 110, 'Transfers'), right(g.avail, 110, '0.00'),
    line(g.label, 117.5, 'Resc / Withdrawals'), right(g.avail, 117.5, '0.00'),
    line(g.label, 125, 'Net Payroll Expenses'), right(g.period, 125, '-75,143.46'), right(g.ytd, 125, '-75,143.46'),
    line(g.label, 132.5, 'Other Contractual Services'), right(g.period, 132.5, '-450.00'), right(g.ytd, 132.5, '-450.00'),
    line(g.label, 141, 'ORGANIZATION TOTALS'), right(g.avail, 141, '$900,000.00'), right(g.period, 141, '-$75,593.46'), right(g.ytd, 141, '-$75,593.46'),
    line(g.label, 153, 'UNEXPENDED BALANCE AS OF 09/30/2012'), right(g.ytd, 153, '$824,406.54'),
    line(61, 164.1, 'DOCUMENT NO.'), line(133, 164.1, 'DATE'), line(204, 164.1, 'PAYEE NAME'), line(297, 164.1, 'OBLIGATION/SERVICE'), line(432, 164.1, 'DESCRIPTION'), { ...line(565, 164.1, 'AMOUNT ($)'), x1: 591 },
    line(313, 170.1, 'DATES'), { ...line(130, 173, 'POSTED'), x1: 148 }, { ...line(295, 180.5, 'START'), x1: 310 }, { ...line(336, 180.5, 'END'), x1: 345.5 },
    line(620, 211.5, 'B-47'),
  ];
  let y = 201.9;
  // Pay lines first; their subtotals come after every other class.
  for (const [name, title, amount] of persons) { lines.push(line(g.payee, y, name), line(g.desc, y, title), right(g.amount, y, amount)); y += 5.05; }
  lines.push(line(g.doc, y, 'V21200011510'), line(g.posted, y, '08/09/2012'), line(g.payee, y, 'ACME CORPORATION'), line(g.start, y, '06/07/2012'), line(g.end, y, '06/07/2012'), line(g.desc, y, 'STUDIES, ANALYSES & EVALUATIONS'), right(g.amount, y, '400.00')); y += 5.05;
  lines.push(line(g.desc, y, 'TECHNICAL SUPPORT'), right(g.amount, y, '50.00')); y += 6;
  lines.push(line(g.klass, y, 'OTHER CONTRACTUAL SERVICES'), right(g.amount, y, '450.00')); y += 8;
  // The pay sub-classes, in the description column.
  lines.push(line(g.desc, y, 'OTHER PERSONNEL COMPENSATION'), right(g.amount, y, '143.46')); y += 5.1;
  lines.push(line(g.desc, y, 'PERSONNEL COMP. FULL-TIME PERMANENT'), right(g.amount, y, '75,000.00')); y += 5.7;
  lines.push(line(g.klass, y, 'NET PAYROLL EXPENSES'), right(g.amount, y, '75,143.46'));
  return [page(1, lines)];
}
const src12 = { ...source, unit: 'senate-fy2012h2', start: '2012-04-01', end: '2012-09-30' };

test('2012 layout: pay lines split across their sub-classes, continuation in the description column', () => {
  const r = parsePages(volume12([
    ['WOLF, RALPH', 'STAFF DIRECTOR', '50,000.00'],
    ['SHEEPDOG, SAM', 'PRESS ASSISTANT', '25,000.00'],
    ['COYOTE, WILE E', 'STAFF ASSISTANT', '143.46'],
  ]), src12);
  assert.deepEqual(r.problems, []);
  assert.equal(r.tally.subclassInDesc, true);
  const d = Object.fromEntries(r.rows.map((x) => [x.description, x]));
  assert.deepEqual(Object.keys(d).sort(), ['OTHER PERSONNEL COMPENSATION', 'PERSONNEL COMP. FULL-TIME PERMANENT', 'STUDIES, ANALYSES & EVALUATIONS', 'TECHNICAL SUPPORT']);
  assert.equal(d['TECHNICAL SUPPORT'].document, 'V21200011510', 'a description-only line under an entry continues it');
  assert.equal(d['TECHNICAL SUPPORT'].row_kind, 'detail');
  assert.equal(d['OTHER PERSONNEL COMPENSATION'].row_kind, 'subtotal');
  assert.equal(JSON.parse(d['OTHER PERSONNEL COMPENSATION'].extras).unitemized, undefined, 'it stands for a pay line, so it is not unitemized');
  assert.equal(d['STUDIES, ANALYSES & EVALUATIONS'].funding_year, 'X');
  assert.equal(r.tally.collapsedPersons, 3);
  assert.ok(!JSON.stringify(r.rows).includes('WOLF'));
});

test('2012 layout: pay lines that fit only both sub-classes together', () => {
  const r = parsePages(volume12([
    ['WOLF, RALPH', 'STAFF DIRECTOR', '50,000.00'],
    ['SHEEPDOG, SAM', 'PRESS ASSISTANT', '25,143.46'],
  ]), src12);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.discrepancies, []);
  assert.equal(r.rows.filter((x) => x.row_kind === 'subtotal').length, 2);
});

test('2012 layout: pay lines that fit no subtotal are a pay discrepancy', () => {
  const r = parsePages(volume12([
    ['WOLF, RALPH', 'STAFF DIRECTOR', '50,000.00'],
    ['SHEEPDOG, SAM', 'PRESS ASSISTANT', '25,190.00'],
  ]), src12);
  assert.deepEqual(r.problems, []);
  assert.equal(r.discrepancies.length, 1);
  assert.equal(r.discrepancies[0].kind, 'pay');
});

test('money and dates as the report prints them', () => {
  assert.equal(moneyCents('-$8,484.00'), -848400);
  assert.equal(moneyCents('$.00'), 0);
  assert.equal(moneyCents('$0.00'), 0);
  assert.equal(moneyCents('18.75'), 1875);
  assert.equal(moneyCents('-18.75'), -1875);
  assert.equal(moneyCents('$1,835,142.70'), 183514270);
  assert.equal(moneyCents('1,234'), null);
  assert.equal(moneyCents('B-27'), null);
  assert.equal(moneyCents('12/16/2025'), null);
  assert.equal(isoDate('12/16/2025'), '2025-12-16');
  assert.equal(isoDate('02/30/2026'), undefined);
  assert.equal(isoDate('2025-12-16'), undefined);
  assert.equal(isoDate('10/11/0211'), undefined, 'a year the report cannot mean');
});

test('readPages reads pdftotext -bbox-layout output', () => {
  const xhtml = `<doc><page width="423.000000" height="657.000000"><flow><block xMin="1" yMin="1" xMax="2" yMax="2">
    <line xMin="355.1" yMin="266.9" xMax="404.4" yMax="271.2"><word xMin="355.1" yMin="266.9" xMax="380" yMax="271.2">FURNITURE</word><word xMin="382" yMin="266.9" xMax="386" yMax="271.2">&amp;</word><word xMin="388" yMin="266.9" xMax="404.4" yMax="271.2">FIXTURES</word></line>
    <line xMin="66.6" yMin="260.0" xMax="104.7" yMax="264.3"><word xMin="66.6" yMin="260.0" xMax="104.7" yMax="264.3">VSA2607203</word></line>
  </block></flow></page><page width="423" height="657"></page></doc>`;
  const pages = readPages(xhtml);
  assert.equal(pages.length, 2);
  assert.equal(pages[0].lines.length, 2);
  assert.equal(pages[0].lines[0].text, 'VSA2607203', 'sorted top to bottom');
  assert.equal(pages[0].lines[1].text, 'FURNITURE & FIXTURES');
  assert.equal(pages[0].lines[1].x0, 355.1);
  assert.equal(pages[1].number, 2);
});
