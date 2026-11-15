import React, { useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';
import { showTooltip, hideTooltip } from './tooltip.js';
import { useContainerWidth, measureText } from './chart-size.js';

// Party identity colors; a party without one takes the neutral "other".
const PARTY_COLORS = {
  DEM: 'var(--color-party-dem)',
  REP: 'var(--color-party-rep)',
  LIB: 'var(--color-party-lib)',
  GRE: 'var(--color-party-gre)',
  IND: 'var(--color-party-ind)',
};

function fmtMoney(v) {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${(v / 1e3).toFixed(0)}K`;
}

function ByParty({ stats, onFilter }) {
  const svgRef = useRef();
  const fullWidth = useContainerWidth(svgRef);

  useEffect(() => {
    if (!stats.by_party || !fullWidth) return;
    const data = stats.by_party.slice(0, 8);

    d3.select(svgRef.current).selectAll('*').remove();

    const labelWidth = measureText(svgRef.current, data.map(d => d.party), 'cat-label cat-label--ticker');
    const valueWidth = measureText(svgRef.current, data.map(d => fmtMoney(Number(d.total_raised))), 'value-label');
    const margin = { top: 4, right: valueWidth + 10, bottom: 4, left: labelWidth + 12 };
    const rowHeight = 30;
    const height = data.length * rowHeight;
    const width = fullWidth - margin.left - margin.right;

    const svg = d3.select(svgRef.current)
      .attr('width', fullWidth)
      .attr('height', height + margin.top + margin.bottom)
      .attr('viewBox', `0 0 ${fullWidth} ${height + margin.top + margin.bottom}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3.scaleLinear()
      .domain([0, d3.max(data, d => Number(d.total_raised))])
      .range([0, width]);

    const y = d3.scaleBand()
      .domain(data.map(d => d.party))
      .range([0, height])
      .padding(0.3);

    svg.selectAll('.bar')
      .data(data)
      .join('rect')
      .attr('class', 'bar')
      .attr('x', 0)
      .attr('y', d => y(d.party))
      .attr('width', d => Math.max(1, x(Number(d.total_raised))))
      .attr('height', y.bandwidth())
      .style('fill', d => PARTY_COLORS[d.party] || 'var(--color-other)')
      .style('cursor', 'pointer')
      .on('mouseenter', function() { d3.select(this).style('opacity', 0.8); })
      .on('mouseleave', function() { d3.select(this).style('opacity', 1); hideTooltip(); })
      .on('mousemove', (event, d) => {
        const v = Number(d.total_raised);
        const fmt = v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(0)}M` : `$${(v / 1e3).toFixed(0)}K`;
        showTooltip(event, `<strong>${d.party}</strong><br>${fmt} raised<br>${Number(d.candidate_count).toLocaleString()} candidates`);
      })
      .on('click', (event, d) => { if (onFilter) onFilter({ key: 'party', value: d.party }); });

    svg.selectAll('.cat-label')
      .data(data)
      .join('text')
      .attr('class', 'cat-label cat-label--ticker')
      .attr('x', -10)
      .attr('y', d => y(d.party) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'end')
      .text(d => d.party);

    svg.selectAll('.value-label')
      .data(data)
      .join('text')
      .attr('class', 'value-label')
      .attr('x', d => Math.max(1, x(Number(d.total_raised))) + 6)
      .attr('y', d => y(d.party) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .text(d => fmtMoney(Number(d.total_raised)));

    // Zero line in ink
    svg.append('line')
      .attr('class', 'baseline')
      .attr('x1', 0.5).attr('x2', 0.5)
      .attr('y1', 0).attr('y2', height);

  }, [stats, fullWidth]);

  return <svg ref={svgRef} className="chart" style={{ width: '100%', height: 'auto' }} />;
}

export function mountByParty(container, stats, { onFilter } = {}) {
  if (!container) return;
  const root = createRoot(container);
  root.render(<ByParty stats={stats} onFilter={onFilter} />);
}
