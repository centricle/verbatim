import React, { useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';
import { showTooltip, hideTooltip } from './tooltip.js';
import { useContainerWidth } from './chart-size.js';

const RACES = ['African-American', 'Caucasian', 'Hispanic'];
const COLORS = {
  'African-American': 'var(--color-series-2)',
  'Caucasian': 'var(--color-series-1)',
  'Hispanic': 'var(--color-series-3)',
};

function ScoreDistribution({ stats }) {
  const svgRef = useRef(null);
  const fullWidth = useContainerWidth(svgRef);

  useEffect(() => {
    if (!stats?.score_distribution || !fullWidth) return;

    const data = stats.score_distribution;
    const narrow = fullWidth < 560;
    const margin = { top: 10, right: 4, bottom: 48, left: 44 };
    const width = fullWidth - margin.left - margin.right;
    const height = (narrow ? 240 : 290) - margin.top - margin.bottom;

    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current)
      .attr('width', fullWidth)
      .attr('height', height + margin.top + margin.bottom)
      .attr('viewBox', `0 0 ${fullWidth} ${height + margin.top + margin.bottom}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Normalize to percentages within each race
    const raceTotals = {};
    RACES.forEach(race => {
      raceTotals[race] = d3.sum(data.filter(d => d.race === race), d => d.count);
    });

    const scores = d3.range(1, 11);

    const x0 = d3.scaleBand()
      .domain(scores)
      .range([0, width])
      .paddingInner(narrow ? 0.16 : 0.24)
      .paddingOuter(0.08);

    const x1 = d3.scaleBand()
      .domain(RACES)
      .range([0, x0.bandwidth()])
      .padding(0.06);

    const maxPct = d3.max(data, d => d.count / raceTotals[d.race]) || 0.25;

    const y = d3.scaleLinear()
      .domain([0, maxPct])
      .nice()
      .range([height, 0]);

    // Horizontal gridlines double as the y axis
    svg.append('g')
      .attr('class', 'axis axis-y')
      .call(d3.axisLeft(y).ticks(narrow ? 4 : 5).tickSize(-width).tickPadding(8).tickFormat(d3.format('.0%')));

    svg.append('g')
      .attr('class', 'axis axis-x')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x0).tickSize(0).tickPadding(9).tickFormat(d => d));

    // Bars
    scores.forEach(score => {
      RACES.forEach(race => {
        const d = data.find(d => d.race === race && d.decile_score === score);
        if (!d) return;
        const pct = d.count / raceTotals[race];

        svg.append('rect')
          .attr('class', 'bar')
          .attr('x', x0(score) + x1(race))
          .attr('y', y(pct))
          .attr('width', x1.bandwidth())
          .attr('height', height - y(pct))
          .style('fill', COLORS[race])
          .on('mouseenter', function() { d3.select(this).style('opacity', 0.8); })
          .on('mouseleave', function() { d3.select(this).style('opacity', 1); hideTooltip(); })
          .on('mousemove', (event) => {
            showTooltip(event, `<strong>${race}</strong><br>Score ${score}: ${d3.format('.1%')(pct)} (${d.count.toLocaleString()})`);
          });
      });
    });

    // Baseline in ink
    svg.append('line')
      .attr('class', 'baseline')
      .attr('x1', 0).attr('x2', width)
      .attr('y1', height + 0.5).attr('y2', height + 0.5);

    // X label
    svg.append('text')
      .attr('class', 'axis-title')
      .attr('x', width / 2)
      .attr('y', height + 42)
      .attr('text-anchor', 'middle')
      .text('COMPAS decile score');

  }, [stats, fullWidth]);

  return <svg ref={svgRef} className="chart" style={{ width: '100%', height: 'auto' }} />;
}

export function mountScoreDistribution(container, stats) {
  if (!container) return;
  const root = createRoot(container);
  root.render(<ScoreDistribution stats={stats} />);
}
