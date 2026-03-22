import React, { useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';
import { showTooltip, hideTooltip } from './tooltip.js';

function ShootingsByRace({ stats, onFilter }) {
  const svgRef = useRef();

  useEffect(() => {
    if (!stats.by_race) return;
    const data = stats.by_race.sort((a, b) => Number(b.total) - Number(a.total));

    const margin = { top: 30, right: 50, bottom: 20, left: 90 };
    const width = 440 - margin.left - margin.right;
    const barHeight = 28;
    const height = data.length * barHeight;

    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current)
      .attr('viewBox', `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3.scaleLinear()
      .domain([0, d3.max(data, d => Number(d.total)) * 1.1])
      .range([0, width]);

    const y = d3.scaleBand()
      .domain(data.map(d => d.race_label))
      .range([0, height])
      .padding(0.2);

    svg.selectAll('rect')
      .data(data)
      .join('rect')
      .attr('x', 0)
      .attr('y', d => y(d.race_label))
      .attr('width', d => x(Number(d.total)))
      .attr('height', y.bandwidth())
      .attr('fill', '#6b4226')
      .attr('rx', 2)
      .style('cursor', 'pointer')
      .on('mouseenter', function() { d3.select(this).style('opacity', 0.8); })
      .on('mouseleave', function() { d3.select(this).style('opacity', 1); hideTooltip(); })
      .on('mousemove', (event, d) => {
        showTooltip(event, `<strong>${d.race_label}</strong><br>${Number(d.total).toLocaleString()} incidents`);
      })
      .on('click', (event, d) => { if (onFilter) onFilter({ key: 'race', value: d.race }); });

    svg.selectAll('.label')
      .data(data)
      .join('text')
      .attr('x', -8)
      .attr('y', d => y(d.race_label) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'end')
      .text(d => d.race_label)
      .style('fill', '#8a7e6b')
      .style('font-size', '10px');

    svg.selectAll('.value')
      .data(data)
      .join('text')
      .attr('x', d => x(Number(d.total)) + 5)
      .attr('y', d => y(d.race_label) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .text(d => Number(d.total).toLocaleString())
      .style('fill', '#8a7e6b')
      .style('font-size', '9px');

    svg.append('text')
      .attr('x', 0).attr('y', -15)
      .text('Shootings by Race')
      .style('fill', '#2d2418').style('font-size', '13px').style('font-weight', '600');

  }, [stats]);

  return <svg ref={svgRef} style={{ width: '100%', height: 'auto' }} />;
}

export function mountShootingsByRace(container, stats, { onFilter } = {}) {
  if (!container) return;
  const root = createRoot(container);
  root.render(<ShootingsByRace stats={stats} onFilter={onFilter} />);
}
