import React, { useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';
import { showTooltip, hideTooltip } from './tooltip.js';
import { useContainerWidth, measureText, fitText } from './chart-size.js';

function QiByViolation({ stats, onFilter }) {
  const svgRef = useRef();
  const fullWidth = useContainerWidth(svgRef);

  useEffect(() => {
    if (!stats.by_violation || !fullWidth) return;
    const data = stats.by_violation.slice(0, 12);
    const label = (d) => d.violation_type || 'unknown';

    d3.select(svgRef.current).selectAll('*').remove();

    const labelWidth = measureText(svgRef.current, data.map(label), 'cat-label');
    const valueWidth = measureText(svgRef.current, data.map(d => Number(d.count).toLocaleString()), 'value-label');
    const margin = { top: 4, right: valueWidth + 10, bottom: 4, left: Math.min(labelWidth, Math.round(fullWidth * 0.5)) + 12 };
    const rowHeight = 24;
    const height = data.length * rowHeight;
    const width = fullWidth - margin.left - margin.right;

    const svg = d3.select(svgRef.current)
      .attr('width', fullWidth)
      .attr('height', height + margin.top + margin.bottom)
      .attr('viewBox', `0 0 ${fullWidth} ${height + margin.top + margin.bottom}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3.scaleLinear()
      .domain([0, d3.max(data, d => Number(d.count))])
      .range([0, width]);

    const y = d3.scaleBand()
      .domain(data.map(d => d.violation_type))
      .range([0, height])
      .padding(0.28);

    svg.selectAll('.bar')
      .data(data)
      .join('rect')
      .attr('class', 'bar')
      .attr('x', 0)
      .attr('y', d => y(d.violation_type))
      .attr('width', d => Math.max(1, x(Number(d.count))))
      .attr('height', y.bandwidth())
      .style('fill', 'var(--color-figure)')
      .style('cursor', 'pointer')
      .on('mouseenter', function() { d3.select(this).style('opacity', 0.8); })
      .on('mouseleave', function() { d3.select(this).style('opacity', 1); hideTooltip(); })
      .on('mousemove', (event, d) => {
        showTooltip(event, `<strong>${d.violation_type || 'unknown'}</strong><br>${Number(d.count).toLocaleString()} cases`);
      })
      .on('click', (event, d) => { if (onFilter) onFilter({ key: 'violation', value: d.violation_type }); });

    // Violation labels, shortened only if the margin cannot hold them
    svg.selectAll('.cat-label')
      .data(data)
      .join('text')
      .attr('class', 'cat-label')
      .attr('x', -10)
      .attr('y', d => y(d.violation_type) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'end')
      .text(label)
      .each(function() { fitText(this, margin.left - 12); });

    svg.selectAll('.value-label')
      .data(data)
      .join('text')
      .attr('class', 'value-label')
      .attr('x', d => Math.max(1, x(Number(d.count))) + 6)
      .attr('y', d => y(d.violation_type) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .text(d => Number(d.count).toLocaleString());

    // Zero line in ink
    svg.append('line')
      .attr('class', 'baseline')
      .attr('x1', 0.5).attr('x2', 0.5)
      .attr('y1', 0).attr('y2', height);

  }, [stats, fullWidth]);

  return <svg ref={svgRef} className="chart" style={{ width: '100%', height: 'auto' }} />;
}

export function mountQiByViolation(container, stats, { onFilter } = {}) {
  if (!container) return;
  const root = createRoot(container);
  root.render(<QiByViolation stats={stats} onFilter={onFilter} />);
}
