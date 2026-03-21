import React, { useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';

function TopTickers({ stats }) {
  const svgRef = useRef();

  useEffect(() => {
    if (!stats.top_tickers) return;
    const data = stats.top_tickers.slice(0, 15);

    const margin = { top: 30, right: 20, bottom: 10, left: 60 };
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
      .domain([0, d3.max(data, d => d.count) * 1.1])
      .range([0, width]);

    const y = d3.scaleBand()
      .domain(data.map(d => d.ticker))
      .range([0, height])
      .padding(0.15);

    // Ticker labels
    svg.selectAll('.label')
      .data(data)
      .join('text')
      .attr('x', -4)
      .attr('y', d => y(d.ticker) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'end')
      .text(d => d.ticker)
      .style('fill', '#2d2418')
      .style('font-size', '10px')
      .style('font-family', 'monospace');

    // Stacked bars
    data.forEach(d => {
      const g = svg.append('g');
      g.append('rect')
        .attr('x', 0)
        .attr('y', y(d.ticker))
        .attr('width', x(d.purchases))
        .attr('height', y.bandwidth())
        .attr('fill', '#4a8c5c')
        .attr('rx', 2);
      g.append('rect')
        .attr('x', x(d.purchases))
        .attr('y', y(d.ticker))
        .attr('width', x(d.sales))
        .attr('height', y.bandwidth())
        .attr('fill', '#c0694a')
        .attr('rx', 0);
      g.append('text')
        .attr('x', x(d.count) + 4)
        .attr('y', y(d.ticker) + y.bandwidth() / 2)
        .attr('dy', '0.35em')
        .text(d.count)
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
      .text('Most Traded Tickers')
      .style('fill', '#2d2418').style('font-size', '13px').style('font-weight', '600');

  }, [stats]);

  return <svg ref={svgRef} style={{ width: '100%', height: 'auto' }} />;
}

export function mountTopTickers(container, stats) {
  if (!container) return;
  const root = createRoot(container);
  root.render(<TopTickers stats={stats} />);
}
