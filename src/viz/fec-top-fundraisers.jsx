import React, { useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';

function TopFundraisers({ stats }) {
  const svgRef = useRef();

  useEffect(() => {
    if (!stats.top_fundraisers) return;
    const data = stats.top_fundraisers.slice(0, 12);
    const partyColors = { DEM: '#2563eb', REP: '#dc2626', LIB: '#f59e0b', GRE: '#16a34a' };

    const margin = { top: 30, right: 60, bottom: 20, left: 120 };
    const width = 440 - margin.left - margin.right;
    const barHeight = 24;
    const height = data.length * barHeight;

    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current)
      .attr('viewBox', `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3.scaleLinear()
      .domain([0, d3.max(data, d => Number(d.total_receipts)) * 1.1])
      .range([0, width]);

    const y = d3.scaleBand()
      .domain(data.map(d => d.cand_name))
      .range([0, height])
      .padding(0.2);

    svg.selectAll('rect')
      .data(data)
      .join('rect')
      .attr('x', 0)
      .attr('y', d => y(d.cand_name))
      .attr('width', d => x(Number(d.total_receipts)))
      .attr('height', y.bandwidth())
      .attr('fill', d => partyColors[d.party] || '#8a7e6b')
      .attr('rx', 2);

    svg.selectAll('.label')
      .data(data)
      .join('text')
      .attr('x', -8)
      .attr('y', d => y(d.cand_name) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'end')
      .text(d => {
        const parts = d.cand_name.split(',');
        const last = parts[0] || '';
        return last.length > 16 ? last.slice(0, 16) + '...' : last;
      })
      .style('fill', '#8a7e6b')
      .style('font-size', '8px');

    svg.selectAll('.value')
      .data(data)
      .join('text')
      .attr('x', d => x(Number(d.total_receipts)) + 5)
      .attr('y', d => y(d.cand_name) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .text(d => {
        const v = Number(d.total_receipts);
        if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
        if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
        return `$${(v / 1e3).toFixed(0)}K`;
      })
      .style('fill', '#8a7e6b')
      .style('font-size', '9px');

    svg.append('text')
      .attr('x', 0).attr('y', -15)
      .text('Top Fundraisers')
      .style('fill', '#2d2418').style('font-size', '13px').style('font-weight', '600');

  }, [stats]);

  return <svg ref={svgRef} style={{ width: '100%', height: 'auto' }} />;
}

export function mountTopFundraisers(container, stats) {
  if (!container) return;
  const root = createRoot(container);
  root.render(<TopFundraisers stats={stats} />);
}
