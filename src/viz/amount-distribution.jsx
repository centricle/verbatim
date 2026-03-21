import React, { useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';

function AmountDistribution({ stats }) {
  const svgRef = useRef();

  useEffect(() => {
    if (!stats.by_amount) return;
    const data = stats.by_amount;

    const margin = { top: 30, right: 20, bottom: 80, left: 50 };
    const width = 440 - margin.left - margin.right;
    const height = 280 - margin.top - margin.bottom;

    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current)
      .attr('viewBox', `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Short labels for x axis
    const shortLabel = (a) => {
      if (!a) return '?';
      return a.replace('$1,001 - $15,000', '$1K–$15K')
        .replace('$15,001 - $50,000', '$15K–$50K')
        .replace('$50,001 - $100,000', '$50K–$100K')
        .replace('$100,001 - $250,000', '$100K–$250K')
        .replace('$250,001 - $500,000', '$250K–$500K')
        .replace('$500,001 - $1,000,000', '$500K–$1M')
        .replace('$1,000,001 - $5,000,000', '$1M–$5M')
        .replace('$5,000,001 - $25,000,000', '$5M–$25M')
        .replace('$25,000,001 - $50,000,000', '$25M–$50M')
        .replace('Over $50,000,000', '>$50M');
    };

    const x = d3.scaleBand()
      .domain(data.map(d => shortLabel(d.amount)))
      .range([0, width])
      .padding(0.2);

    const y = d3.scaleLinear()
      .domain([0, d3.max(data, d => d.count) * 1.1])
      .range([height, 0]);

    // Axes
    svg.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x))
      .selectAll('text')
      .style('fill', '#8a7e6b')
      .style('font-size', '9px')
      .attr('transform', 'rotate(-45)')
      .attr('text-anchor', 'end')
      .attr('dx', '-0.5em')
      .attr('dy', '0.15em');

    svg.append('g')
      .call(d3.axisLeft(y).ticks(5))
      .selectAll('text')
      .style('fill', '#8a7e6b')
      .style('font-size', '10px');

    svg.selectAll('.domain, line').style('stroke', '#c4b899');

    // Color scale: light to dark by amount bracket
    const color = d3.scaleSequential()
      .domain([0, data.length - 1])
      .interpolator(d3.interpolateRgb('#c4b899', '#8a4a2a'));

    // Bars
    data.forEach((d, i) => {
      const label = shortLabel(d.amount);
      svg.append('rect')
        .attr('x', x(label))
        .attr('y', y(d.count))
        .attr('width', x.bandwidth())
        .attr('height', height - y(d.count))
        .attr('fill', color(i))
        .attr('rx', 2);

      // Count label on top
      svg.append('text')
        .attr('x', x(label) + x.bandwidth() / 2)
        .attr('y', y(d.count) - 4)
        .attr('text-anchor', 'middle')
        .text(d.count.toLocaleString())
        .style('fill', '#8a7e6b')
        .style('font-size', '9px');
    });

    // Title
    svg.append('text')
      .attr('x', 0).attr('y', -15)
      .text('Trade Size Distribution')
      .style('fill', '#2d2418').style('font-size', '13px').style('font-weight', '600');

  }, [stats]);

  return <svg ref={svgRef} style={{ width: '100%', height: 'auto' }} />;
}

export function mountAmountDistribution(container, stats) {
  if (!container) return;
  const root = createRoot(container);
  root.render(<AmountDistribution stats={stats} />);
}
