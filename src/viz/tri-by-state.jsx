import React, { useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';
import { showTooltip, hideTooltip } from './tooltip.js';

function TriByState({ stats, onFilter }) {
  const svgRef = useRef();

  useEffect(() => {
    if (!stats.by_state) return;
    const data = stats.by_state.slice(0, 15);

    const margin = { top: 30, right: 70, bottom: 20, left: 30 };
    const width = 440 - margin.left - margin.right;
    const height = 280 - margin.top - margin.bottom;

    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current)
      .attr('viewBox', `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const y = d3.scaleBand()
      .domain(data.map(d => d.state))
      .range([0, height])
      .padding(0.15);

    const x = d3.scaleLinear()
      .domain([0, d3.max(data, d => Number(d.total_lbs)) * 1.1])
      .range([0, width]);

    svg.selectAll('rect')
      .data(data)
      .join('rect')
      .attr('x', 0)
      .attr('y', d => y(d.state))
      .attr('width', d => x(Number(d.total_lbs)))
      .attr('height', y.bandwidth())
      .attr('fill', '#4a6741')
      .attr('rx', 2)
      .style('cursor', 'pointer')
      .on('mouseenter', function() { d3.select(this).style('opacity', 0.8); })
      .on('mouseleave', function() { d3.select(this).style('opacity', 1); hideTooltip(); })
      .on('mousemove', (event, d) => {
        const v = Number(d.total_lbs);
        const fmt = v >= 1e9 ? `${(v / 1e9).toFixed(1)}B lbs` : v >= 1e6 ? `${(v / 1e6).toFixed(0)}M lbs` : `${(v / 1e3).toFixed(0)}K lbs`;
        showTooltip(event, `<strong>${d.state}</strong><br>${fmt}<br>${Number(d.count).toLocaleString()} reports`);
      })
      .on('click', (event, d) => { if (onFilter) onFilter({ key: 'state', value: d.state }); });

    svg.selectAll('.label')
      .data(data)
      .join('text')
      .attr('x', -4)
      .attr('y', d => y(d.state) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'end')
      .text(d => d.state)
      .style('fill', '#8a7e6b')
      .style('font-size', '9px')
      .style('font-family', 'monospace');

    svg.selectAll('.value')
      .data(data)
      .join('text')
      .attr('x', d => x(Number(d.total_lbs)) + 4)
      .attr('y', d => y(d.state) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .text(d => {
        const v = Number(d.total_lbs);
        if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B lbs`;
        if (v >= 1e6) return `${(v / 1e6).toFixed(0)}M lbs`;
        if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K lbs`;
        return `${v} lbs`;
      })
      .style('fill', '#8a7e6b')
      .style('font-size', '9px');

    svg.append('text')
      .attr('x', 0).attr('y', -15)
      .text('Total Releases by State')
      .style('fill', '#2d2418').style('font-size', '13px').style('font-weight', '600');

  }, [stats]);

  return <svg ref={svgRef} style={{ width: '100%', height: 'auto' }} />;
}

export function mountTriByState(container, stats, { onFilter } = {}) {
  if (!container) return;
  const root = createRoot(container);
  root.render(<TriByState stats={stats} onFilter={onFilter} />);
}
