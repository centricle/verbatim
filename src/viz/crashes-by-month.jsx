// Figure 1 on /crashes/: reports per incident month, stacked by system, with
// the order's later amendments drawn as dated rules. Months with no reports
// are drawn as empty months, not skipped, so the axis is true time.
import React, { useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';
import { showTooltip, hideTooltip } from './tooltip.js';
import { useContainerWidth } from './chart-size.js';

const SYSTEMS = [
  ['ads', 'ADS', 'var(--color-series-1)'],
  ['adas', 'Level 2 ADAS', 'var(--color-series-2)'],
  ['other', 'Other', 'var(--color-series-3)'],
];

// Effective dates of the amended order. The third is the date NHTSA's data
// dictionary gives for the first third-amendment reports received.
const AMENDMENTS = [
  ['Second amendment', '2023-05-15', 'May 15, 2023'],
  ['Third amendment', '2025-06-16', 'June 16, 2025'],
];

// Months before this are outside the order's reporting and are noted under
// the figure rather than stretching the axis back decades.
const FIRST_PLOTTED = '2000-01-01';

// Amendment labels: rows are ROW apart; PAD is the least gap between two
// labels on one row.
const ROW = 34;
const PAD = 8;

// Picks a row and a side (right or left of its rule) for each amendment label.
// Each rule is drawn from its own label's row down, so a label may pass over
// another rule only above the row where that rule starts. Every assignment is
// tried (two sides by n rows per label: 16 for two amendments) and the
// cheapest kept: no collisions first, then fewest rows, then most labels
// right of their rules. A label collides by leaving the chart, by overlapping
// a label on its row, or by crossing a rule that has started by its row.
function placeLabels(rules, minX, maxX) {
  const n = rules.length;
  if (!n) return [];
  let best = null;
  for (let code = 0; code < (2 * n) ** n; code += 1) {
    let c = code;
    const slots = rules.map((r) => {
      const o = c % (2 * n);
      c = Math.floor(c / (2 * n));
      const right = o % 2 === 0;
      const left = right ? r.px + 4 : r.px - 4 - r.w;
      return { row: Math.floor(o / 2), right, left, end: left + r.w };
    });
    let bad = 0;
    slots.forEach((s, i) => {
      if (s.left < minX || s.end > maxX) bad += 1;
      slots.forEach((t, j) => {
        if (j === i) return;
        if (j > i && t.row === s.row && s.left < t.end + PAD && t.left < s.end + PAD) bad += 1;
        if (s.row >= t.row && rules[j].px > s.left - 4 && rules[j].px < s.end + 4) bad += 1;
      });
    });
    const rows = Math.max(...slots.map((s) => s.row)) + 1;
    const cost = bad * 1000 + rows * 10 + slots.filter((s) => !s.right).length;
    if (!best || cost < best.cost) best = { cost, slots };
  }
  return best.slots;
}

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
// '2025-08-01' -> 'AUG-2025', the form the files use.
const monLabel = (key) => `${MON[Number(key.slice(5, 7)) - 1]}-${key.slice(0, 4)}`;

function monthRange(first, last) {
  const out = [];
  let y = Number(first.slice(0, 4));
  let m = Number(first.slice(5, 7));
  const endY = Number(last.slice(0, 4));
  const endM = Number(last.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}-${String(m).padStart(2, '0')}-01`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

// "Not plotted: 23 reports with no incident month and 1 dated JAN-1900."
// Every number is read from the stats.
export function notPlottedNote(stats) {
  const parts = [];
  const none = Number(stats.no_incident_date) || 0;
  if (none) parts.push(`${none.toLocaleString()} ${none === 1 ? 'report' : 'reports'} with no incident month`);
  for (const d of stats.by_month || []) {
    if (d.month >= FIRST_PLOTTED) continue;
    const n = d.ads + d.adas + d.other;
    parts.push(`${n.toLocaleString()} dated ${monLabel(d.month)}`);
  }
  return parts.length ? `Not plotted: ${parts.join(' and ')}.` : '';
}

function CrashesByMonth({ stats, onFilter }) {
  const svgRef = useRef();
  const fullWidth = useContainerWidth(svgRef);

  useEffect(() => {
    const plotted = (stats.by_month || []).filter((d) => d.month >= FIRST_PLOTTED);
    if (!plotted.length || !fullWidth) return;
    const byKey = new Map(plotted.map((d) => [d.month.slice(0, 10), d]));
    const months = monthRange(plotted[0].month, plotted[plotted.length - 1].month);
    const data = months.map((key) => {
      const d = byKey.get(key) || {};
      return { key, ads: Number(d.ads) || 0, adas: Number(d.adas) || 0, other: Number(d.other) || 0 };
    });

    const narrow = fullWidth < 560;
    const margin = { right: 4, bottom: 26, left: 40 };
    const width = fullWidth - margin.left - margin.right;
    const x = d3.scaleBand().domain(months).range([0, width]).paddingInner(narrow ? 0.1 : 0.18);

    d3.select(svgRef.current).selectAll('*').remove();
    const root = d3.select(svgRef.current).attr('width', fullWidth);

    // Amendment rules sit within their month by day. Their labels are placed
    // before anything is drawn, because the rows they need set the top margin.
    const rules = AMENDMENTS.flatMap(([name, iso, said]) => {
      const key = `${iso.slice(0, 7)}-01`;
      if (x(key) === undefined) return [];
      const days = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0)).getUTCDate();
      const px = Math.round(x(key) + x.step() * ((Number(iso.slice(8, 10)) - 1) / days)) + 0.5;
      return [{ name, said, px }];
    });
    const probe = root.append('text').attr('class', 'value-label');
    for (const r of rules) {
      r.w = Math.ceil(Math.max(...[r.name, r.said].map((s) => probe.text(s).node().getComputedTextLength())));
    }
    probe.remove();
    const slots = placeLabels(rules, -margin.left, width + margin.right);
    const rows = slots.length ? Math.max(...slots.map((s) => s.row)) + 1 : 1;
    margin.top = 34 + (rows - 1) * ROW;
    const height = (narrow ? 240 : 300) - margin.top - margin.bottom;

    const svg = root
      .attr('height', height + margin.top + margin.bottom)
      .attr('viewBox', `0 0 ${fullWidth} ${height + margin.top + margin.bottom}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const stack = d3.stack().keys(SYSTEMS.map(([k]) => k))(data);
    const y = d3.scaleLinear()
      .domain([0, d3.max(data, (d) => d.ads + d.adas + d.other) * 1.05])
      .nice()
      .range([height, 0]);

    svg.append('g')
      .attr('class', 'axis axis-y')
      .call(d3.axisLeft(y).ticks(narrow ? 4 : 5).tickSize(-width).tickPadding(8).tickFormat(d3.format(',')));

    const januaries = months.filter((k) => k.endsWith('-01-01'));
    svg.append('g')
      .attr('class', 'axis axis-x')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x).tickValues(januaries).tickSize(0).tickPadding(9)
        .tickFormat((k) => (narrow ? `’${k.slice(2, 4)}` : k.slice(0, 4))));

    SYSTEMS.forEach(([key, label, color], i) => {
      svg.append('g')
        .selectAll('rect')
        .data(stack[i])
        .join('rect')
        .attr('class', 'bar')
        .attr('x', (d) => x(d.data.key))
        .attr('y', (d) => y(d[1]))
        .attr('width', x.bandwidth())
        .attr('height', (d) => Math.max(0, y(d[0]) - y(d[1])))
        .style('fill', color)
        .style('cursor', 'pointer')
        .on('mouseenter', function () { d3.select(this).style('opacity', 0.8); })
        .on('mouseleave', function () { d3.select(this).style('opacity', 1); hideTooltip(); })
        .on('mousemove', (event, d) => {
          const m = d.data;
          showTooltip(event, `<strong>${monLabel(m.key)}</strong>`
            + SYSTEMS.map(([k, l]) => `<br>${l}: ${m[k].toLocaleString()}`).join(''));
        })
        .on('click', (event, d) => { if (onFilter) onFilter({ key: 'year', value: d.data.key.slice(0, 4) }); });
    });

    // Each rule starts at its label's row (placeLabels above). Rules are drawn
    // first and labels carry a halo in the ground color, so if no clean
    // placement exists a rule passing behind a label still does not strike
    // through it.
    rules.forEach(({ px }, i) => {
      svg.append('line')
        .attr('class', 'baseline')
        .attr('x1', px).attr('x2', px)
        .attr('y1', -margin.top + 4 + slots[i].row * ROW).attr('y2', height);
    });
    rules.forEach(({ name, said, px }, i) => {
      const { row, right } = slots[i];
      const ax = right ? px + 4 : px - 4;
      const text = svg.append('text')
        .attr('class', 'value-label')
        .attr('text-anchor', right ? 'start' : 'end')
        .attr('y', -margin.top + 12 + row * ROW)
        .style('paint-order', 'stroke')
        .style('stroke', 'var(--color-ground)')
        .style('stroke-width', '4px')
        .style('stroke-linejoin', 'round');
      text.append('tspan').attr('x', ax).text(name);
      text.append('tspan').attr('x', ax).attr('dy', '1.2em').text(said);
    });

    svg.append('line')
      .attr('class', 'baseline')
      .attr('x1', 0).attr('x2', width)
      .attr('y1', height + 0.5).attr('y2', height + 0.5);
  }, [stats, fullWidth]);

  return <svg ref={svgRef} className="chart" style={{ width: '100%', height: 'auto' }} />;
}

export function mountCrashesByMonth(container, stats, { onFilter, noteEl } = {}) {
  if (!container) return;
  if (noteEl) noteEl.textContent = notPlottedNote(stats);
  createRoot(container).render(<CrashesByMonth stats={stats} onFilter={onFilter} />);
}
