import React, { useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';
import { showTooltip, hideTooltip } from './tooltip.js';

function OshaBySector({ stats, onFilter }) {
  const svgRef = useRef();

  useEffect(() => {
    if (!stats.by_sector) return;
    const data = stats.by_sector.slice(0, 12);

    const margin = { top: 30, right: 70, bottom: 20, left: 120 };
    const width = 440 - margin.left - margin.right;
    const height = 280 - margin.top - margin.bottom;

    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current)
      .attr('viewBox', `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const truncate = s => s.length > 25 ? s.slice(0, 23) + '\u2026' : s;

    const y = d3.scaleBand()
      .domain(data.map(d => d.sector))
      .range([0, height])
      .padding(0.15);

    const x = d3.scaleLinear()
      .domain([0, d3.max(data, d => Number(d.injuries)) * 1.1])
      .range([0, width]);

    svg.selectAll('rect')
      .data(data)
      .join('rect')
      .attr('x', 0)
      .attr('y', d => y(d.sector))
      .attr('width', d => x(Number(d.injuries)))
      .attr('height', y.bandwidth())
      .attr('fill', '#4a6741')
      .attr('rx', 2)
      .style('cursor', 'pointer')
      .on('mouseenter', function() { d3.select(this).style('opacity', 0.8); })
      .on('mouseleave', function() { d3.select(this).style('opacity', 1); hideTooltip(); })
      .on('mousemove', (event, d) => {
        showTooltip(event, `<strong>${d.sector}</strong><br>${Number(d.injuries).toLocaleString()} injuries<br>${Number(d.deaths).toLocaleString()} deaths<br>${Number(d.reports).toLocaleString()} reports<br>${Number(d.employees).toLocaleString()} employees`);
      })
      .on('click', (event, d) => { if (onFilter) onFilter({ key: 'sector', value: d.sector }); });

    svg.selectAll('.label')
      .data(data)
      .join('text')
      .attr('x', -4)
      .attr('y', d => y(d.sector) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'end')
      .text(d => truncate(d.sector))
      .style('fill', '#8a7e6b')
      .style('font-size', '8px');

    svg.selectAll('.value')
      .data(data)
      .join('text')
      .attr('x', d => x(Number(d.injuries)) + 4)
      .attr('y', d => y(d.sector) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .text(d => Number(d.injuries).toLocaleString())
      .style('fill', '#8a7e6b')
      .style('font-size', '9px');

    svg.append('text')
      .attr('x', 0).attr('y', -15)
      .text('Injuries by Sector')
      .style('fill', '#2d2418').style('font-size', '13px').style('font-weight', '600');

  }, [stats]);

  return <svg ref={svgRef} style={{ width: '100%', height: 'auto' }} />;
}

export function mountOshaBySector(container, stats, { onFilter } = {}) {
  if (!container) return;
  const root = createRoot(container);
  root.render(<OshaBySector stats={stats} onFilter={onFilter} />);
}
