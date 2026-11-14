import React, { useRef, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';
import { showTooltip, hideTooltip } from './tooltip.js';

// Drawn at the container's real pixel width, so label sizes in app.css are true sizes.
function useContainerWidth(ref) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return width;
}

function AmountDistribution({ stats, onFilter }) {
  const svgRef = useRef();
  const fullWidth = useContainerWidth(svgRef);

  useEffect(() => {
    if (!stats.by_amount || !fullWidth) return;
    const data = stats.by_amount;

    // Short labels for the category axis
    const shortLabel = (a) => {
      if (!a) return '?';
      return a.replace('$1,001 - $15,000', '$1K–$15K')
        .replace('$15,001 - $50,000', '$15K–$50K')
        .replace('$50,001 - $100,000', '$50K–$100K')
        .replace('$100,001 - $250,000', '$100K–$250K')
        .replace('$250,001 - $500,000', '$250K–$500K')
        .replace('$500,001 - $1,000,000', '$500K–$1M')
        .replace('$1,000,001 - $5,000,000', '$1M–$5M')
        .replace('$5,000,001 - $25,000,000', '$5M–$25M')
        .replace('$25,000,001 - $50,000,000', '$25M–$50M')
        .replace('Over $50,000,000', '>$50M');
    };

    // Horizontal bars so every range label reads level, at any width
    const margin = { top: 4, right: 56, bottom: 4, left: 92 };
    const rowHeight = 26;
    const height = data.length * rowHeight;
    const width = fullWidth - margin.left - margin.right;

    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current)
      .attr('width', fullWidth)
      .attr('height', height + margin.top + margin.bottom)
      .attr('viewBox', `0 0 ${fullWidth} ${height + margin.top + margin.bottom}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const y = d3.scaleBand()
      .domain(data.map(d => shortLabel(d.amount)))
      .range([0, height])
      .padding(0.28);

    const x = d3.scaleLinear()
      .domain([0, d3.max(data, d => d.count)])
      .range([0, width]);

    // One-hue ramp, light to dark by bracket: a CSS color-mix of the neutral
    // figure color into the ground, since d3-color cannot parse oklch or var().
    const shade = (i) => {
      const pct = Math.round(42 + (58 * i) / Math.max(1, data.length - 1));
      return `color-mix(in oklch, var(--color-figure) ${pct}%, var(--color-ground))`;
    };

    data.forEach((d, i) => {
      const label = shortLabel(d.amount);

      svg.append('text')
        .attr('class', 'cat-label')
        .attr('x', -10)
        .attr('y', y(label) + y.bandwidth() / 2)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'end')
        .text(label);

      svg.append('rect')
        .attr('class', 'bar')
        .attr('x', 0)
        .attr('y', y(label))
        .attr('width', Math.max(1, x(d.count)))
        .attr('height', y.bandwidth())
        .style('fill', shade(i))
        .on('mouseenter', function() { d3.select(this).style('opacity', 0.8); })
        .on('mouseleave', function() { d3.select(this).style('opacity', 1); hideTooltip(); })
        .on('mousemove', (event) => {
          showTooltip(event, `<strong>${d.amount}</strong><br>${d.count.toLocaleString()} trades`);
        });

      // Count label at the end of the bar
      svg.append('text')
        .attr('class', 'value-label')
        .attr('x', Math.max(1, x(d.count)) + 6)
        .attr('y', y(label) + y.bandwidth() / 2)
        .attr('dy', '0.35em')
        .text(d.count.toLocaleString());
    });

    // Zero line in ink
    svg.append('line')
      .attr('class', 'baseline')
      .attr('x1', 0.5).attr('x2', 0.5)
      .attr('y1', 0).attr('y2', height);

  }, [stats, fullWidth]);

  return <svg ref={svgRef} className="chart" style={{ width: '100%', height: 'auto' }} />;
}

export function mountAmountDistribution(container, stats, { onFilter } = {}) {
  if (!container) return;
  const root = createRoot(container);
  root.render(<AmountDistribution stats={stats} onFilter={onFilter} />);
}
