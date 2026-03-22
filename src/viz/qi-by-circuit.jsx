import React, { useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';

function QiByCircuit({ stats }) {
  const svgRef = useRef();

  useEffect(() => {
    if (!stats.by_circuit) return;
    const data = stats.by_circuit;

    const margin = { top: 30, right: 50, bottom: 20, left: 150 };
    const width = 540 - margin.left - margin.right;
    const height = 280 - margin.top - margin.bottom;

    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current)
      .attr('viewBox', `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const y = d3.scaleBand()
      .domain(data.map(d => d.circuit))
      .range([0, height])
      .padding(0.15);

    const x = d3.scaleLinear()
      .domain([0, d3.max(data, d => Number(d.count)) * 1.1])
      .range([0, width]);

    svg.selectAll('rect')
      .data(data)
      .join('rect')
      .attr('x', 0)
      .attr('y', d => y(d.circuit))
      .attr('width', d => x(Number(d.count)))
      .attr('height', y.bandwidth())
      .attr('fill', '#6b5a3e')
      .attr('rx', 2);

    svg.selectAll('.label')
      .data(data)
      .join('text')
      .attr('x', -4)
      .attr('y', d => y(d.circuit) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'end')
      .text(d => d.circuit)
      .style('fill', '#8a7e6b')
      .style('font-size', '9px')
      .style('font-family', 'monospace');

    svg.selectAll('.value')
      .data(data)
      .join('text')
      .attr('x', d => x(Number(d.count)) + 4)
      .attr('y', d => y(d.circuit) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .text(d => Number(d.count).toLocaleString())
      .style('fill', '#8a7e6b')
      .style('font-size', '9px');

    svg.append('text')
      .attr('x', 0).attr('y', -15)
      .text('Cases by Circuit Court')
      .style('fill', '#2d2418').style('font-size', '13px').style('font-weight', '600');

  }, [stats]);

  return <svg ref={svgRef} style={{ width: '100%', height: 'auto' }} />;
}

export function mountQiByCircuit(container, stats) {
  if (!container) return;
  const root = createRoot(container);
  root.render(<QiByCircuit stats={stats} />);
}
