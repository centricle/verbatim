import React, { useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';

function ByParty({ stats }) {
  const svgRef = useRef();

  useEffect(() => {
    if (!stats.by_party) return;
    const data = stats.by_party.slice(0, 8);
    const partyColors = { DEM: '#2563eb', REP: '#dc2626', LIB: '#f59e0b', GRE: '#16a34a', IND: '#6b7280', NNE: '#9ca3af', CON: '#7c3aed', NPA: '#8b5cf6' };

    const margin = { top: 30, right: 60, bottom: 20, left: 40 };
    const width = 440 - margin.left - margin.right;
    const barHeight = 30;
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
      .domain(data.map(d => d.party))
      .range([0, height])
      .padding(0.25);

    svg.selectAll('rect')
      .data(data)
      .join('rect')
      .attr('x', 0)
      .attr('y', d => y(d.party))
      .attr('width', d => x(Number(d.total_raised)))
      .attr('height', y.bandwidth())
      .attr('fill', d => partyColors[d.party] || '#8a7e6b')
      .attr('rx', 2);

    svg.selectAll('.label')
      .data(data)
      .join('text')
      .attr('x', -5)
      .attr('y', d => y(d.party) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'end')
      .text(d => d.party)
      .style('fill', '#8a7e6b')
      .style('font-size', '9px')
      .style('font-family', 'monospace');

    svg.selectAll('.value')
      .data(data)
      .join('text')
      .attr('x', d => x(Number(d.total_raised)) + 5)
      .attr('y', d => y(d.party) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .text(d => {
        const v = Number(d.total_raised);
        if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
        if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
        return `$${(v / 1e3).toFixed(0)}K`;
      })
      .style('fill', '#8a7e6b')
      .style('font-size', '9px');

    svg.append('text')
      .attr('x', 0).attr('y', -15)
      .text('Total Raised by Party')
      .style('fill', '#2d2418').style('font-size', '13px').style('font-weight', '600');

  }, [stats]);

  return <svg ref={svgRef} style={{ width: '100%', height: 'auto' }} />;
}

export function mountByParty(container, stats) {
  if (!container) return;
  const root = createRoot(container);
  root.render(<ByParty stats={stats} />);
}
