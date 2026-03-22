import React, { useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';

function AphisByYear({ stats }) {
  const svgRef = useRef();

  useEffect(() => {
    if (!stats.by_year) return;
    const data = stats.by_year.filter(d => d.year >= 2015);

    const margin = { top: 30, right: 20, bottom: 40, left: 50 };
    const width = 440 - margin.left - margin.right;
    const height = 260 - margin.top - margin.bottom;

    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current)
      .attr('viewBox', `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3.scaleBand()
      .domain(data.map(d => d.year))
      .range([0, width])
      .padding(0.2);

    const maxVal = d3.max(data, d => Number(d.count));
    const y = d3.scaleLinear()
      .domain([0, maxVal * 1.1])
      .range([height, 0]);

    // Stacked bars: non-critical (base) + critical (top)
    svg.selectAll('.bar-nc')
      .data(data)
      .join('rect')
      .attr('x', d => x(d.year))
      .attr('y', d => y(Number(d.count)))
      .attr('width', x.bandwidth())
      .attr('height', d => height - y(Number(d.count)))
      .attr('fill', '#6b5a3e')
      .attr('rx', 2);

    svg.selectAll('.bar-crit')
      .data(data.filter(d => Number(d.critical) > 0))
      .join('rect')
      .attr('x', d => x(d.year))
      .attr('y', d => y(Number(d.critical)))
      .attr('width', x.bandwidth())
      .attr('height', d => height - y(Number(d.critical)))
      .attr('fill', '#8b3a3a')
      .attr('rx', 2);

    svg.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x).tickFormat(d => d))
      .selectAll('text')
      .style('font-size', '8px')
      .attr('transform', 'rotate(-45)')
      .attr('text-anchor', 'end');

    svg.append('g')
      .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(',')))
      .selectAll('text').style('font-size', '8px');

    svg.append('text')
      .attr('x', 0).attr('y', -15)
      .text('Inspections by Year')
      .style('fill', '#2d2418').style('font-size', '13px').style('font-weight', '600');

    // Legend
    const legend = svg.append('g').attr('transform', `translate(${width - 160}, -10)`);
    legend.append('rect').attr('width', 10).attr('height', 10).attr('fill', '#6b5a3e').attr('rx', 1);
    legend.append('text').attr('x', 14).attr('y', 9).text('Inspections').style('font-size', '9px').style('fill', '#8a7e6b');
    legend.append('rect').attr('x', 85).attr('width', 10).attr('height', 10).attr('fill', '#8b3a3a').attr('rx', 1);
    legend.append('text').attr('x', 99).attr('y', 9).text('Critical').style('font-size', '9px').style('fill', '#8a7e6b');

  }, [stats]);

  return <svg ref={svgRef} style={{ width: '100%', height: 'auto' }} />;
}

export function mountAphisByYear(container, stats) {
  if (!container) return;
  const root = createRoot(container);
  root.render(<AphisByYear stats={stats} />);
}
