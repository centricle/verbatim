import React, { useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';
import { showTooltip, hideTooltip } from './tooltip.js';

function ByYear({ stats, onFilter }) {
  const svgRef = useRef();

  useEffect(() => {
    if (!stats.by_year) return;
    const data = stats.by_year.filter(d => d.year >= 2000);

    const margin = { top: 30, right: 20, bottom: 50, left: 50 };
    const width = 440 - margin.left - margin.right;
    const height = 260 - margin.top - margin.bottom;

    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current)
      .attr('viewBox', `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3.scaleBand()
      .domain(data.map(d => d.year))
      .range([0, width])
      .padding(0.12);

    const maxVal = d3.max(data, d => Number(d.value));
    const y = d3.scaleLinear()
      .domain([0, maxVal * 1.1])
      .range([height, 0]);

    // Axes
    svg.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x).tickValues(data.filter((_, i) => i % 2 === 0).map(d => d.year)))
      .selectAll('text')
      .style('fill', '#8a7e6b')
      .style('font-size', '9px')
      .attr('transform', 'rotate(-45)')
      .attr('text-anchor', 'end');

    svg.append('g')
      .call(d3.axisLeft(y).ticks(5).tickFormat(v => {
        if (v >= 1e9) return `$${(v / 1e9).toFixed(0)}B`;
        if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
        return `$${(v / 1e3).toFixed(0)}K`;
      }))
      .selectAll('text')
      .style('fill', '#8a7e6b')
      .style('font-size', '9px');

    svg.selectAll('.domain, line').style('stroke', '#c4b899');

    // Color gradient by value
    const colorScale = d3.scaleLinear()
      .domain([0, maxVal])
      .range(['#c4b899', '#8a4a2a']);

    // Bars
    svg.selectAll('rect')
      .data(data)
      .join('rect')
      .attr('x', d => x(d.year))
      .attr('y', d => y(Number(d.value)))
      .attr('width', x.bandwidth())
      .attr('height', d => height - y(Number(d.value)))
      .attr('fill', d => colorScale(Number(d.value)))
      .attr('rx', 2)
      .style('cursor', 'pointer')
      .on('mouseenter', function() { d3.select(this).style('opacity', 0.8); })
      .on('mouseleave', function() { d3.select(this).style('opacity', 1); hideTooltip(); })
      .on('mousemove', (event, d) => {
        const v = Number(d.value);
        const fmt = v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(0)}M` : `$${(v / 1e3).toFixed(0)}K`;
        showTooltip(event, `<strong>${d.year}</strong><br>${fmt} transferred`);
      })
      .on('click', (event, d) => { if (onFilter) onFilter({ key: 'year', value: String(d.year) }); });

    // Title
    svg.append('text')
      .attr('x', 0).attr('y', -15)
      .text('Transfers by Year (Value)')
      .style('fill', '#2d2418').style('font-size', '13px').style('font-weight', '600');

  }, [stats]);

  return <svg ref={svgRef} style={{ width: '100%', height: 'auto' }} />;
}

export function mountByYear(container, stats, { onFilter } = {}) {
  if (!container) return;
  const root = createRoot(container);
  root.render(<ByYear stats={stats} onFilter={onFilter} />);
}
