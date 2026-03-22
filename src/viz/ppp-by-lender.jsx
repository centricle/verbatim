import React, { useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';
import { showTooltip, hideTooltip } from './tooltip.js';

function PPPByLender({ stats, onFilter }) {
  const svgRef = useRef();

  useEffect(() => {
    if (!stats.by_lender) return;
    const data = stats.by_lender.slice(0, 12);

    const margin = { top: 30, right: 60, bottom: 20, left: 130 };
    const width = 440 - margin.left - margin.right;
    const barHeight = 24;
    const height = data.length * barHeight;

    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current)
      .attr('viewBox', `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3.scaleLinear()
      .domain([0, d3.max(data, d => Number(d.total_amount)) * 1.1])
      .range([0, width]);

    const y = d3.scaleBand()
      .domain(data.map(d => d.lender_name))
      .range([0, height])
      .padding(0.2);

    svg.selectAll('rect')
      .data(data)
      .join('rect')
      .attr('x', 0)
      .attr('y', d => y(d.lender_name))
      .attr('width', d => x(Number(d.total_amount)))
      .attr('height', y.bandwidth())
      .attr('fill', '#40916c')
      .attr('rx', 2)
      .style('cursor', 'pointer')
      .on('mouseenter', function() { d3.select(this).style('opacity', 0.8); })
      .on('mouseleave', function() { d3.select(this).style('opacity', 1); hideTooltip(); })
      .on('mousemove', (event, d) => {
        const v = Number(d.total_amount);
        const fmt = v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : `$${(v / 1e6).toFixed(0)}M`;
        showTooltip(event, `<strong>${d.lender_name}</strong><br>${fmt} total<br>${Number(d.loan_count).toLocaleString()} loans`);
      })
      .on('click', (event, d) => { if (onFilter) onFilter({ key: 'lender', value: d.lender_name }); });

    svg.selectAll('.label')
      .data(data)
      .join('text')
      .attr('x', -8)
      .attr('y', d => y(d.lender_name) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'end')
      .text(d => {
        const n = d.lender_name;
        return n.length > 18 ? n.slice(0, 18) + '...' : n;
      })
      .style('fill', '#8a7e6b')
      .style('font-size', '8px');

    svg.selectAll('.value')
      .data(data)
      .join('text')
      .attr('x', d => x(Number(d.total_amount)) + 5)
      .attr('y', d => y(d.lender_name) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .text(d => {
        const v = Number(d.total_amount);
        if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
        return `$${(v / 1e6).toFixed(0)}M`;
      })
      .style('fill', '#8a7e6b')
      .style('font-size', '9px');

    svg.append('text')
      .attr('x', 0).attr('y', -15)
      .text('Top Lenders by Volume')
      .style('fill', '#2d2418').style('font-size', '13px').style('font-weight', '600');

  }, [stats]);

  return <svg ref={svgRef} style={{ width: '100%', height: 'auto' }} />;
}

export function mountPPPByLender(container, stats, { onFilter } = {}) {
  if (!container) return;
  const root = createRoot(container);
  root.render(<PPPByLender stats={stats} onFilter={onFilter} />);
}
