import React, { useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';
import { showTooltip, hideTooltip } from './tooltip.js';
import { useContainerWidth } from './chart-size.js';

function QiByYear({ stats, onFilter }) {
  const svgRef = useRef();
  const fullWidth = useContainerWidth(svgRef);

  useEffect(() => {
    if (!stats.by_year || !fullWidth) return;
    const data = stats.by_year;

    const narrow = fullWidth < 480;
    const margin = { top: 10, right: 4, bottom: 26, left: 40 };
    const width = fullWidth - margin.left - margin.right;
    const height = (narrow ? 230 : 280) - margin.top - margin.bottom;

    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current)
      .attr('width', fullWidth)
      .attr('height', height + margin.top + margin.bottom)
      .attr('viewBox', `0 0 ${fullWidth} ${height + margin.top + margin.bottom}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3.scaleBand()
      .domain(data.map(d => d.year))
      .range([0, width])
      .paddingInner(narrow ? 0.18 : 0.24)
      .paddingOuter(0.08);

    const maxVal = d3.max(data, d => Number(d.count));
    const y = d3.scaleLinear()
      .domain([0, maxVal])
      .nice()
      .range([height, 0]);

    // Horizontal gridlines double as the y axis
    svg.append('g')
      .attr('class', 'axis axis-y')
      .call(d3.axisLeft(y).ticks(narrow ? 4 : 5).tickSize(-width).tickPadding(8));

    const shortYear = x.bandwidth() < 30;
    svg.append('g')
      .attr('class', 'axis axis-x')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x).tickSize(0).tickPadding(9).tickFormat(d => (shortYear ? `’${String(d).slice(2)}` : d)));

    // One-hue ramp, light to dark by case count: a CSS color-mix of the
    // neutral figure color into the ground, since d3-color cannot parse oklch
    // or var().
    const shade = (v) => `color-mix(in oklch, var(--color-figure) ${Math.round(35 + (65 * v) / maxVal)}%, var(--color-ground))`;

    svg.selectAll('.bar')
      .data(data)
      .join('rect')
      .attr('class', 'bar')
      .attr('x', d => x(d.year))
      .attr('y', d => y(Number(d.count)))
      .attr('width', x.bandwidth())
      .attr('height', d => height - y(Number(d.count)))
      .style('fill', d => shade(Number(d.count)))
      .style('cursor', 'pointer')
      .on('mouseenter', function() { d3.select(this).style('opacity', 0.8); })
      .on('mouseleave', function() { d3.select(this).style('opacity', 1); hideTooltip(); })
      .on('mousemove', (event, d) => {
        showTooltip(event, `<strong>${d.year}</strong><br>${Number(d.count).toLocaleString()} cases`);
      })
      .on('click', (event, d) => { if (onFilter) onFilter({ key: 'year', value: String(d.year) }); });

    // Baseline in ink
    svg.append('line')
      .attr('class', 'baseline')
      .attr('x1', 0).attr('x2', width)
      .attr('y1', height + 0.5).attr('y2', height + 0.5);

  }, [stats, fullWidth]);

  return <svg ref={svgRef} className="chart" style={{ width: '100%', height: 'auto' }} />;
}

export function mountQiByYear(container, stats, { onFilter } = {}) {
  if (!container) return;
  const root = createRoot(container);
  root.render(<QiByYear stats={stats} onFilter={onFilter} />);
}
