import React, { useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';
import { showTooltip, hideTooltip } from './tooltip.js';

const TIER_COLORS = {
  'Potential for minimal harm': '#8a7e6b',
  'Potential for more than minimal harm': '#b89f5a',
  'Actual harm': '#c97a3a',
  'Immediate jeopardy': '#8b3a3a',
};

const TIER_ORDER = [
  'Potential for minimal harm',
  'Potential for more than minimal harm',
  'Actual harm',
  'Immediate jeopardy',
];

function NhdBySeverity({ stats, onFilter }) {
  const svgRef = useRef();

  useEffect(() => {
    if (!stats.by_severity) return;

    // Group by tier
    const tiers = TIER_ORDER.map(label => {
      const codes = stats.by_severity.filter(d => d.label === label);
      return {
        label,
        total: codes.reduce((sum, d) => sum + Number(d.total), 0),
        codes: codes.map(d => d.code).join(', '),
      };
    }).filter(d => d.total > 0);

    const margin = { top: 30, right: 60, bottom: 20, left: 10 };
    const width = 440 - margin.left - margin.right;
    const height = 280 - margin.top - margin.bottom;

    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current)
      .attr('viewBox', `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3.scaleBand()
      .domain(tiers.map(d => d.label))
      .range([0, width])
      .padding(0.2);

    const y = d3.scaleLinear()
      .domain([0, d3.max(tiers, d => d.total) * 1.1])
      .range([height, 0]);

    svg.selectAll('rect')
      .data(tiers)
      .join('rect')
      .attr('x', d => x(d.label))
      .attr('y', d => y(d.total))
      .attr('width', x.bandwidth())
      .attr('height', d => height - y(d.total))
      .attr('fill', d => TIER_COLORS[d.label])
      .attr('rx', 2)
      .style('cursor', 'pointer')
      .on('mouseenter', function() { d3.select(this).style('opacity', 0.8); })
      .on('mouseleave', function() { d3.select(this).style('opacity', 1); hideTooltip(); })
      .on('mousemove', (event, d) => {
        showTooltip(event, `<strong>${d.label}</strong><br>${d.total.toLocaleString()} citations<br>Codes: ${d.codes}`);
      });

    // Short labels under bars
    const shortLabels = {
      'Potential for minimal harm': 'Minimal',
      'Potential for more than minimal harm': 'More than\nminimal',
      'Actual harm': 'Actual\nharm',
      'Immediate jeopardy': 'Immediate\njeopardy',
    };

    svg.selectAll('.bar-label')
      .data(tiers)
      .join('text')
      .attr('x', d => x(d.label) + x.bandwidth() / 2)
      .attr('y', height + 14)
      .attr('text-anchor', 'middle')
      .text(d => shortLabels[d.label].split('\n')[0])
      .style('fill', '#8a7e6b')
      .style('font-size', '8px');

    svg.selectAll('.bar-label2')
      .data(tiers)
      .join('text')
      .attr('x', d => x(d.label) + x.bandwidth() / 2)
      .attr('y', height + 23)
      .attr('text-anchor', 'middle')
      .text(d => (shortLabels[d.label].split('\n')[1] || ''))
      .style('fill', '#8a7e6b')
      .style('font-size', '8px');

    svg.selectAll('.value')
      .data(tiers)
      .join('text')
      .attr('x', d => x(d.label) + x.bandwidth() / 2)
      .attr('y', d => y(d.total) - 4)
      .attr('text-anchor', 'middle')
      .text(d => d.total.toLocaleString())
      .style('fill', '#8a7e6b')
      .style('font-size', '9px');

    svg.append('text')
      .attr('x', 0).attr('y', -15)
      .text('Severity Distribution')
      .style('fill', '#2d2418').style('font-size', '13px').style('font-weight', '600');

  }, [stats]);

  return <svg ref={svgRef} style={{ width: '100%', height: 'auto' }} />;
}

export function mountNhdBySeverity(container, stats, { onFilter } = {}) {
  if (!container) return;
  const root = createRoot(container);
  root.render(<NhdBySeverity stats={stats} onFilter={onFilter} />);
}
