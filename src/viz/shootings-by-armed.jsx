import React, { useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';

function ShootingsByArmed({ stats }) {
  const svgRef = useRef();

  useEffect(() => {
    if (!stats.by_armed) return;
    const data = stats.by_armed
      .sort((a, b) => Number(b.total) - Number(a.total))
      .slice(0, 12);

    const margin = { top: 30, right: 50, bottom: 20, left: 100 };
    const width = 440 - margin.left - margin.right;
    const barHeight = 24;
    const height = data.length * barHeight;

    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current)
      .attr('viewBox', `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3.scaleLinear()
      .domain([0, d3.max(data, d => Number(d.total)) * 1.1])
      .range([0, width]);

    const y = d3.scaleBand()
      .domain(data.map(d => d.armed))
      .range([0, height])
      .padding(0.2);

    svg.selectAll('rect')
      .data(data)
      .join('rect')
      .attr('x', 0)
      .attr('y', d => y(d.armed))
      .attr('width', d => x(Number(d.total)))
      .attr('height', y.bandwidth())
      .attr('fill', '#8a4a2a')
      .attr('rx', 2);

    svg.selectAll('.label')
      .data(data)
      .join('text')
      .attr('x', -8)
      .attr('y', d => y(d.armed) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'end')
      .text(d => {
        const label = (d.armed || 'unknown').replace(/_/g, ' ');
        return label.length > 14 ? label.slice(0, 14) + '...' : label;
      })
      .style('fill', '#8a7e6b')
      .style('font-size', '9px');

    svg.selectAll('.value')
      .data(data)
      .join('text')
      .attr('x', d => x(Number(d.total)) + 5)
      .attr('y', d => y(d.armed) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .text(d => Number(d.total).toLocaleString())
      .style('fill', '#8a7e6b')
      .style('font-size', '9px');

    svg.append('text')
      .attr('x', 0).attr('y', -15)
      .text('Armed Status')
      .style('fill', '#2d2418').style('font-size', '13px').style('font-weight', '600');

  }, [stats]);

  return <svg ref={svgRef} style={{ width: '100%', height: 'auto' }} />;
}

export function mountShootingsByArmed(container, stats) {
  if (!container) return;
  const root = createRoot(container);
  root.render(<ShootingsByArmed stats={stats} />);
}
