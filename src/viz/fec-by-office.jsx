import React, { useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';
import { showTooltip, hideTooltip } from './tooltip.js';
import { useContainerWidth } from './chart-size.js';

// One neutral hue in three steps, darkest for President
const OFFICE_COLORS = {
  President: 'var(--color-figure)',
  Senate: 'color-mix(in oklch, var(--color-figure) 72%, var(--color-ground))',
  House: 'color-mix(in oklch, var(--color-figure) 45%, var(--color-ground))',
};

function ByOffice({ stats, onFilter }) {
  const svgRef = useRef();
  const fullWidth = useContainerWidth(svgRef);

  useEffect(() => {
    if (!stats.by_office || !fullWidth) return;
    const data = stats.by_office;

    const narrow = fullWidth < 480;
    const margin = { top: 22, right: 4, bottom: 26, left: 52 };
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
      .domain(data.map(d => d.office))
      .range([0, width])
      .paddingInner(0.3)
      .paddingOuter(0.15);

    const maxVal = d3.max(data, d => Number(d.total_raised));
    const y = d3.scaleLinear()
      .domain([0, maxVal])
      .nice()
      .range([height, 0]);

    // Horizontal gridlines double as the y axis
    svg.append('g')
      .attr('class', 'axis axis-y')
      .call(d3.axisLeft(y).ticks(narrow ? 4 : 5).tickSize(-width).tickPadding(8).tickFormat(v => {
        if (v >= 1e9) return `$${+(v / 1e9).toFixed(1)}B`;
        if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
        return `$${(v / 1e3).toFixed(0)}K`;
      }));

    svg.append('g')
      .attr('class', 'axis axis-x')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x).tickSize(0).tickPadding(9));

    svg.selectAll('.bar')
      .data(data)
      .join('rect')
      .attr('class', 'bar')
      .attr('x', d => x(d.office))
      .attr('y', d => y(Number(d.total_raised)))
      .attr('width', x.bandwidth())
      .attr('height', d => height - y(Number(d.total_raised)))
      .style('fill', d => OFFICE_COLORS[d.office] || 'var(--color-other)')
      .style('cursor', 'pointer')
      .on('mouseenter', function() { d3.select(this).style('opacity', 0.8); })
      .on('mouseleave', function() { d3.select(this).style('opacity', 1); hideTooltip(); })
      .on('mousemove', (event, d) => {
        const v = Number(d.total_raised);
        const fmt = v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : `$${(v / 1e6).toFixed(0)}M`;
        showTooltip(event, `<strong>${d.office}</strong><br>${fmt} raised<br>${Number(d.candidate_count).toLocaleString()} candidates`);
      })
      .on('click', (event, d) => { if (onFilter) onFilter({ key: 'office', value: d.office }); });

    // Value labels on bars
    svg.selectAll('.value-label')
      .data(data)
      .join('text')
      .attr('class', 'value-label')
      .attr('x', d => x(d.office) + x.bandwidth() / 2)
      .attr('y', d => y(Number(d.total_raised)) - 6)
      .attr('text-anchor', 'middle')
      .text(d => {
        const v = Number(d.total_raised);
        if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
        return `$${(v / 1e6).toFixed(0)}M`;
      });

    // Baseline in ink
    svg.append('line')
      .attr('class', 'baseline')
      .attr('x1', 0).attr('x2', width)
      .attr('y1', height + 0.5).attr('y2', height + 0.5);

  }, [stats, fullWidth]);

  return <svg ref={svgRef} className="chart" style={{ width: '100%', height: 'auto' }} />;
}

export function mountByOffice(container, stats, { onFilter } = {}) {
  if (!container) return;
  const root = createRoot(container);
  root.render(<ByOffice stats={stats} onFilter={onFilter} />);
}
