import React, { useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';
import { showTooltip, hideTooltip } from './tooltip.js';
import { useContainerWidth, measureText } from './chart-size.js';

function ShootingsByState({ stats, onFilter }) {
  const svgRef = useRef();
  const fullWidth = useContainerWidth(svgRef);

  useEffect(() => {
    if (!stats.by_state || !fullWidth) return;
    const data = stats.by_state
      .sort((a, b) => Number(b.total) - Number(a.total))
      .slice(0, 15);

    d3.select(svgRef.current).selectAll('*').remove();

    const labelWidth = measureText(svgRef.current, data.map(d => d.state), 'cat-label cat-label--ticker');
    const valueWidth = measureText(svgRef.current, data.map(d => Number(d.total).toLocaleString()), 'value-label');
    const margin = { top: 44, right: valueWidth + 10, bottom: 4, left: labelWidth + 12 };
    const rowHeight = 22;
    const height = data.length * rowHeight;
    const width = fullWidth - margin.left - margin.right;

    const svg = d3.select(svgRef.current)
      .attr('width', fullWidth)
      .attr('height', height + margin.top + margin.bottom)
      .attr('viewBox', `0 0 ${fullWidth} ${height + margin.top + margin.bottom}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3.scaleLinear()
      .domain([0, d3.max(data, d => Number(d.total))])
      .range([0, width]);

    const y = d3.scaleBand()
      .domain(data.map(d => d.state))
      .range([0, height])
      .padding(0.24);

    svg.selectAll('.bar')
      .data(data)
      .join('rect')
      .attr('class', 'bar')
      .attr('x', 0)
      .attr('y', d => y(d.state))
      .attr('width', d => Math.max(1, x(Number(d.total))))
      .attr('height', y.bandwidth())
      .style('fill', 'var(--color-figure)')
      .style('cursor', 'pointer')
      .on('mouseenter', function() { d3.select(this).style('opacity', 0.8); })
      .on('mouseleave', function() { d3.select(this).style('opacity', 1); hideTooltip(); })
      .on('mousemove', (event, d) => {
        showTooltip(event, `<strong>${d.state}</strong><br>${Number(d.total).toLocaleString()} incidents`);
      })
      .on('click', (event, d) => { if (onFilter) onFilter({ key: 'state', value: d.state }); });

    svg.selectAll('.cat-label')
      .data(data)
      .join('text')
      .attr('class', 'cat-label cat-label--ticker')
      .attr('x', -10)
      .attr('y', d => y(d.state) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'end')
      .text(d => d.state);

    svg.selectAll('.value-label')
      .data(data)
      .join('text')
      .attr('class', 'value-label')
      .attr('x', d => Math.max(1, x(Number(d.total))) + 6)
      .attr('y', d => y(d.state) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .text(d => Number(d.total).toLocaleString());

    // Zero line in ink
    svg.append('line')
      .attr('class', 'baseline')
      .attr('x1', 0.5).attr('x2', 0.5)
      .attr('y1', 0).attr('y2', height);

    // Title, set at the top left of the figure
    svg.append('text')
      .attr('class', 'chart-title')
      .attr('x', -margin.left).attr('y', -margin.top + 20)
      .text('Top 15 States');

  }, [stats, fullWidth]);

  return <svg ref={svgRef} className="chart" style={{ width: '100%', height: 'auto' }} />;
}

export function mountShootingsByState(container, stats, { onFilter } = {}) {
  if (!container) return;
  const root = createRoot(container);
  root.render(<ShootingsByState stats={stats} onFilter={onFilter} />);
}
