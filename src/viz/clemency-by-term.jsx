// Figure 1 on /clemency/: entries on each of DOJ's per-administration lists,
// stacked by type, in order of first grant. DOJ lists the two Trump
// administrations separately, so they are two bars. Selecting a bar sets the
// president filter (both of a president's terms).
import React, { useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';
import { showTooltip, hideTooltip } from './tooltip.js';
import { useContainerWidth, measureText, fitText } from './chart-size.js';

export const TYPES = [
  ['pardon', 'Pardons', 'var(--color-series-1)'],
  ['commutation', 'Commutations', 'var(--color-series-2)'],
  ['title', 'Listed by title', 'var(--color-series-3)'],
];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

/** "Donald Trump, 2025–present" from a by_term row. */
export const termLabel = (d) => `${d.president_name}, ${String(d.term).replace('-', '–')}`;

function ClemencyByTerm({ stats, onFilter }) {
  const svgRef = useRef();
  const fullWidth = useContainerWidth(svgRef);

  useEffect(() => {
    const data = (stats.by_term || []).map((d) => ({
      key: `${d.president}:${d.term}`,
      president: d.president,
      text: termLabel(d),
      ...Object.fromEntries(TYPES.map(([k]) => [k, Number(d[k]) || 0])),
    }));
    if (!data.length || !fullWidth) return;
    for (const d of data) d.total = TYPES.reduce((n, [k]) => n + d[k], 0);

    d3.select(svgRef.current).selectAll('*').remove();
    const labelWidth = measureText(svgRef.current, data.map((d) => d.text), 'cat-label');
    const valueWidth = measureText(svgRef.current, data.map((d) => d.total.toLocaleString()), 'value-label');
    const margin = { top: 4, right: valueWidth + 10, bottom: 4, left: Math.min(labelWidth, Math.round(fullWidth * 0.45)) + 12 };
    const rowHeight = 24;
    const height = data.length * rowHeight;
    const width = fullWidth - margin.left - margin.right;

    const svg = d3.select(svgRef.current)
      .attr('width', fullWidth)
      .attr('height', height + margin.top + margin.bottom)
      .attr('viewBox', `0 0 ${fullWidth} ${height + margin.top + margin.bottom}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const y = d3.scaleBand().domain(data.map((d) => d.key)).range([0, height]).padding(0.28);
    const x = d3.scaleLinear().domain([0, d3.max(data, (d) => d.total)]).range([0, width]);
    const stack = d3.stack().keys(TYPES.map(([k]) => k))(data);

    TYPES.forEach(([, , color], i) => {
      svg.append('g')
        .selectAll('rect')
        .data(stack[i])
        .join('rect')
        .attr('class', 'bar')
        .attr('x', (d) => x(d[0]))
        .attr('y', (d) => y(d.data.key))
        .attr('width', (d) => Math.max(0, x(d[1]) - x(d[0])))
        .attr('height', y.bandwidth())
        .style('fill', color)
        .style('cursor', onFilter ? 'pointer' : null)
        .on('mouseenter', function () { d3.select(this).style('opacity', 0.8); })
        .on('mouseleave', function () { d3.select(this).style('opacity', 1); hideTooltip(); })
        .on('mousemove', (event, d) => {
          const m = d.data;
          showTooltip(event, `<strong>${esc(m.text)}</strong>`
            + TYPES.filter(([k]) => m[k]).map(([k, l]) => `<br>${l}: ${m[k].toLocaleString()}`).join(''));
        })
        .on('click', (event, d) => { if (onFilter) onFilter({ key: 'president', value: d.data.president }); });
    });

    svg.selectAll('.cat-label')
      .data(data)
      .join('text')
      .attr('class', 'cat-label')
      .attr('x', -10)
      .attr('y', (d) => y(d.key) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'end')
      .text((d) => d.text)
      .each(function () { fitText(this, margin.left - 12); });

    svg.selectAll('.value-label')
      .data(data)
      .join('text')
      .attr('class', 'value-label')
      .attr('x', (d) => Math.max(1, x(d.total)) + 6)
      .attr('y', (d) => y(d.key) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .text((d) => d.total.toLocaleString());

    svg.append('line')
      .attr('class', 'baseline')
      .attr('x1', 0.5).attr('x2', 0.5)
      .attr('y1', 0).attr('y2', height);
  }, [stats, fullWidth]);

  return <svg ref={svgRef} className="chart" style={{ width: '100%', height: 'auto' }} />;
}

export function mountClemencyByTerm(container, stats, { onFilter } = {}) {
  if (!container) return;
  createRoot(container).render(<ClemencyByTerm stats={stats} onFilter={onFilter} />);
}
