import React, { useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';
import { showTooltip, hideTooltip } from './tooltip.js';
import { useContainerWidth, measureText } from './chart-size.js';

function fmtMoney(v) {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  return `$${(v / 1e6).toFixed(0)}M`;
}

function FECByState({ stats, onFilter }) {
  const svgRef = useRef();
  const fullWidth = useContainerWidth(svgRef);

  useEffect(() => {
    if (!stats.by_state || !fullWidth) return;
    const data = stats.by_state.filter(d => d.state !== '00').slice(0, 15);

    d3.select(svgRef.current).selectAll('*').remove();

    const labelWidth = measureText(svgRef.current, data.map(d => d.state), 'cat-label cat-label--ticker');
    const valueWidth = measureText(svgRef.current, data.map(d => fmtMoney(Number(d.total_raised))), 'value-label');
    const margin = { top: 4, right: valueWidth + 10, bottom: 4, left: labelWidth + 12 };
    const rowHeight = 22;
    const height = data.length * rowHeight;
    const width = fullWidth - margin.left - margin.right;

    const svg = d3.select(svgRef.current)
      .attr('width', fullWidth)
      .attr('height', height + margin.top + margin.bottom)
      .attr('viewBox', `0 0 ${fullWidth} ${height + margin.top + margin.bottom}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const maxVal = d3.max(data, d => Number(d.total_raised));

    const x = d3.scaleLinear()
      .domain([0, maxVal])
      .range([0, width]);

    const y = d3.scaleBand()
      .domain(data.map(d => d.state))
      .range([0, height])
      .padding(0.24);

    // One-hue ramp, light to dark by amount raised: a CSS color-mix of the
    // neutral figure color into the ground, since d3-color cannot parse oklch
    // or var().
    const shade = (v) => `color-mix(in oklch, var(--color-figure) ${Math.round(35 + (65 * v) / maxVal)}%, var(--color-ground))`;

    svg.selectAll('.bar')
      .data(data)
      .join('rect')
      .attr('class', 'bar')
      .attr('x', 0)
      .attr('y', d => y(d.state))
      .attr('width', d => Math.max(1, x(Number(d.total_raised))))
      .attr('height', y.bandwidth())
      .style('fill', d => shade(Number(d.total_raised)))
      .style('cursor', 'pointer')
      .on('mouseenter', function() { d3.select(this).style('opacity', 0.8); })
      .on('mouseleave', function() { d3.select(this).style('opacity', 1); hideTooltip(); })
      .on('mousemove', (event, d) => {
        const v = Number(d.total_raised);
        const fmt = v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : `$${(v / 1e6).toFixed(0)}M`;
        showTooltip(event, `<strong>${d.state}</strong><br>${fmt} raised`);
      })
      .on('click', (event, d) => { if (onFilter) onFilter({ key: 'state', value: d.state }); });

    svg.selectAll('.cat-label')
      .data(data)
      .join('text')
      .attr('class', 'cat-label cat-label--ticker')
      .attr('x', -10)
      .attr('y', d => y(d.state) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'end')
      .text(d => d.state);

    svg.selectAll('.value-label')
      .data(data)
      .join('text')
      .attr('class', 'value-label')
      .attr('x', d => Math.max(1, x(Number(d.total_raised))) + 6)
      .attr('y', d => y(d.state) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .text(d => fmtMoney(Number(d.total_raised)));

    // Zero line in ink
    svg.append('line')
      .attr('class', 'baseline')
      .attr('x1', 0.5).attr('x2', 0.5)
      .attr('y1', 0).attr('y2', height);

  }, [stats, fullWidth]);

  return <svg ref={svgRef} className="chart" style={{ width: '100%', height: 'auto' }} />;
}

export function mountFECByState(container, stats, { onFilter } = {}) {
  if (!container) return;
  const root = createRoot(container);
  root.render(<FECByState stats={stats} onFilter={onFilter} />);
}
