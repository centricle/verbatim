import React, { useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';
import { showTooltip, hideTooltip } from './tooltip.js';

function ScoreDistribution({ stats }) {
  const svgRef = useRef(null);

  useEffect(() => {
    if (!stats?.score_distribution || !svgRef.current) return;

    const data = stats.score_distribution;
    const container = svgRef.current.parentElement;
    const width = container.clientWidth;
    const height = 260;
    const margin = { top: 20, right: 20, bottom: 40, left: 50 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const svg = d3.select(svgRef.current)
      .attr('width', width)
      .attr('height', height);

    svg.selectAll('*').remove();

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const races = ['African-American', 'Caucasian', 'Hispanic'];
    const colors = {
      'African-American': 'oklch(0.55 0.12 30)',
      'Caucasian': 'oklch(0.60 0.10 210)',
      'Hispanic': 'oklch(0.60 0.10 145)',
    };

    // Normalize to percentages within each race
    const raceTotals = {};
    races.forEach(race => {
      raceTotals[race] = d3.sum(data.filter(d => d.race === race), d => d.count);
    });

    const scores = d3.range(1, 11);

    const x0 = d3.scaleBand()
      .domain(scores)
      .range([0, innerW])
      .padding(0.2);

    const x1 = d3.scaleBand()
      .domain(races)
      .range([0, x0.bandwidth()])
      .padding(0.05);

    const maxPct = d3.max(data, d => d.count / raceTotals[d.race]) || 0.25;

    const y = d3.scaleLinear()
      .domain([0, maxPct])
      .range([innerH, 0]);

    // Axes
    g.append('g')
      .attr('transform', `translate(0,${innerH})`)
      .call(d3.axisBottom(x0).tickFormat(d => d))
      .call(g => g.select('.domain').attr('stroke', 'oklch(0.70 0.02 60)'))
      .call(g => g.selectAll('.tick text').attr('fill', 'oklch(0.45 0.03 60)').style('font-size', '11px'))
      .call(g => g.selectAll('.tick line').attr('stroke', 'oklch(0.70 0.02 60)'));

    g.append('g')
      .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format('.0%')))
      .call(g => g.select('.domain').attr('stroke', 'oklch(0.70 0.02 60)'))
      .call(g => g.selectAll('.tick text').attr('fill', 'oklch(0.45 0.03 60)').style('font-size', '11px'))
      .call(g => g.selectAll('.tick line').attr('stroke', 'oklch(0.70 0.02 60)'));

    // Bars
    scores.forEach(score => {
      races.forEach(race => {
        const d = data.find(d => d.race === race && d.decile_score === score);
        if (!d) return;
        const pct = d.count / raceTotals[race];

        g.append('rect')
          .attr('x', x0(score) + x1(race))
          .attr('y', y(pct))
          .attr('width', x1.bandwidth())
          .attr('height', innerH - y(pct))
          .attr('fill', colors[race])
          .attr('rx', 1)
          .style('cursor', 'pointer')
          .on('mouseenter', function() { d3.select(this).style('opacity', 0.8); })
          .on('mouseleave', function() { d3.select(this).style('opacity', 1); hideTooltip(); })
          .on('mousemove', (event) => {
            showTooltip(event, `<strong>${race}</strong><br>Score ${score}: ${d3.format('.1%')(pct)} (${d.count.toLocaleString()})`);
          });
      });
    });

    // X label
    g.append('text')
      .attr('x', innerW / 2)
      .attr('y', innerH + 35)
      .attr('text-anchor', 'middle')
      .attr('fill', 'oklch(0.45 0.03 60)')
      .style('font-size', '11px')
      .text('COMPAS Decile Score');

    // Legend
    const legend = g.append('g')
      .attr('transform', `translate(${innerW - 180}, 0)`);

    races.forEach((race, i) => {
      const row = legend.append('g').attr('transform', `translate(0, ${i * 18})`);
      row.append('rect').attr('width', 12).attr('height', 12).attr('rx', 2).attr('fill', colors[race]);
      row.append('text').attr('x', 16).attr('y', 10).attr('fill', 'oklch(0.45 0.03 60)')
        .style('font-size', '11px').text(race);
    });

  }, [stats]);

  return <svg ref={svgRef} />;
}

export function mountScoreDistribution(container, stats) {
  if (!container) return;
  const root = createRoot(container);
  const title = document.createElement('h3');
  title.className = 'text-sm font-semibold mb-3';
  title.textContent = 'Risk Score Distribution by Race';
  container.prepend(title);
  const wrapper = document.createElement('div');
  container.appendChild(wrapper);
  const vizRoot = createRoot(wrapper);
  vizRoot.render(<ScoreDistribution stats={stats} />);
}
