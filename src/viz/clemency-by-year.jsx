// Figure 2 on /clemency/: entries per year granted, stacked by type. Years
// with no entries are drawn as empty years, not skipped, so the axis is true
// time. Selecting a bar sets the year filter.
import React, { useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';
import { showTooltip, hideTooltip } from './tooltip.js';
import { useContainerWidth } from './chart-size.js';
import { TYPES } from './clemency-by-term.jsx';

function ClemencyByYear({ stats, onFilter }) {
  const svgRef = useRef();
  const fullWidth = useContainerWidth(svgRef);

  useEffect(() => {
    const rows = stats.by_year || [];
    if (!rows.length || !fullWidth) return;
    const byYear = new Map(rows.map((d) => [Number(d.year), d]));
    const years = d3.range(Number(rows[0].year), Number(rows[rows.length - 1].year) + 1);
    const data = years.map((year) => {
      const d = byYear.get(year) || {};
      return { year, ...Object.fromEntries(TYPES.map(([k]) => [k, Number(d[k]) || 0])) };
    });

    const narrow = fullWidth < 560;
    const margin = { top: 12, right: 4, bottom: 26, left: 44 };
    const width = fullWidth - margin.left - margin.right;
    const height = (narrow ? 220 : 280) - margin.top - margin.bottom;

    d3.select(svgRef.current).selectAll('*').remove();
    const svg = d3.select(svgRef.current)
      .attr('width', fullWidth)
      .attr('height', height + margin.top + margin.bottom)
      .attr('viewBox', `0 0 ${fullWidth} ${height + margin.top + margin.bottom}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3.scaleBand().domain(years).range([0, width]).paddingInner(narrow ? 0.12 : 0.2);
    const stack = d3.stack().keys(TYPES.map(([k]) => k))(data);
    const y = d3.scaleLinear()
      .domain([0, d3.max(data, (d) => TYPES.reduce((n, [k]) => n + d[k], 0)) * 1.05])
      .nice()
      .range([height, 0]);

    svg.append('g')
      .attr('class', 'axis axis-y')
      .call(d3.axisLeft(y).ticks(narrow ? 4 : 5).tickSize(-width).tickPadding(8).tickFormat(d3.format(',')));

    // Every tenth year on narrow screens, every fifth otherwise.
    const every = narrow ? 10 : 5;
    svg.append('g')
      .attr('class', 'axis axis-x')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x).tickValues(years.filter((d) => d % every === 0)).tickSize(0).tickPadding(9)
        .tickFormat(String));

    TYPES.forEach(([, , color], i) => {
      svg.append('g')
        .selectAll('rect')
        .data(stack[i])
        .join('rect')
        .attr('class', 'bar')
        .attr('x', (d) => x(d.data.year))
        .attr('y', (d) => y(d[1]))
        .attr('width', x.bandwidth())
        .attr('height', (d) => Math.max(0, y(d[0]) - y(d[1])))
        .style('fill', color)
        .style('cursor', 'pointer')
        .on('mouseenter', function () { d3.select(this).style('opacity', 0.8); })
        .on('mouseleave', function () { d3.select(this).style('opacity', 1); hideTooltip(); })
        .on('mousemove', (event, d) => {
          const m = d.data;
          showTooltip(event, `<strong>${m.year}</strong>`
            + TYPES.filter(([k]) => m[k]).map(([k, l]) => `<br>${l}: ${m[k].toLocaleString()}`).join(''));
        })
        .on('click', (event, d) => { if (onFilter) onFilter({ key: 'year', value: String(d.data.year) }); });
    });

    svg.append('line')
      .attr('class', 'baseline')
      .attr('x1', 0).attr('x2', width)
      .attr('y1', height + 0.5).attr('y2', height + 0.5);
  }, [stats, fullWidth]);

  return <svg ref={svgRef} className="chart" style={{ width: '100%', height: 'auto' }} />;
}

export function mountClemencyByYear(container, stats, { onFilter } = {}) {
  if (!container) return;
  createRoot(container).render(<ClemencyByYear stats={stats} onFilter={onFilter} />);
}
