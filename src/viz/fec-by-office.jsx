import React, { useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';

function ByOffice({ stats }) {
  const svgRef = useRef();

  useEffect(() => {
    if (!stats.by_office) return;
    const data = stats.by_office;
    const officeColors = { President: '#6b4226', Senate: '#8a4a2a', House: '#c4956a' };

    const margin = { top: 30, right: 20, bottom: 50, left: 60 };
    const width = 440 - margin.left - margin.right;
    const height = 260 - margin.top - margin.bottom;

    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current)
      .attr('viewBox', `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3.scaleBand()
      .domain(data.map(d => d.office))
      .range([0, width])
      .padding(0.3);

    const maxVal = d3.max(data, d => Number(d.total_raised));
    const y = d3.scaleLinear()
      .domain([0, maxVal * 1.1])
      .range([height, 0]);

    svg.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x))
      .selectAll('text')
      .style('fill', '#8a7e6b')
      .style('font-size', '10px');

    svg.append('g')
      .call(d3.axisLeft(y).ticks(5).tickFormat(v => {
        if (v >= 1e9) return `$${(v / 1e9).toFixed(0)}B`;
        if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
        return `$${(v / 1e3).toFixed(0)}K`;
      }))
      .selectAll('text')
      .style('fill', '#8a7e6b')
      .style('font-size', '9px');

    svg.selectAll('.domain, line').style('stroke', '#c4b899');

    svg.selectAll('rect')
      .data(data)
      .join('rect')
      .attr('x', d => x(d.office))
      .attr('y', d => y(Number(d.total_raised)))
      .attr('width', x.bandwidth())
      .attr('height', d => height - y(Number(d.total_raised)))
      .attr('fill', d => officeColors[d.office] || '#8a7e6b')
      .attr('rx', 3);

    // Value labels on bars
    svg.selectAll('.bar-label')
      .data(data)
      .join('text')
      .attr('x', d => x(d.office) + x.bandwidth() / 2)
      .attr('y', d => y(Number(d.total_raised)) - 5)
      .attr('text-anchor', 'middle')
      .text(d => {
        const v = Number(d.total_raised);
        if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
        return `$${(v / 1e6).toFixed(0)}M`;
      })
      .style('fill', '#8a7e6b')
      .style('font-size', '9px');

    svg.append('text')
      .attr('x', 0).attr('y', -15)
      .text('Total Raised by Office')
      .style('fill', '#2d2418').style('font-size', '13px').style('font-weight', '600');

  }, [stats]);

  return <svg ref={svgRef} style={{ width: '100%', height: 'auto' }} />;
}

export function mountByOffice(container, stats) {
  if (!container) return;
  const root = createRoot(container);
  root.render(<ByOffice stats={stats} />);
}
