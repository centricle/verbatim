import React, { useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';
import { showTooltip, hideTooltip } from './tooltip.js';
import { useContainerWidth, measureText } from './chart-size.js';

// Rulings are categories with no good/bad color: two series hues, a third
// for mixed, and the neutral for cases where immunity was not reached.
const COLORS = {
  'granted': 'var(--color-series-2)',
  'denied': 'var(--color-series-1)',
  'mixed': 'var(--color-series-3)',
  'not reached': 'var(--color-other)',
};

const label = (r) => (r || 'unknown').replace(/\b\w/g, c => c.toUpperCase());

function QiByRuling({ stats, onFilter }) {
  const svgRef = useRef();
  const fullWidth = useContainerWidth(svgRef);

  useEffect(() => {
    if (!stats.by_ruling || !fullWidth) return;
    const data = stats.by_ruling;

    const total = d3.sum(data, d => Number(d.count));
    const valueText = (d) => {
      const pct = ((Number(d.count) / total) * 100).toFixed(1);
      return `${Number(d.count).toLocaleString()} (${pct}%)`;
    };

    d3.select(svgRef.current).selectAll('*').remove();

    const labelWidth = measureText(svgRef.current, data.map(d => label(d.qi_ruling)), 'cat-label');
    const valueWidth = measureText(svgRef.current, data.map(valueText), 'value-label');
    const margin = { top: 4, right: valueWidth + 10, bottom: 4, left: labelWidth + 12 };
    const rowHeight = 40;
    const height = data.length * rowHeight;
    const width = fullWidth - margin.left - margin.right;

    const svg = d3.select(svgRef.current)
      .attr('width', fullWidth)
      .attr('height', height + margin.top + margin.bottom)
      .attr('viewBox', `0 0 ${fullWidth} ${height + margin.top + margin.bottom}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3.scaleLinear()
      .domain([0, d3.max(data, d => Number(d.count))])
      .range([0, width]);

    const y = d3.scaleBand()
      .domain(data.map(d => d.qi_ruling))
      .range([0, height])
      .padding(0.3);

    svg.selectAll('.bar')
      .data(data)
      .join('rect')
      .attr('class', 'bar')
      .attr('x', 0)
      .attr('y', d => y(d.qi_ruling))
      .attr('width', d => Math.max(1, x(Number(d.count))))
      .attr('height', y.bandwidth())
      .style('fill', d => COLORS[d.qi_ruling] || 'var(--color-other)')
      .style('cursor', 'pointer')
      .on('mouseenter', function() { d3.select(this).style('opacity', 0.8); })
      .on('mouseleave', function() { d3.select(this).style('opacity', 1); hideTooltip(); })
      .on('mousemove', (event, d) => {
        const pct = ((Number(d.count) / total) * 100).toFixed(1);
        showTooltip(event, `<strong>${(d.qi_ruling || 'unknown').replace(/\b\w/g, c => c.toUpperCase())}</strong><br>${Number(d.count).toLocaleString()} cases (${pct}%)`);
      })
      .on('click', (event, d) => { if (onFilter) onFilter({ key: 'ruling', value: d.qi_ruling }); });

    svg.selectAll('.cat-label')
      .data(data)
      .join('text')
      .attr('class', 'cat-label')
      .attr('x', -10)
      .attr('y', d => y(d.qi_ruling) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'end')
      .text(d => label(d.qi_ruling));

    svg.selectAll('.value-label')
      .data(data)
      .join('text')
      .attr('class', 'value-label')
      .attr('x', d => Math.max(1, x(Number(d.count))) + 6)
      .attr('y', d => y(d.qi_ruling) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .text(valueText);

    // Zero line in ink
    svg.append('line')
      .attr('class', 'baseline')
      .attr('x1', 0.5).attr('x2', 0.5)
      .attr('y1', 0).attr('y2', height);

  }, [stats, fullWidth]);

  return <svg ref={svgRef} className="chart" style={{ width: '100%', height: 'auto' }} />;
}

export function mountQiByRuling(container, stats, { onFilter } = {}) {
  if (!container) return;
  const root = createRoot(container);
  root.render(<QiByRuling stats={stats} onFilter={onFilter} />);
}
