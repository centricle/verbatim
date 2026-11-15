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
    // Narrow screens may need a second row of rule labels (see below).
    const margin = { top: narrow ? 64 : 34, right: 4, bottom: 26, left: 40 };
    const width = fullWidth - margin.left - margin.right;
    const height = (narrow ? 240 : 300) - margin.top - margin.bottom;

    d3.select(svgRef.current).selectAll('*').remove();
    const svg = d3.select(svgRef.current)
      .attr('width', fullWidth)
      .attr('height', height + margin.top + margin.bottom)
      .attr('viewBox', `0 0 ${fullWidth} ${height + margin.top + margin.bottom}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3.scaleBand().domain(months).range([0, width]).paddingInner(narrow ? 0.1 : 0.18);
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

    // Amendment rules: placed within their month by day, labeled above the
    // plot. A label sits right of its rule, or left of it where it would run
    // past the plot's edge, and drops a row where it would overlap the label
    // before it (at 390 the two rules are about 100px apart). Rules are drawn
    // first and labels carry a halo in the ground color, so a rule passing
    // behind a label does not strike through it.
    const ROW = 30;
    const rules = AMENDMENTS.flatMap(([name, iso, said]) => {
      const key = `${iso.slice(0, 7)}-01`;
      if (x(key) === undefined) return [];
      const days = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0)).getUTCDate();
      const px = Math.round(x(key) + x.step() * ((Number(iso.slice(8, 10)) - 1) / days)) + 0.5;
      return [{ name, said, px }];
    });
    for (const { px } of rules) {
      svg.append('line')
        .attr('class', 'baseline')
        .attr('x1', px).attr('x2', px)
        .attr('y1', -margin.top + 4).attr('y2', height);
    }
    const placed = [];
    for (const { name, said, px } of rules) {
      const text = svg.append('text')
        .attr('class', 'value-label')
        .style('paint-order', 'stroke')
        .style('stroke', 'var(--color-ground)')
        .style('stroke-width', '4px')
        .style('stroke-linejoin', 'round');
      const a = text.append('tspan').text(name);
      const b = text.append('tspan').attr('dy', '1.2em').text(said);
      const w = Math.ceil(Math.max(a.node().getComputedTextLength(), b.node().getComputedTextLength()));
      const flip = px + 4 + w > width + margin.right;
      const left = flip ? px - 4 - w : px + 4;
      let row = 0;
      while (placed.some((p) => p.row === row && left < p.right + 8 && left + w > p.left - 8)) row += 1;
      placed.push({ left, right: left + w, row });
      const ax = flip ? px - 4 : px + 4;
      text.attr('text-anchor', flip ? 'end' : 'start').attr('y', -margin.top + 12 + row * ROW);
      a.attr('x', ax);
      b.attr('x', ax);
    }

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
