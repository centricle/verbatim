// Figure 1 on /corpus/: records per decade, stacked by collection. Decades
// with no records are drawn as empty decades, not skipped, so the axis is true
// time. Selecting a bar sets both year filters to that decade.
import React, { useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';
import { showTooltip, hideTooltip } from './tooltip.js';
import { useContainerWidth } from './chart-size.js';

const COLLECTIONS = [
  ['core', 'Core', 'var(--color-series-1)'],
  ['voices', 'Voices', 'var(--color-series-2)'],
];

// "Not plotted: 16 undated records." Read from the stats.
export function notPlottedNote(stats) {
  const n = Number(stats.undated) || 0;
  return n ? `Not plotted: ${n.toLocaleString()} undated ${n === 1 ? 'record' : 'records'}.` : '';
}

function CorpusByDecade({ stats, onFilter }) {
  const svgRef = useRef();
  const fullWidth = useContainerWidth(svgRef);

  useEffect(() => {
    const rows = stats.by_decade || [];
    if (!rows.length || !fullWidth) return;
    const byDecade = new Map(rows.map((d) => [Number(d.decade), d]));
    const decades = d3.range(Number(rows[0].decade), Number(rows[rows.length - 1].decade) + 10, 10);
    const data = decades.map((decade) => {
      const d = byDecade.get(decade) || {};
      return { decade, core: Number(d.core) || 0, voices: Number(d.voices) || 0 };
    });

    const narrow = fullWidth < 560;
    const margin = { top: 12, right: 4, bottom: 26, left: 40 };
    const width = fullWidth - margin.left - margin.right;
    const height = (narrow ? 220 : 280) - margin.top - margin.bottom;

    d3.select(svgRef.current).selectAll('*').remove();
    const svg = d3.select(svgRef.current)
      .attr('width', fullWidth)
      .attr('height', height + margin.top + margin.bottom)
      .attr('viewBox', `0 0 ${fullWidth} ${height + margin.top + margin.bottom}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3.scaleBand().domain(decades).range([0, width]).paddingInner(narrow ? 0.12 : 0.2);
    const stack = d3.stack().keys(COLLECTIONS.map(([k]) => k))(data);
    const y = d3.scaleLinear()
      .domain([0, d3.max(data, (d) => d.core + d.voices) * 1.05])
      .nice()
      .range([height, 0]);

    svg.append('g')
      .attr('class', 'axis axis-y')
      .call(d3.axisLeft(y).ticks(narrow ? 4 : 5).tickSize(-width).tickPadding(8).tickFormat(d3.format(',')));

    // Every fiftieth year on narrow screens, every twentieth otherwise.
    const every = narrow ? 50 : 20;
    svg.append('g')
      .attr('class', 'axis axis-x')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x).tickValues(decades.filter((d) => d % every === 0)).tickSize(0).tickPadding(9)
        .tickFormat((d) => (narrow ? String(d) : `${d}s`)));

    COLLECTIONS.forEach(([, , color], i) => {
      svg.append('g')
        .selectAll('rect')
        .data(stack[i])
        .join('rect')
        .attr('class', 'bar')
        .attr('x', (d) => x(d.data.decade))
        .attr('y', (d) => y(d[1]))
        .attr('width', x.bandwidth())
        .attr('height', (d) => Math.max(0, y(d[0]) - y(d[1])))
        .style('fill', color)
        .style('cursor', 'pointer')
        .on('mouseenter', function () { d3.select(this).style('opacity', 0.8); })
        .on('mouseleave', function () { d3.select(this).style('opacity', 1); hideTooltip(); })
        .on('mousemove', (event, d) => {
          const m = d.data;
          showTooltip(event, `<strong>${m.decade}s</strong>`
            + COLLECTIONS.map(([k, l]) => `<br>${l}: ${m[k].toLocaleString()}`).join(''));
        })
        .on('click', (event, d) => {
          if (onFilter) onFilter({ set: { from: String(d.data.decade), to: String(d.data.decade + 9) } });
        });
    });

    svg.append('line')
      .attr('class', 'baseline')
      .attr('x1', 0).attr('x2', width)
      .attr('y1', height + 0.5).attr('y2', height + 0.5);
  }, [stats, fullWidth]);

  return <svg ref={svgRef} className="chart" style={{ width: '100%', height: 'auto' }} />;
}

export function mountCorpusByDecade(container, stats, { onFilter, noteEl } = {}) {
  if (!container) return;
  if (noteEl) noteEl.textContent = notPlottedNote(stats);
  createRoot(container).render(<CorpusByDecade stats={stats} onFilter={onFilter} />);
}
