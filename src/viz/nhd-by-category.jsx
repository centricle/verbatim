import React, { useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';
import { showTooltip, hideTooltip } from './tooltip.js';

function NhdByCategory({ stats, onFilter }) {
  const svgRef = useRef();

  useEffect(() => {
    if (!stats.by_category) return;
    const data = stats.by_category.slice(0, 10);

    const margin = { top: 30, right: 60, bottom: 20, left: 140 };
    const width = 440 - margin.left - margin.right;
    const height = 280 - margin.top - margin.bottom;

    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current)
      .attr('viewBox', `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const labels = data.map(d => d.category.replace(/ Deficiencies$/, ''));

    const y = d3.scaleBand()
      .domain(labels)
      .range([0, height])
      .padding(0.15);

    const x = d3.scaleLinear()
      .domain([0, d3.max(data, d => Number(d.total)) * 1.1])
      .range([0, width]);

    svg.selectAll('rect')
      .data(data)
      .join('rect')
      .attr('x', 0)
      .attr('y', (d, i) => y(labels[i]))
      .attr('width', d => x(Number(d.total)))
      .attr('height', y.bandwidth())
      .attr('fill', '#4a6741')
      .attr('rx', 2)
      .style('cursor', 'pointer')
      .on('mouseenter', function() { d3.select(this).style('opacity', 0.8); })
      .on('mouseleave', function() { d3.select(this).style('opacity', 1); hideTooltip(); })
      .on('mousemove', (event, d) => {
        showTooltip(event, `<strong>${d.category.replace(/ Deficiencies$/, '')}</strong><br>${Number(d.total).toLocaleString()} citations<br>${Number(d.serious).toLocaleString()} serious (G+)`);
      })
      .on('click', (event, d) => { if (onFilter) onFilter({ key: 'category', value: d.category }); });

    svg.selectAll('.label')
      .data(labels)
      .join('text')
      .attr('x', -4)
      .attr('y', d => y(d) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'end')
      .text(d => d.length > 22 ? d.slice(0, 22) + '...' : d)
      .style('fill', '#8a7e6b')
      .style('font-size', '8px')
      .style('font-family', 'monospace');

    svg.selectAll('.value')
      .data(data)
      .join('text')
      .attr('x', d => x(Number(d.total)) + 4)
      .attr('y', (d, i) => y(labels[i]) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .text(d => Number(d.total).toLocaleString())
      .style('fill', '#8a7e6b')
      .style('font-size', '9px');

    svg.append('text')
      .attr('x', 0).attr('y', -15)
      .text('Deficiencies by Category')
      .style('fill', '#2d2418').style('font-size', '13px').style('font-weight', '600');

  }, [stats]);

  return <svg ref={svgRef} style={{ width: '100%', height: 'auto' }} />;
}

export function mountNhdByCategory(container, stats, { onFilter } = {}) {
  if (!container) return;
  const root = createRoot(container);
  root.render(<NhdByCategory stats={stats} onFilter={onFilter} />);
}
