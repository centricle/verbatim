import React, { useRef, useEffect, useState } from 'react';
import { rootFor } from './mount.js';
import * as d3 from 'd3';
import { showTooltip, hideTooltip } from './tooltip.js';

// Charts draw at the container's real pixel width (no viewBox scaling), so the
// type sizes set in app.css are the sizes a reader sees, at 390 and at 1440.
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

const COLORS = { purchases: 'var(--color-purchase)', sales: 'var(--color-sale)' };

function TradesByYear({ stats, onFilter }) {
  const svgRef = useRef();
  const fullWidth = useContainerWidth(svgRef);

  useEffect(() => {
    if (!stats.by_year || !fullWidth) return;
    const data = stats.by_year;

    const narrow = fullWidth < 560;
    const margin = { top: 10, right: 4, bottom: 26, left: 44 };
    const width = fullWidth - margin.left - margin.right;
    const height = (narrow ? 230 : 300) - margin.top - margin.bottom;

    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current)
      .attr('width', fullWidth)
      .attr('height', height + margin.top + margin.bottom)
      .attr('viewBox', `0 0 ${fullWidth} ${height + margin.top + margin.bottom}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3.scaleBand()
      .domain(data.map(d => d.year))
      .range([0, width])
      .paddingInner(narrow ? 0.22 : 0.3)
      .paddingOuter(0.1);

    const subX = d3.scaleBand()
      .domain(['purchases', 'sales'])
      .range([0, x.bandwidth()])
      .padding(0.06);

    const maxVal = d3.max(data, d => Math.max(d.purchases, d.sales));
    const y = d3.scaleLinear()
      .domain([0, maxVal * 1.08])
      .nice()
      .range([height, 0]);

    // Horizontal gridlines double as the y axis
    svg.append('g')
      .attr('class', 'axis axis-y')
      .call(d3.axisLeft(y).ticks(narrow ? 4 : 5).tickSize(-width).tickPadding(8).tickFormat(d3.format(',')))
      .call(g => g.selectAll('.tick line').attr('stroke-dasharray', null));

    const shortYear = x.bandwidth() < 30;
    svg.append('g')
      .attr('class', 'axis axis-x')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x).tickSize(0).tickPadding(9).tickFormat(d => (shortYear ? `’${String(d).slice(2)}` : d)));

    data.forEach(d => {
      const g = svg.append('g').attr('transform', `translate(${x(d.year)},0)`);

      ['purchases', 'sales'].forEach(key => {
        g.append('rect')
          .attr('class', 'bar')
          .attr('x', subX(key))
          .attr('y', y(d[key]))
          .attr('width', subX.bandwidth())
          .attr('height', height - y(d[key]))
          .style('fill', COLORS[key])
          .style('cursor', 'pointer')
          .on('mouseenter', function() { d3.select(this).style('opacity', 0.8); })
          .on('mouseleave', function() { d3.select(this).style('opacity', 1); hideTooltip(); })
          .on('mousemove', (event) => {
            showTooltip(event, `<strong>${d.year}</strong><br>${key === 'purchases' ? 'Purchases' : 'Sales'}: ${d[key].toLocaleString()}`);
          })
          .on('click', () => { if (onFilter) onFilter({ key: 'year', value: String(d.year) }); });
      });
    });

    // Baseline in ink, drawn last so it sits on top of the bars' feet
    svg.append('line')
      .attr('class', 'baseline')
      .attr('x1', 0).attr('x2', width)
      .attr('y1', height + 0.5).attr('y2', height + 0.5);

  }, [stats, fullWidth]);

  return <svg ref={svgRef} className="chart" style={{ width: '100%', height: 'auto' }} />;
}

export function mountTradesByYear(container, stats, { onFilter } = {}) {
  if (!container) return;
  rootFor(container).render(<TradesByYear stats={stats} onFilter={onFilter} />);
}
