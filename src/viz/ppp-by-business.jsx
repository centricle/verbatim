import React, { useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';

function PPPByBusiness({ stats }) {
  const svgRef = useRef();

  useEffect(() => {
    if (!stats.by_business_type) return;
    const data = stats.by_business_type.slice(0, 10);

    const margin = { top: 30, right: 60, bottom: 20, left: 120 };
    const width = 440 - margin.left - margin.right;
    const barHeight = 26;
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
      .domain(data.map(d => d.business_type))
      .range([0, height])
      .padding(0.2);

    svg.selectAll('rect')
      .data(data)
      .join('rect')
      .attr('x', 0)
      .attr('y', d => y(d.business_type))
      .attr('width', d => x(Number(d.total)))
      .attr('height', y.bandwidth())
      .attr('fill', '#52b788')
      .attr('rx', 2);

    svg.selectAll('.label')
      .data(data)
      .join('text')
      .attr('x', -8)
      .attr('y', d => y(d.business_type) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'end')
      .text(d => {
        const n = d.business_type;
        return n.length > 18 ? n.slice(0, 18) + '...' : n;
      })
      .style('fill', '#8a7e6b')
      .style('font-size', '8px');

    svg.selectAll('.value')
      .data(data)
      .join('text')
      .attr('x', d => x(Number(d.total)) + 5)
      .attr('y', d => y(d.business_type) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .text(d => Number(d.total).toLocaleString())
      .style('fill', '#8a7e6b')
      .style('font-size', '9px');

    svg.append('text')
      .attr('x', 0).attr('y', -15)
      .text('Loans by Business Type')
      .style('fill', '#2d2418').style('font-size', '13px').style('font-weight', '600');

  }, [stats]);

  return <svg ref={svgRef} style={{ width: '100%', height: 'auto' }} />;
}

export function mountPPPByBusiness(container, stats) {
  if (!container) return;
  const root = createRoot(container);
  root.render(<PPPByBusiness stats={stats} />);
}
