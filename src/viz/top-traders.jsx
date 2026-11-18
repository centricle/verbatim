import React, { useRef, useEffect } from 'react';
import { rootFor } from './mount.js';
import * as d3 from 'd3';
import { showTooltip, hideTooltip } from './tooltip.js';
import { useContainerWidth, measureText, fitText } from './chart-size.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

// With both chambers in the stats, each name carries its chamber's title, as
// the appendix's Member column does. A member with rows from both gets both.
const TITLE = { house: 'Rep.', senate: 'Sen.' };
const labelFor = (d, mixed) => {
  const name = d.member ?? d.senator;
  if (!mixed || !d.chambers?.length) return name;
  return `${d.chambers.map((c) => TITLE[c]).join('/')} ${name}`;
};

function TopTraders({ stats, onFilter }) {
  const svgRef = useRef();
  const fullWidth = useContainerWidth(svgRef);

  useEffect(() => {
    if (!stats.top_traders || !fullWidth) return;
    const mixed = (stats.by_chamber?.length ?? 0) > 1;
    const data = stats.top_traders.slice(0, 15).map((d) => ({
      ...d, key: d.member ?? d.senator, label: labelFor(d, mixed),
    }));

    d3.select(svgRef.current).selectAll('*').remove();

    const labelWidth = measureText(svgRef.current, data.map((d) => d.label), 'cat-label');
    const valueWidth = measureText(svgRef.current, data.map((d) => d.total_trades.toLocaleString()), 'value-label');
    const labelRoom = Math.min(labelWidth, Math.round(fullWidth * 0.45));
    const margin = { top: 4, right: valueWidth + 10, bottom: 4, left: labelRoom + 12 };
    const rowHeight = 24;
    const height = data.length * rowHeight;
    const width = fullWidth - margin.left - margin.right;

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
      .domain(data.map(d => d.key))
      .range([0, height])
      .padding(0.28);

    // Member labels, shortened only if the margin cannot hold them
    svg.selectAll('.cat-label')
      .data(data)
      .join('text')
      .attr('class', 'cat-label')
      .attr('x', -10)
      .attr('y', d => y(d.key) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'end')
      .text(d => d.label)
      .each(function() { fitText(this, labelRoom); });

    // Stacked bars: purchases then sales, split by a 2px gap in the ground color
    data.forEach(d => {
      const g = svg.append('g');
      const tip = (event) => {
        showTooltip(event, `<strong>${esc(d.label)}</strong><br>Purchases: ${d.purchases}<br>Sales: ${d.sales}<br>Total: ${d.total_trades}`);
      };
      const select = () => { if (onFilter) onFilter({ key: 'member', value: d.key }); };
      // Purchases
      g.append('rect')
        .attr('class', 'bar')
        .attr('x', 0)
        .attr('y', y(d.key))
        .attr('width', Math.max(0, x(d.purchases) - 1))
        .attr('height', y.bandwidth())
        .style('fill', 'var(--color-purchase)')
        .style('cursor', 'pointer')
        .on('mouseenter', function() { d3.select(this).style('opacity', 0.8); })
        .on('mouseleave', function() { d3.select(this).style('opacity', 1); hideTooltip(); })
        .on('mousemove', tip)
        .on('click', select);
      // Sales
      g.append('rect')
        .attr('class', 'bar')
        .attr('x', x(d.purchases) + 1)
        .attr('y', y(d.key))
        .attr('width', Math.max(0, x(d.sales) - 1))
        .attr('height', y.bandwidth())
        .style('fill', 'var(--color-sale)')
        .style('cursor', 'pointer')
        .on('mouseenter', function() { d3.select(this).style('opacity', 0.8); })
        .on('mouseleave', function() { d3.select(this).style('opacity', 1); hideTooltip(); })
        .on('mousemove', tip)
        .on('click', select);
      // Count label
      g.append('text')
        .attr('class', 'value-label')
        .attr('x', x(d.total_trades) + 6)
        .attr('y', y(d.key) + y.bandwidth() / 2)
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
  rootFor(container).render(<TopTraders stats={stats} onFilter={onFilter} />);
}
