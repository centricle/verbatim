import React, { useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';
import { showTooltip, hideTooltip } from './tooltip.js';

function AphisByType({ stats, onFilter }) {
  const svgRef = useRef();

  useEffect(() => {
    if (!stats.by_inspection_type) return;
    const raw = stats.by_inspection_type.slice(0, 8);
    const data = raw.map(d => ({
      ...d,
      label: (d.inspection_type || 'Unknown')
        .replace(/ INSPECTION/g, '')
        .replace(/PRELICENSE #/g, 'Pre-License ')
        .replace(/PRE-LICENSE/g, 'Pre-License')
        .replace(/RE-LICENSE/g, 'Re-License')
        .replace(/ROUTINE/g, 'Routine')
        .replace(/FOCUSED/g, 'Focused')
        .replace(/NEW SITE/g, 'New Site')
    }));

    const margin = { top: 30, right: 60, bottom: 20, left: 10 };
    const width = 440 - margin.left - margin.right;
    const height = 240 - margin.top - margin.bottom;

    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current)
      .attr('viewBox', `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const y = d3.scaleBand()
      .domain(data.map(d => d.label))
      .range([0, height])
      .padding(0.15);

    const x = d3.scaleLinear()
      .domain([0, d3.max(data, d => Number(d.count)) * 1.1])
      .range([0, width]);

    svg.selectAll('rect')
      .data(data)
      .join('rect')
      .attr('x', 0)
      .attr('y', d => y(d.label))
      .attr('width', d => x(Number(d.count)))
      .attr('height', y.bandwidth())
      .attr('fill', '#6b5a3e')
      .attr('rx', 2)
      .style('cursor', 'pointer')
      .on('mouseenter', function() { d3.select(this).style('opacity', 0.8); })
      .on('mouseleave', function() { d3.select(this).style('opacity', 1); hideTooltip(); })
      .on('mousemove', (event, d) => {
        showTooltip(event, `<strong>${d.label}</strong><br>${Number(d.count).toLocaleString()} inspections`);
      })
      .on('click', (event, d) => { if (onFilter) onFilter({ key: 'inspection_type', value: d.inspection_type }); });

    svg.selectAll('.label')
      .data(data)
      .join('text')
      .attr('x', 4)
      .attr('y', d => y(d.label) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .text(d => d.label)
      .style('fill', '#f5edd6')
      .style('font-size', '9px')
      .style('font-weight', '600');

    svg.selectAll('.value')
      .data(data)
      .join('text')
      .attr('x', d => x(Number(d.count)) + 4)
      .attr('y', d => y(d.label) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .text(d => Number(d.count).toLocaleString())
      .style('fill', '#8a7e6b')
      .style('font-size', '9px');

    svg.append('text')
      .attr('x', 0).attr('y', -15)
      .text('Inspections by Type')
      .style('fill', '#2d2418').style('font-size', '13px').style('font-weight', '600');

  }, [stats]);

  return <svg ref={svgRef} style={{ width: '100%', height: 'auto' }} />;
}

export function mountAphisByType(container, stats, { onFilter } = {}) {
  if (!container) return;
  const root = createRoot(container);
  root.render(<AphisByType stats={stats} onFilter={onFilter} />);
}
