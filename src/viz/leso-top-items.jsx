import React, { useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';

function TopItems({ stats }) {
  const svgRef = useRef();

  useEffect(() => {
    if (!stats.top_items) return;
    const data = stats.top_items.slice(0, 10);

    const margin = { top: 30, right: 60, bottom: 20, left: 160 };
    const width = 440 - margin.left - margin.right;
    const height = 260 - margin.top - margin.bottom;

    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current)
      .attr('viewBox', `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const y = d3.scaleBand()
      .domain(data.map(d => d.item_name))
      .range([0, height])
      .padding(0.15);

    const x = d3.scaleLinear()
      .domain([0, d3.max(data, d => d.total_qty) * 1.1])
      .range([0, width]);

    // Bars
    svg.selectAll('rect')
      .data(data)
      .join('rect')
      .attr('x', 0)
      .attr('y', d => y(d.item_name))
      .attr('width', d => x(d.total_qty))
      .attr('height', y.bandwidth())
      .attr('fill', '#5a6e4a')
      .attr('rx', 2);

    // Item labels (truncated)
    svg.selectAll('.label')
      .data(data)
      .join('text')
      .attr('x', -6)
      .attr('y', d => y(d.item_name) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'end')
      .text(d => {
        const name = d.item_name;
        return name.length > 28 ? name.slice(0, 26) + '…' : name;
      })
      .style('fill', '#8a7e6b')
      .style('font-size', '8px');

    // Quantity labels
    svg.selectAll('.value')
      .data(data)
      .join('text')
      .attr('x', d => x(d.total_qty) + 4)
      .attr('y', d => y(d.item_name) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .text(d => d.total_qty.toLocaleString())
      .style('fill', '#8a7e6b')
      .style('font-size', '9px');

    // Title
    svg.append('text')
      .attr('x', -margin.left + 10).attr('y', -15)
      .text('Most Transferred Items (by Quantity)')
      .style('fill', '#2d2418').style('font-size', '13px').style('font-weight', '600');

  }, [stats]);

  return <svg ref={svgRef} style={{ width: '100%', height: 'auto' }} />;
}

export function mountTopItems(container, stats) {
  if (!container) return;
  const root = createRoot(container);
  root.render(<TopItems stats={stats} />);
}
