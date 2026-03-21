import React, { useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';

function TopTraders({ stats }) {
  const svgRef = useRef();

  useEffect(() => {
    if (!stats.top_traders) return;
    const data = stats.top_traders.slice(0, 15);

    const margin = { top: 30, right: 20, bottom: 10, left: 140 };
    const barHeight = 18;
    const gap = 4;
    const height = data.length * (barHeight + gap);
    const width = 440 - margin.left - margin.right;

    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current)
      .attr('viewBox', `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3.scaleLinear()
      .domain([0, d3.max(data, d => d.total_trades) * 1.1])
      .range([0, width]);

    const y = d3.scaleBand()
      .domain(data.map(d => d.senator))
      .range([0, height])
      .padding(0.15);

    // Senator labels
    svg.selectAll('.label')
      .data(data)
      .join('text')
      .attr('x', -4)
      .attr('y', d => y(d.senator) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'end')
      .text(d => d.senator)
      .style('fill', '#2d2418')
      .style('font-size', '10px');

    // Stacked bars: purchases then sales
    data.forEach(d => {
      const g = svg.append('g');
      // Purchases
      g.append('rect')
        .attr('x', 0)
        .attr('y', y(d.senator))
        .attr('width', x(d.purchases))
        .attr('height', y.bandwidth())
        .attr('fill', '#4a8c5c')
        .attr('rx', 2);
      // Sales
      g.append('rect')
        .attr('x', x(d.purchases))
        .attr('y', y(d.senator))
        .attr('width', x(d.sales))
        .attr('height', y.bandwidth())
        .attr('fill', '#c0694a')
        .attr('rx', 0);
      // Count label
      g.append('text')
        .attr('x', x(d.total_trades) + 4)
        .attr('y', y(d.senator) + y.bandwidth() / 2)
        .attr('dy', '0.35em')
        .text(d.total_trades)
        .style('fill', '#8a7e6b')
        .style('font-size', '9px');
    });

    // Legend
    const legend = svg.append('g').attr('transform', `translate(${width - 130}, -15)`);
    [{ color: '#4a8c5c', label: 'Purchases' }, { color: '#c0694a', label: 'Sales' }].forEach((item, i) => {
      legend.append('rect').attr('x', i * 80).attr('y', 0).attr('width', 10).attr('height', 10).attr('fill', item.color).attr('rx', 2);
      legend.append('text').attr('x', i * 80 + 14).attr('y', 9).text(item.label).style('fill', '#8a7e6b').style('font-size', '10px');
    });

    // Title
    svg.append('text')
      .attr('x', 0).attr('y', -15)
      .text('Most Active Traders')
      .style('fill', '#2d2418').style('font-size', '13px').style('font-weight', '600');

  }, [stats]);

  return <svg ref={svgRef} style={{ width: '100%', height: 'auto' }} />;
}

export function mountTopTraders(container, stats) {
  if (!container) return;
  const root = createRoot(container);
  root.render(<TopTraders stats={stats} />);
}
