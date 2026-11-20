// Figure 1 on /disbursements/: the amount disbursed in each reporting period
// of the chamber shown, summed from the rows as loaded. Periods with no rows
// are drawn as empty periods, not skipped, so the axis is true time.
// Selecting a bar sets the period filter.
//
// The stats follow the chamber select, so the periods are one chamber's: the
// House's calendar quarters or the Senate's half years (April to September,
// October to March). The period length is read off the data, never mixed on
// one axis.
import React, { useRef, useEffect } from 'react';
import * as d3 from 'd3';
import { rootFor } from './mount.js';
import { showTooltip, hideTooltip } from './tooltip.js';
import { useContainerWidth } from './chart-size.js';
import { moneyExact, moneyShort, quarterKey, periodLabel, periodMonths } from './disbursements-format.js';

const iso = (y, m) => `${y}-${String(m).padStart(2, '0')}-01`;
const lastDay = (start, months) => {
  const y = Number(start.slice(0, 4));
  const m = Number(start.slice(5, 7)) + months - 1;
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
};

function periodRange(first, last, step) {
  const out = [];
  let y = Number(first.slice(0, 4));
  let m = Number(first.slice(5, 7));
  const end = last.slice(0, 7);
  for (;;) {
    const key = iso(y, m);
    out.push(key);
    if (key.slice(0, 7) >= end) return out;
    m += step;
    while (m > 12) { m -= 12; y += 1; }
  }
}

function DisbursementsByQuarter({ stats, onFilter }) {
  const svgRef = useRef();
  const fullWidth = useContainerWidth(svgRef);

  useEffect(() => {
    const periods = stats.by_period || [];
    if (!periods.length || !fullWidth) return;
    const byStart = new Map();
    for (const d of periods) {
      const key = String(d.period_start).slice(0, 10);
      const m = byStart.get(key) || { amount: 0, count: 0 };
      m.amount += Number(d.amount) || 0;
      m.count += Number(d.count) || 0;
      byStart.set(key, m);
    }
    const step = periodMonths(periods[0].period_start, periods[0].period_end);
    const starts = [...byStart.keys()].sort();
    const quarters = periodRange(starts[0], starts[starts.length - 1], step);
    const data = quarters.map((key) => ({ key, end: lastDay(key, step), ...(byStart.get(key) || { amount: 0, count: 0 }) }));

    const narrow = fullWidth < 560;
    const margin = { top: 12, right: 4, bottom: 26, left: 52 };
    const width = fullWidth - margin.left - margin.right;
    const height = (narrow ? 220 : 280) - margin.top - margin.bottom;

    d3.select(svgRef.current).selectAll('*').remove();
    const svg = d3.select(svgRef.current)
      .attr('width', fullWidth)
      .attr('height', height + margin.top + margin.bottom)
      .attr('viewBox', `0 0 ${fullWidth} ${height + margin.top + margin.bottom}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3.scaleBand().domain(quarters).range([0, width]).paddingInner(narrow ? 0.12 : 0.2);
    const y = d3.scaleLinear()
      .domain([0, d3.max(data, (d) => d.amount) * 1.05])
      .nice()
      .range([height, 0]);

    svg.append('g')
      .attr('class', 'axis axis-y')
      .call(d3.axisLeft(y).ticks(narrow ? 4 : 5).tickSize(-width).tickPadding(8).tickFormat(moneyShort));

    // Each year's first period (January for the House, April for the
    // Senate), every other year on narrow screens.
    const firstMonth = quarters.map((k) => k.slice(5, 7)).sort()[0];
    const januaries = quarters.filter((k) => k.slice(5, 7) === firstMonth
      && (!narrow || Number(k.slice(0, 4)) % 2 === 0));
    svg.append('g')
      .attr('class', 'axis axis-x')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x).tickValues(januaries).tickSize(0).tickPadding(9)
        .tickFormat((k) => k.slice(0, 4)));

    svg.append('g')
      .selectAll('rect')
      .data(data)
      .join('rect')
      .attr('class', 'bar')
      .attr('x', (d) => x(d.key))
      .attr('y', (d) => y(Math.max(0, d.amount)))
      .attr('width', x.bandwidth())
      .attr('height', (d) => Math.max(0, y(0) - y(Math.max(0, d.amount))))
      .style('fill', 'var(--color-figure)')
      .style('cursor', onFilter ? 'pointer' : null)
      .on('mouseenter', function () { d3.select(this).style('opacity', 0.8); })
      .on('mouseleave', function () { d3.select(this).style('opacity', 1); hideTooltip(); })
      .on('mousemove', (event, d) => {
        showTooltip(event, `<strong>${periodLabel(d.key, d.end)}</strong><br>${moneyExact(d.amount)}`
          + `<br>${d.count.toLocaleString()} rows`);
      })
      .on('click', (event, d) => { if (onFilter && d.count) onFilter({ key: 'quarter', value: quarterKey(d.key) }); });

    svg.append('line')
      .attr('class', 'baseline')
      .attr('x1', 0).attr('x2', width)
      .attr('y1', height + 0.5).attr('y2', height + 0.5);
  }, [stats, fullWidth]);

  return <svg ref={svgRef} className="chart" style={{ width: '100%', height: 'auto' }} />;
}

export function mountDisbursementsByQuarter(container, stats, { onFilter } = {}) {
  if (!container) return;
  rootFor(container).render(<DisbursementsByQuarter stats={stats} onFilter={onFilter} />);
}
