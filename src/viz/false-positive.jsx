import React, { useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';
import { showTooltip, hideTooltip } from './tooltip.js';
import { useContainerWidth, wrapText } from './chart-size.js';

const METRICS = ['False Positive', 'False Negative'];
const COLORS = {
  'False Positive': 'var(--color-series-2)',
  'False Negative': 'var(--color-series-1)',
};

function FalsePositiveRates({ stats }) {
  const svgRef = useRef(null);
  const fullWidth = useContainerWidth(svgRef);

  useEffect(() => {
    if (!stats?.false_positive_by_race || !stats?.false_negative_by_race || !fullWidth) return;

    const narrow = fullWidth < 560;
    const margin = { top: 18, right: 4, bottom: 40, left: 44 };
    const width = fullWidth - margin.left - margin.right;
    const height = (narrow ? 240 : 290) - margin.top - margin.bottom;

    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current)
      .attr('width', fullWidth)
      .attr('height', height + margin.top + margin.bottom)
      .attr('viewBox', `0 0 ${fullWidth} ${height + margin.top + margin.bottom}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Combine FP and FN data
    const fpData = stats.false_positive_by_race;
    const fnData = stats.false_negative_by_race;

    const races = fpData.map(d => d.race);

    const x0 = d3.scaleBand()
      .domain(races)
      .range([0, width])
      .paddingInner(narrow ? 0.22 : 0.3)
      .paddingOuter(0.1);

    const x1 = d3.scaleBand()
      .domain(METRICS)
      .range([0, x0.bandwidth()])
      .padding(0.06);

    const maxRate = d3.max([
      ...fpData.map(d => d.rate),
      ...fnData.map(d => d.rate)
    ]) || 0.5;

    const y = d3.scaleLinear()
      .domain([0, Math.ceil(maxRate * 10) / 10])
      .range([height, 0]);

    // Horizontal gridlines double as the y axis
    svg.append('g')
      .attr('class', 'axis axis-y')
      .call(d3.axisLeft(y).ticks(narrow ? 4 : 5).tickSize(-width).tickPadding(8).tickFormat(d3.format('.0%')));

    svg.append('g')
      .attr('class', 'axis axis-x')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x0).tickSize(0).tickPadding(9))
      .call(g => g.selectAll('.tick text').each(function() { wrapText(this, x0.step() - 4); }));

    // Bars, each with its rate above it
    races.forEach(race => {
      const pairs = [
        ['False Positive', fpData.find(d => d.race === race)],
        ['False Negative', fnData.find(d => d.race === race)],
      ];
      pairs.forEach(([metric, d]) => {
        if (!d) return;
        svg.append('rect')
          .attr('class', 'bar')
          .attr('x', x0(race) + x1(metric))
          .attr('y', y(d.rate))
          .attr('width', x1.bandwidth())
          .attr('height', height - y(d.rate))
          .style('fill', COLORS[metric])
          .on('mouseenter', function() { d3.select(this).style('opacity', 0.8); })
          .on('mouseleave', function() { d3.select(this).style('opacity', 1); hideTooltip(); })
          .on('mousemove', (event) => {
            showTooltip(event, `<strong>${race}</strong><br>${metric}: ${d3.format('.1%')(d.rate)}`);
          });

        svg.append('text')
          .attr('class', 'value-label')
          .attr('x', x0(race) + x1(metric) + x1.bandwidth() / 2)
          .attr('y', y(d.rate) - 5)
          .attr('text-anchor', 'middle')
          .text(d3.format('.0%')(d.rate));
      });
    });

    // Baseline in ink
    svg.append('line')
      .attr('class', 'baseline')
      .attr('x1', 0).attr('x2', width)
      .attr('y1', height + 0.5).attr('y2', height + 0.5);

  }, [stats, fullWidth]);

  return <svg ref={svgRef} className="chart" style={{ width: '100%', height: 'auto' }} />;
}

export function mountFalsePositive(container, stats) {
  if (!container) return;
  const root = createRoot(container);
  root.render(<FalsePositiveRates stats={stats} />);
}
