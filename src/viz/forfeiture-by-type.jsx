import React, { useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';
import { showTooltip, hideTooltip } from './tooltip.js';

function ForfeitureByType({ stats, onFilter }) {
  const svgRef = useRef();

  useEffect(() => {
    if (!stats.by_prop_type) return;
    const data = stats.by_prop_type;

    const margin = { top: 30, right: 60, bottom: 20, left: 90 };
    const width = 440 - margin.left - margin.right;
    const barHeight = 36;
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
      .domain(data.map(d => d.prop_type))
      .range([0, height])
      .padding(0.25);

    const colors = {
      'currency': '#8a4a2a',
      'vehicles': '#6b5a3e',
      'real property': '#4a6b5a',
      'other': '#8a7e6b',
    };

    svg.selectAll('rect')
      .data(data)
      .join('rect')
      .attr('x', 0)
      .attr('y', d => y(d.prop_type))
      .attr('width', d => x(Number(d.count)))
      .attr('height', y.bandwidth())
      .attr('fill', d => colors[d.prop_type] || '#8a7e6b')
      .attr('rx', 2)
      .style('cursor', 'pointer')
      .on('mouseenter', function() { d3.select(this).style('opacity', 0.8); })
      .on('mouseleave', function() { d3.select(this).style('opacity', 1); hideTooltip(); })
      .on('mousemove', (event, d) => {
        showTooltip(event, `<strong>${(d.prop_type || 'unknown').replace(/\b\w/g, c => c.toUpperCase())}</strong><br>${Number(d.count).toLocaleString()} properties`);
      })
      .on('click', (event, d) => { if (onFilter) onFilter({ key: 'prop_type', value: d.prop_type }); });

    svg.selectAll('.label')
      .data(data)
      .join('text')
      .attr('x', -8)
      .attr('y', d => y(d.prop_type) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'end')
      .text(d => (d.prop_type || 'unknown').replace(/\b\w/g, c => c.toUpperCase()))
      .style('fill', '#8a7e6b')
      .style('font-size', '10px');

    svg.selectAll('.value')
      .data(data)
      .join('text')
      .attr('x', d => x(Number(d.count)) + 4)
      .attr('y', d => y(d.prop_type) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .text(d => Number(d.count).toLocaleString())
      .style('fill', '#8a7e6b')
      .style('font-size', '9px');

    svg.append('text')
      .attr('x', 0).attr('y', -15)
      .text('Properties by Type')
      .style('fill', '#2d2418').style('font-size', '13px').style('font-weight', '600');

  }, [stats]);

  return <svg ref={svgRef} style={{ width: '100%', height: 'auto' }} />;
}

export function mountForfeitureByType(container, stats, { onFilter } = {}) {
  if (!container) return;
  const root = createRoot(container);
  root.render(<ForfeitureByType stats={stats} onFilter={onFilter} />);
}
