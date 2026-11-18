import React, { useRef, useEffect, useState } from 'react';
import { rootFor } from './mount.js';
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

function TopTickers({ stats, onFilter }) {
  const svgRef = useRef();
  const fullWidth = useContainerWidth(svgRef);

  useEffect(() => {
    if (!stats.top_tickers || !fullWidth) return;
    const data = stats.top_tickers.slice(0, 15);

    const margin = { top: 4, right: 40, bottom: 4, left: 56 };
    const rowHeight = 24;
    const height = data.length * rowHeight;
    const width = fullWidth - margin.left - margin.right;

    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current)
      .attr('width', fullWidth)
      .attr('height', height + margin.top + margin.bottom)
      .attr('viewBox', `0 0 ${fullWidth} ${height + margin.top + margin.bottom}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3.scaleLinear()
      .domain([0, d3.max(data, d => d.count)])
      .range([0, width]);

    const y = d3.scaleBand()
      .domain(data.map(d => d.ticker))
      .range([0, height])
      .padding(0.28);

    // Ticker labels
    svg.selectAll('.cat-label')
      .data(data)
      .join('text')
      .attr('class', 'cat-label cat-label--ticker')
      .attr('x', -10)
      .attr('y', d => y(d.ticker) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'end')
      .text(d => d.ticker);

    // Stacked bars, split by a 2px gap in the ground color
    data.forEach(d => {
      const g = svg.append('g');
      const tip = (event) => {
        showTooltip(event, `<strong>${d.ticker}</strong><br>Purchases: ${d.purchases}<br>Sales: ${d.sales}<br>Total: ${d.count}`);
      };
      g.append('rect')
        .attr('class', 'bar')
        .attr('x', 0)
        .attr('y', y(d.ticker))
        .attr('width', Math.max(0, x(d.purchases) - 1))
        .attr('height', y.bandwidth())
        .style('fill', 'var(--color-purchase)')
        .on('mouseenter', function() { d3.select(this).style('opacity', 0.8); })
        .on('mouseleave', function() { d3.select(this).style('opacity', 1); hideTooltip(); })
        .on('mousemove', tip);
      g.append('rect')
        .attr('class', 'bar')
        .attr('x', x(d.purchases) + 1)
        .attr('y', y(d.ticker))
        .attr('width', Math.max(0, x(d.sales) - 1))
        .attr('height', y.bandwidth())
        .style('fill', 'var(--color-sale)')
        .on('mouseenter', function() { d3.select(this).style('opacity', 0.8); })
        .on('mouseleave', function() { d3.select(this).style('opacity', 1); hideTooltip(); })
        .on('mousemove', tip);
      g.append('text')
        .attr('class', 'value-label')
        .attr('x', x(d.count) + 6)
        .attr('y', y(d.ticker) + y.bandwidth() / 2)
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

export function mountTopTickers(container, stats, { onFilter } = {}) {
  if (!container) return;
  rootFor(container).render(<TopTickers stats={stats} onFilter={onFilter} />);
}
