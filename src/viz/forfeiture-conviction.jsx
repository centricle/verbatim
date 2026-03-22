import React, { useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';
import { showTooltip, hideTooltip } from './tooltip.js';

function ForfeitureConviction({ stats, onFilter }) {
  const svgRef = useRef();

  useEffect(() => {
    if (!stats.by_conviction) return;
    const data = stats.by_conviction;

    const margin = { top: 30, right: 60, bottom: 20, left: 90 };
    const width = 440 - margin.left - margin.right;
    const barHeight = 40;
    const height = data.length * barHeight;

    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current)
      .attr('viewBox', `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3.scaleLinear()
      .domain([0, d3.max(data, d => Number(d.count)) * 1.1])
      .range([0, width]);

    const y = d3.scaleBand()
      .domain(data.map(d => d.conviction))
      .range([0, height])
      .padding(0.25);

    const colors = {
      'not reported': '#8a4a2a',
      'conviction': '#6b5a3e',
      'no conviction': '#4a6b5a',
    };

    svg.selectAll('rect')
      .data(data)
      .join('rect')
      .attr('x', 0)
      .attr('y', d => y(d.conviction))
      .attr('width', d => x(Number(d.count)))
      .attr('height', y.bandwidth())
      .attr('fill', d => colors[d.conviction] || '#8a7e6b')
      .attr('rx', 2)
      .style('cursor', 'pointer')
      .on('mouseenter', function() { d3.select(this).style('opacity', 0.8); })
      .on('mouseleave', function() { d3.select(this).style('opacity', 1); hideTooltip(); })
      .on('mousemove', (event, d) => {
        const pct = ((Number(d.count) / stats.total_properties) * 100).toFixed(1);
        showTooltip(event, `<strong>${(d.conviction || 'unknown').replace(/\b\w/g, c => c.toUpperCase())}</strong><br>${Number(d.count).toLocaleString()} (${pct}%)`);
      });

    svg.selectAll('.label')
      .data(data)
      .join('text')
      .attr('x', -8)
      .attr('y', d => y(d.conviction) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'end')
      .text(d => (d.conviction || 'unknown').replace(/\b\w/g, c => c.toUpperCase()))
      .style('fill', '#8a7e6b')
      .style('font-size', '10px');

    svg.selectAll('.value')
      .data(data)
      .join('text')
      .attr('x', d => x(Number(d.count)) + 4)
      .attr('y', d => y(d.conviction) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .text(d => {
        const pct = ((Number(d.count) / stats.total_properties) * 100).toFixed(1);
        return `${Number(d.count).toLocaleString()} (${pct}%)`;
      })
      .style('fill', '#8a7e6b')
      .style('font-size', '9px');

    svg.append('text')
      .attr('x', 0).attr('y', -15)
      .text('Conviction Status')
      .style('fill', '#2d2418').style('font-size', '13px').style('font-weight', '600');

  }, [stats]);

  return <svg ref={svgRef} style={{ width: '100%', height: 'auto' }} />;
}

export function mountForfeitureConviction(container, stats, { onFilter } = {}) {
  if (!container) return;
  const root = createRoot(container);
  root.render(<ForfeitureConviction stats={stats} onFilter={onFilter} />);
}
