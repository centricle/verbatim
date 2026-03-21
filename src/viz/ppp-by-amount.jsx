import React, { useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';

function PPPByAmount({ stats }) {
  const svgRef = useRef();

  useEffect(() => {
    if (!stats.amount_distribution) return;
    const data = stats.amount_distribution;

    const margin = { top: 30, right: 20, bottom: 50, left: 80 };
    const width = 440 - margin.left - margin.right;
    const height = 260 - margin.top - margin.bottom;

    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current)
      .attr('viewBox', `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3.scaleBand()
      .domain(data.map(d => d.bucket))
      .range([0, width])
      .padding(0.15);

    const maxVal = d3.max(data, d => Number(d.total));
    const y = d3.scaleLinear()
      .domain([0, maxVal * 1.1])
      .range([height, 0]);

    svg.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x))
      .selectAll('text')
      .style('fill', '#8a7e6b')
      .style('font-size', '8px')
      .attr('transform', 'rotate(-30)')
      .attr('text-anchor', 'end');

    svg.append('g')
      .call(d3.axisLeft(y).ticks(5).tickFormat(v => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v))
      .selectAll('text')
      .style('fill', '#8a7e6b')
      .style('font-size', '9px');

    svg.selectAll('.domain, line').style('stroke', '#c4b899');

    const colorScale = d3.scaleLinear()
      .domain([0, data.length - 1])
      .range(['#95d5b2', '#1b4332']);

    svg.selectAll('rect')
      .data(data)
      .join('rect')
      .attr('x', d => x(d.bucket))
      .attr('y', d => y(Number(d.total)))
      .attr('width', x.bandwidth())
      .attr('height', d => height - y(Number(d.total)))
      .attr('fill', (_, i) => colorScale(i))
      .attr('rx', 2);

    svg.append('text')
      .attr('x', 0).attr('y', -15)
      .text('Loan Size Distribution')
      .style('fill', '#2d2418').style('font-size', '13px').style('font-weight', '600');

  }, [stats]);

  return <svg ref={svgRef} style={{ width: '100%', height: 'auto' }} />;
}

export function mountPPPByAmount(container, stats) {
  if (!container) return;
  const root = createRoot(container);
  root.render(<PPPByAmount stats={stats} />);
}
