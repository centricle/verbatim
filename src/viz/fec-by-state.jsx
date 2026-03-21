import React, { useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';

function FECByState({ stats }) {
  const svgRef = useRef();

  useEffect(() => {
    if (!stats.by_state) return;
    const data = stats.by_state.filter(d => d.state !== '00').slice(0, 15);

    const margin = { top: 30, right: 60, bottom: 20, left: 30 };
    const width = 440 - margin.left - margin.right;
    const barHeight = 22;
    const height = data.length * barHeight;

    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current)
      .attr('viewBox', `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3.scaleLinear()
      .domain([0, d3.max(data, d => Number(d.total_raised)) * 1.1])
      .range([0, width]);

    const y = d3.scaleBand()
      .domain(data.map(d => d.state))
      .range([0, height])
      .padding(0.2);

    const colorScale = d3.scaleLinear()
      .domain([0, d3.max(data, d => Number(d.total_raised))])
      .range(['#c4b899', '#6b4226']);

    svg.selectAll('rect')
      .data(data)
      .join('rect')
      .attr('x', 0)
      .attr('y', d => y(d.state))
      .attr('width', d => x(Number(d.total_raised)))
      .attr('height', y.bandwidth())
      .attr('fill', d => colorScale(Number(d.total_raised)))
      .attr('rx', 2);

    svg.selectAll('.label')
      .data(data)
      .join('text')
      .attr('x', -5)
      .attr('y', d => y(d.state) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'end')
      .text(d => d.state)
      .style('fill', '#8a7e6b')
      .style('font-size', '9px')
      .style('font-family', 'monospace');

    svg.selectAll('.value')
      .data(data)
      .join('text')
      .attr('x', d => x(Number(d.total_raised)) + 5)
      .attr('y', d => y(d.state) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .text(d => {
        const v = Number(d.total_raised);
        if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
        return `$${(v / 1e6).toFixed(0)}M`;
      })
      .style('fill', '#8a7e6b')
      .style('font-size', '9px');

    svg.append('text')
      .attr('x', 0).attr('y', -15)
      .text('Top States by Fundraising')
      .style('fill', '#2d2418').style('font-size', '13px').style('font-weight', '600');

  }, [stats]);

  return <svg ref={svgRef} style={{ width: '100%', height: 'auto' }} />;
}

export function mountFECByState(container, stats) {
  if (!container) return;
  const root = createRoot(container);
  root.render(<FECByState stats={stats} />);
}
