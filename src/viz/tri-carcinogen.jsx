import React, { useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';
import { showTooltip, hideTooltip } from './tooltip.js';

function TriCarcinogen({ stats, onFilter }) {
  const svgRef = useRef();

  useEffect(() => {
    if (!stats.carcinogen_breakdown) return;
    const raw = stats.carcinogen_breakdown;
    const data = [
      { label: 'Carcinogen', count: Number(raw.find(d => d.carcinogen)?.count || 0), lbs: Number(raw.find(d => d.carcinogen)?.total_lbs || 0) },
      { label: 'Non-Carcinogen', count: Number(raw.find(d => !d.carcinogen)?.count || 0), lbs: Number(raw.find(d => !d.carcinogen)?.total_lbs || 0) },
    ];
    const total = data[0].count + data[1].count;

    const margin = { top: 30, right: 20, bottom: 20, left: 20 };
    const width = 440 - margin.left - margin.right;
    const height = 220 - margin.top - margin.bottom;

    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current)
      .attr('viewBox', `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const radius = Math.min(width, height) / 2 - 10;
    const g = svg.append('g').attr('transform', `translate(${width / 3},${height / 2})`);

    const pie = d3.pie().value(d => d.count).sort(null);
    const arc = d3.arc().innerRadius(radius * 0.5).outerRadius(radius);
    const colors = ['#8b3a3a', '#6b5a3e'];

    g.selectAll('path')
      .data(pie(data))
      .join('path')
      .attr('d', arc)
      .attr('fill', (d, i) => colors[i])
      .style('cursor', 'pointer')
      .on('mouseenter', function() { d3.select(this).style('opacity', 0.8); })
      .on('mouseleave', function() { d3.select(this).style('opacity', 1); hideTooltip(); })
      .on('mousemove', (event, d) => {
        const pct = ((d.data.count / total) * 100).toFixed(0);
        showTooltip(event, `<strong>${d.data.label}</strong><br>${d.data.count.toLocaleString()} reports (${pct}%)`);
      });

    // Labels on right side
    const labelX = width / 3 + radius + 20;
    data.forEach((d, i) => {
      const yPos = height / 2 - 20 + i * 50;
      svg.append('rect')
        .attr('x', labelX).attr('y', yPos - 8)
        .attr('width', 12).attr('height', 12)
        .attr('fill', colors[i]).attr('rx', 2);
      svg.append('text')
        .attr('x', labelX + 18).attr('y', yPos + 2)
        .text(d.label)
        .style('fill', '#2d2418').style('font-size', '11px').style('font-weight', '600');
      svg.append('text')
        .attr('x', labelX + 18).attr('y', yPos + 16)
        .text(`${d.count.toLocaleString()} reports (${((d.count / total) * 100).toFixed(0)}%)`)
        .style('fill', '#8a7e6b').style('font-size', '9px');
    });

    svg.append('text')
      .attr('x', 0).attr('y', -15)
      .text('Carcinogen Classification')
      .style('fill', '#2d2418').style('font-size', '13px').style('font-weight', '600');

  }, [stats]);

  return <svg ref={svgRef} style={{ width: '100%', height: 'auto' }} />;
}

export function mountTriCarcinogen(container, stats, { onFilter } = {}) {
  if (!container) return;
  const root = createRoot(container);
  root.render(<TriCarcinogen stats={stats} onFilter={onFilter} />);
}
