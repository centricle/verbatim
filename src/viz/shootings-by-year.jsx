import React, { useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';
import { showTooltip, hideTooltip } from './tooltip.js';
import { useContainerWidth } from './chart-size.js';

function ShootingsByYear({ stats, onFilter }) {
  const svgRef = useRef();
  const fullWidth = useContainerWidth(svgRef);

  useEffect(() => {
    if (!stats.by_year || !fullWidth) return;
    const data = stats.by_year;

    const narrow = fullWidth < 480;
    const margin = { top: 50, right: 4, bottom: 26, left: 44 };
    const width = fullWidth - margin.left - margin.right;
    const height = (narrow ? 270 : 320) - margin.top - margin.bottom;

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

    const maxVal = d3.max(data, d => Number(d.total));
    const y = d3.scaleLinear()
      .domain([0, maxVal * 1.1])
      .range([height, 0]);

    svg.append('g')
      .attr('class', 'axis axis-x')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x).tickSize(0).tickPadding(9));

    // Horizontal gridlines double as the y axis
    svg.append('g')
      .attr('class', 'axis axis-y')
      .call(d3.axisLeft(y).ticks(5).tickSize(-width).tickPadding(8));

    svg.selectAll('.bar')
      .data(data)
      .join('rect')
      .attr('class', 'bar')
      .attr('x', d => x(d.year))
      .attr('y', d => y(Number(d.total)))
      .attr('width', x.bandwidth())
      .attr('height', d => height - y(Number(d.total)))
      .style('fill', 'var(--color-figure)')
      .style('cursor', 'pointer')
      .on('mouseenter', function() { d3.select(this).style('opacity', 0.8); })
      .on('mouseleave', function() { d3.select(this).style('opacity', 1); hideTooltip(); })
      .on('mousemove', (event, d) => {
        showTooltip(event, `<strong>${d.year}</strong><br>${Number(d.total).toLocaleString()} incidents`);
      })
      .on('click', (event, d) => { if (onFilter) onFilter({ key: 'year', value: String(d.year) }); });

    // Baseline in ink
    svg.append('line')
      .attr('class', 'baseline')
      .attr('x1', 0).attr('x2', width)
      .attr('y1', height + 0.5).attr('y2', height + 0.5);

    // Title, set at the top left of the figure
    svg.append('text')
      .attr('class', 'chart-title')
      .attr('x', -margin.left).attr('y', -margin.top + 20)
      .text('Incidents by Year');

  }, [stats, fullWidth]);

  return <svg ref={svgRef} className="chart" style={{ width: '100%', height: 'auto' }} />;
}

export function mountShootingsByYear(container, stats, { onFilter } = {}) {
  if (!container) return;
  const root = createRoot(container);
  root.render(<ShootingsByYear stats={stats} onFilter={onFilter} />);
}
