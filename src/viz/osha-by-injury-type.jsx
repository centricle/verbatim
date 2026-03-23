import React, { useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';
import { showTooltip, hideTooltip } from './tooltip.js';

function OshaByInjuryType({ stats }) {
  const svgRef = useRef();

  useEffect(() => {
    if (!stats.by_injury_type) return;
    const raw = stats.by_injury_type;
    const data = [
      { label: 'Injuries', count: Number(raw.injuries || 0) },
      { label: 'Skin Disorders', count: Number(raw.skin_disorders || 0) },
      { label: 'Respiratory', count: Number(raw.respiratory || 0) },
      { label: 'Poisonings', count: Number(raw.poisonings || 0) },
      { label: 'Hearing Loss', count: Number(raw.hearing_loss || 0) },
      { label: 'Other Illnesses', count: Number(raw.other_illnesses || 0) },
    ].filter(d => d.count > 0);

    const margin = { top: 30, right: 70, bottom: 20, left: 100 };
    const width = 440 - margin.left - margin.right;
    const height = 280 - margin.top - margin.bottom;

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
      .domain([0, d3.max(data, d => d.count) * 1.1])
      .range([0, width]);

    svg.selectAll('rect')
      .data(data)
      .join('rect')
      .attr('x', 0)
      .attr('y', d => y(d.label))
      .attr('width', d => x(d.count))
      .attr('height', y.bandwidth())
      .attr('fill', '#8b3a3a')
      .attr('rx', 2)
      .on('mouseenter', function() { d3.select(this).style('opacity', 0.8); })
      .on('mouseleave', function() { d3.select(this).style('opacity', 1); hideTooltip(); })
      .on('mousemove', (event, d) => {
        showTooltip(event, `<strong>${d.label}</strong><br>${d.count.toLocaleString()}`);
      });

    svg.selectAll('.label')
      .data(data)
      .join('text')
      .attr('x', -4)
      .attr('y', d => y(d.label) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'end')
      .text(d => d.label)
      .style('fill', '#8a7e6b')
      .style('font-size', '9px');

    svg.selectAll('.value')
      .data(data)
      .join('text')
      .attr('x', d => x(d.count) + 4)
      .attr('y', d => y(d.label) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .text(d => d.count.toLocaleString())
      .style('fill', '#8a7e6b')
      .style('font-size', '9px');

    svg.append('text')
      .attr('x', 0).attr('y', -15)
      .text('Injury & Illness Types')
      .style('fill', '#2d2418').style('font-size', '13px').style('font-weight', '600');

  }, [stats]);

  return <svg ref={svgRef} style={{ width: '100%', height: 'auto' }} />;
}

export function mountOshaByInjuryType(container, stats, { onFilter } = {}) {
  if (!container) return;
  const root = createRoot(container);
  root.render(<OshaByInjuryType stats={stats} />);
}
