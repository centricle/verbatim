import React, { useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';

function TradesByYear({ stats }) {
  const svgRef = useRef();

  useEffect(() => {
    if (!stats.by_year) return;
    const data = stats.by_year;

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
      .padding(0.15);

    const subX = d3.scaleBand()
      .domain(['purchases', 'sales'])
      .range([0, x.bandwidth()])
      .padding(0.08);

    const maxVal = d3.max(data, d => Math.max(d.purchases, d.sales));
    const y = d3.scaleLinear()
      .domain([0, maxVal * 1.1])
      .range([height, 0]);

    // Axes
    svg.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x).tickFormat(d => d))
      .selectAll('text')
      .style('fill', '#8a7e6b')
      .style('font-size', '10px');

    svg.append('g')
      .call(d3.axisLeft(y).ticks(5))
      .selectAll('text')
      .style('fill', '#8a7e6b')
      .style('font-size', '10px');

    svg.selectAll('.domain, line').style('stroke', '#c4b899');

    const colors = { purchases: '#4a8c5c', sales: '#c0694a' };

    data.forEach(d => {
      const g = svg.append('g').attr('transform', `translate(${x(d.year)},0)`);

      ['purchases', 'sales'].forEach(key => {
        g.append('rect')
          .attr('x', subX(key))
          .attr('y', y(d[key]))
          .attr('width', subX.bandwidth())
          .attr('height', height - y(d[key]))
          .attr('fill', colors[key])
          .attr('rx', 2);
      });
    });

    // Legend
    const legend = svg.append('g').attr('transform', `translate(${width - 130}, -15)`);
    [{ key: 'purchases', label: 'Purchases' }, { key: 'sales', label: 'Sales' }].forEach((item, i) => {
      legend.append('rect').attr('x', i * 80).attr('y', 0).attr('width', 10).attr('height', 10).attr('fill', colors[item.key]).attr('rx', 2);
      legend.append('text').attr('x', i * 80 + 14).attr('y', 9).text(item.label).style('fill', '#8a7e6b').style('font-size', '10px');
    });

    // Title
    svg.append('text')
      .attr('x', 0).attr('y', -15)
      .text('Trades by Year')
      .style('fill', '#2d2418').style('font-size', '13px').style('font-weight', '600');

  }, [stats]);

  return <svg ref={svgRef} style={{ width: '100%', height: 'auto' }} />;
}

export function mountTradesByYear(container, stats) {
  if (!container) return;
  const root = createRoot(container);
  root.render(<TradesByYear stats={stats} />);
}
