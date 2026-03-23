import React, { useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';
import { showTooltip, hideTooltip } from './tooltip.js';

function NhdByYear({ stats, onFilter }) {
  const svgRef = useRef();

  useEffect(() => {
    if (!stats.by_year) return;
    const data = stats.by_year.filter(d => d.year >= 2020);

    const margin = { top: 30, right: 20, bottom: 30, left: 50 };
    const width = 440 - margin.left - margin.right;
    const height = 280 - margin.top - margin.bottom;

    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current)
      .attr('viewBox', `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3.scaleLinear()
      .domain(d3.extent(data, d => d.year))
      .range([0, width]);

    const y = d3.scaleLinear()
      .domain([0, d3.max(data, d => Number(d.total)) * 1.1])
      .range([height, 0]);

    // Total deficiencies line
    const line = d3.line()
      .x(d => x(d.year))
      .y(d => y(Number(d.total)));

    svg.append('path')
      .datum(data)
      .attr('d', line)
      .attr('fill', 'none')
      .attr('stroke', '#6b5a3e')
      .attr('stroke-width', 2);

    // Jeopardy line (J/K/L)
    const yJeopardy = d3.scaleLinear()
      .domain([0, d3.max(data, d => Number(d.jeopardy)) * 1.1])
      .range([height, 0]);

    const jLine = d3.line()
      .x(d => x(d.year))
      .y(d => yJeopardy(Number(d.jeopardy)));

    svg.append('path')
      .datum(data)
      .attr('d', jLine)
      .attr('fill', 'none')
      .attr('stroke', '#8b3a3a')
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '4,3');

    // Dots for total
    svg.selectAll('.dot-total')
      .data(data)
      .join('circle')
      .attr('cx', d => x(d.year))
      .attr('cy', d => y(Number(d.total)))
      .attr('r', 4)
      .attr('fill', '#6b5a3e')
      .style('cursor', 'pointer')
      .on('mouseenter', function() { d3.select(this).attr('r', 6); })
      .on('mouseleave', function() { d3.select(this).attr('r', 4); hideTooltip(); })
      .on('mousemove', (event, d) => {
        showTooltip(event, `<strong>${d.year}</strong><br>${Number(d.total).toLocaleString()} total deficiencies<br>${Number(d.jeopardy).toLocaleString()} immediate jeopardy`);
      });

    // X axis
    svg.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x).ticks(data.length).tickFormat(d3.format('d')))
      .selectAll('text')
      .style('fill', '#8a7e6b')
      .style('font-size', '9px');

    svg.selectAll('.domain, .tick line').attr('stroke', '#d4c9a8');

    // Y axis
    svg.append('g')
      .call(d3.axisLeft(y).ticks(5).tickFormat(d => d >= 1000 ? (d / 1000) + 'k' : d))
      .selectAll('text')
      .style('fill', '#8a7e6b')
      .style('font-size', '9px');

    // Legend
    svg.append('line').attr('x1', width - 100).attr('x2', width - 80).attr('y1', -8).attr('y2', -8)
      .attr('stroke', '#6b5a3e').attr('stroke-width', 2);
    svg.append('text').attr('x', width - 76).attr('y', -5).text('Total')
      .style('fill', '#8a7e6b').style('font-size', '8px');

    svg.append('line').attr('x1', width - 50).attr('x2', width - 30).attr('y1', -8).attr('y2', -8)
      .attr('stroke', '#8b3a3a').attr('stroke-width', 2).attr('stroke-dasharray', '4,3');
    svg.append('text').attr('x', width - 26).attr('y', -5).text('Jeopardy')
      .style('fill', '#8b3a3a').style('font-size', '8px');

    svg.append('text')
      .attr('x', 0).attr('y', -15)
      .text('Deficiencies by Year')
      .style('fill', '#2d2418').style('font-size', '13px').style('font-weight', '600');

  }, [stats]);

  return <svg ref={svgRef} style={{ width: '100%', height: 'auto' }} />;
}

export function mountNhdByYear(container, stats, { onFilter } = {}) {
  if (!container) return;
  const root = createRoot(container);
  root.render(<NhdByYear stats={stats} onFilter={onFilter} />);
}
