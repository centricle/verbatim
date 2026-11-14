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

function TopTraders({ stats, onFilter }) {
  const svgRef = useRef();
  const fullWidth = useContainerWidth(svgRef);

  useEffect(() => {
    if (!stats.top_traders || !fullWidth) return;
    const data = stats.top_traders.slice(0, 15);

    const narrow = fullWidth < 480;
    const margin = { top: 4, right: 44, bottom: 4, left: narrow ? 128 : 150 };
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
      .domain([0, d3.max(data, d => d.total_trades)])
      .range([0, width]);

    const y = d3.scaleBand()
      .domain(data.map(d => d.senator))
      .range([0, height])
      .padding(0.28);

    // Senator labels
    svg.selectAll('.cat-label')
      .data(data)
      .join('text')
      .attr('class', 'cat-label')
      .attr('x', -10)
      .attr('y', d => y(d.senator) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'end')
      .text(d => d.senator);

    // Stacked bars: purchases then sales, split by a 2px gap in the ground color
    data.forEach(d => {
      const g = svg.append('g');
      const tip = (event) => {
        showTooltip(event, `<strong>${d.senator}</strong><br>Purchases: ${d.purchases}<br>Sales: ${d.sales}<br>Total: ${d.total_trades}`);
      };
      // Purchases
      g.append('rect')
        .attr('class', 'bar')
        .attr('x', 0)
        .attr('y', y(d.senator))
        .attr('width', Math.max(0, x(d.purchases) - 1))
        .attr('height', y.bandwidth())
        .style('fill', 'var(--color-purchase)')
        .style('cursor', 'pointer')
        .on('mouseenter', function() { d3.select(this).style('opacity', 0.8); })
        .on('mouseleave', function() { d3.select(this).style('opacity', 1); hideTooltip(); })
        .on('mousemove', tip)
        .on('click', () => { if (onFilter) onFilter({ key: 'senator', value: d.senator }); });
      // Sales
      g.append('rect')
        .attr('class', 'bar')
        .attr('x', x(d.purchases) + 1)
        .attr('y', y(d.senator))
        .attr('width', Math.max(0, x(d.sales) - 1))
        .attr('height', y.bandwidth())
        .style('fill', 'var(--color-sale)')
        .style('cursor', 'pointer')
        .on('mouseenter', function() { d3.select(this).style('opacity', 0.8); })
        .on('mouseleave', function() { d3.select(this).style('opacity', 1); hideTooltip(); })
        .on('mousemove', tip)
        .on('click', () => { if (onFilter) onFilter({ key: 'senator', value: d.senator }); });
      // Count label
      g.append('text')
        .attr('class', 'value-label')
        .attr('x', x(d.total_trades) + 6)
        .attr('y', y(d.senator) + y.bandwidth() / 2)
        .attr('dy', '0.35em')
        .text(d.total_trades.toLocaleString());
    });

    // Zero line in ink
    svg.append('line')
      .attr('class', 'baseline')
      .attr('x1', 0.5).attr('x2', 0.5)
      .attr('y1', 0).attr('y2', height);

  }, [stats, fullWidth]);

  return <svg ref={svgRef} className="chart" style={{ width: '100%', height: 'auto' }} />;
}

export function mountTopTraders(container, stats, { onFilter } = {}) {
  if (!container) return;
  const root = createRoot(container);
  root.render(<TopTraders stats={stats} onFilter={onFilter} />);
}
