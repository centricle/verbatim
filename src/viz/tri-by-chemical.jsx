import React, { useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';

function TriByChemical({ stats }) {
  const svgRef = useRef();

  useEffect(() => {
    if (!stats.by_chemical) return;
    const data = stats.by_chemical.slice(0, 15);

    const margin = { top: 30, right: 70, bottom: 20, left: 100 };
    const width = 440 - margin.left - margin.right;
    const height = 280 - margin.top - margin.bottom;

    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current)
      .attr('viewBox', `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const truncate = s => s.length > 18 ? s.slice(0, 16) + '…' : s;

    const y = d3.scaleBand()
      .domain(data.map(d => d.chemical))
      .range([0, height])
      .padding(0.15);

    const x = d3.scaleLinear()
      .domain([0, d3.max(data, d => Number(d.total_lbs)) * 1.1])
      .range([0, width]);

    svg.selectAll('rect')
      .data(data)
      .join('rect')
      .attr('x', 0)
      .attr('y', d => y(d.chemical))
      .attr('width', d => x(Number(d.total_lbs)))
      .attr('height', y.bandwidth())
      .attr('fill', '#4a6741')
      .attr('rx', 2);

    svg.selectAll('.label')
      .data(data)
      .join('text')
      .attr('x', -4)
      .attr('y', d => y(d.chemical) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'end')
      .text(d => truncate(d.chemical))
      .style('fill', '#8a7e6b')
      .style('font-size', '8px');

    svg.selectAll('.value')
      .data(data)
      .join('text')
      .attr('x', d => x(Number(d.total_lbs)) + 4)
      .attr('y', d => y(d.chemical) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .text(d => {
        const v = Number(d.total_lbs);
        if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B lbs`;
        if (v >= 1e6) return `${(v / 1e6).toFixed(0)}M lbs`;
        if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K lbs`;
        return `${v} lbs`;
      })
      .style('fill', '#8a7e6b')
      .style('font-size', '9px');

    svg.append('text')
      .attr('x', 0).attr('y', -15)
      .text('Top Chemicals by Total Releases')
      .style('fill', '#2d2418').style('font-size', '13px').style('font-weight', '600');

  }, [stats]);

  return <svg ref={svgRef} style={{ width: '100%', height: 'auto' }} />;
}

export function mountTriByChemical(container, stats) {
  if (!container) return;
  const root = createRoot(container);
  root.render(<TriByChemical stats={stats} />);
}
