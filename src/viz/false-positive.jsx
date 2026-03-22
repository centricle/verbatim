import React, { useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';
import { showTooltip, hideTooltip } from './tooltip.js';

function FalsePositiveRates({ stats }) {
  const svgRef = useRef(null);

  useEffect(() => {
    if (!stats?.false_positive_by_race || !stats?.false_negative_by_race || !svgRef.current) return;

    const container = svgRef.current.parentElement;
    const width = container.clientWidth;
    const height = 260;
    const margin = { top: 20, right: 20, bottom: 50, left: 50 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const svg = d3.select(svgRef.current)
      .attr('width', width)
      .attr('height', height);

    svg.selectAll('*').remove();

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Combine FP and FN data
    const fpData = stats.false_positive_by_race;
    const fnData = stats.false_negative_by_race;

    const races = fpData.map(d => d.race);
    const metrics = ['False Positive', 'False Negative'];
    const colors = {
      'False Positive': 'oklch(0.55 0.12 30)',
      'False Negative': 'oklch(0.60 0.10 210)',
    };

    const x0 = d3.scaleBand()
      .domain(races)
      .range([0, innerW])
      .padding(0.3);

    const x1 = d3.scaleBand()
      .domain(metrics)
      .range([0, x0.bandwidth()])
      .padding(0.1);

    const maxRate = d3.max([
      ...fpData.map(d => d.rate),
      ...fnData.map(d => d.rate)
    ]) || 0.5;

    const y = d3.scaleLinear()
      .domain([0, Math.ceil(maxRate * 10) / 10])
      .range([innerH, 0]);

    // Axes
    g.append('g')
      .attr('transform', `translate(0,${innerH})`)
      .call(d3.axisBottom(x0))
      .call(g => g.select('.domain').attr('stroke', 'oklch(0.70 0.02 60)'))
      .call(g => g.selectAll('.tick text').attr('fill', 'oklch(0.45 0.03 60)').style('font-size', '10px'))
      .call(g => g.selectAll('.tick line').attr('stroke', 'oklch(0.70 0.02 60)'));

    g.append('g')
      .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format('.0%')))
      .call(g => g.select('.domain').attr('stroke', 'oklch(0.70 0.02 60)'))
      .call(g => g.selectAll('.tick text').attr('fill', 'oklch(0.45 0.03 60)').style('font-size', '11px'))
      .call(g => g.selectAll('.tick line').attr('stroke', 'oklch(0.70 0.02 60)'));

    // Bars
    races.forEach(race => {
      const fp = fpData.find(d => d.race === race);
      const fn = fnData.find(d => d.race === race);

      if (fp) {
        g.append('rect')
          .attr('x', x0(race) + x1('False Positive'))
          .attr('y', y(fp.rate))
          .attr('width', x1.bandwidth())
          .attr('height', innerH - y(fp.rate))
          .attr('fill', colors['False Positive'])
          .attr('rx', 2)
          .style('cursor', 'pointer')
          .on('mouseenter', function() { d3.select(this).style('opacity', 0.8); })
          .on('mouseleave', function() { d3.select(this).style('opacity', 1); hideTooltip(); })
          .on('mousemove', (event) => {
            showTooltip(event, `<strong>${race}</strong><br>False Positive: ${d3.format('.1%')(fp.rate)}`);
          });

        // Rate label
        g.append('text')
          .attr('x', x0(race) + x1('False Positive') + x1.bandwidth() / 2)
          .attr('y', y(fp.rate) - 4)
          .attr('text-anchor', 'middle')
          .attr('fill', 'oklch(0.45 0.03 60)')
          .style('font-size', '10px')
          .style('font-weight', '600')
          .text(d3.format('.0%')(fp.rate));
      }

      if (fn) {
        g.append('rect')
          .attr('x', x0(race) + x1('False Negative'))
          .attr('y', y(fn.rate))
          .attr('width', x1.bandwidth())
          .attr('height', innerH - y(fn.rate))
          .attr('fill', colors['False Negative'])
          .attr('rx', 2)
          .style('cursor', 'pointer')
          .on('mouseenter', function() { d3.select(this).style('opacity', 0.8); })
          .on('mouseleave', function() { d3.select(this).style('opacity', 1); hideTooltip(); })
          .on('mousemove', (event) => {
            showTooltip(event, `<strong>${race}</strong><br>False Negative: ${d3.format('.1%')(fn.rate)}`);
          });

        g.append('text')
          .attr('x', x0(race) + x1('False Negative') + x1.bandwidth() / 2)
          .attr('y', y(fn.rate) - 4)
          .attr('text-anchor', 'middle')
          .attr('fill', 'oklch(0.45 0.03 60)')
          .style('font-size', '10px')
          .style('font-weight', '600')
          .text(d3.format('.0%')(fn.rate));
      }
    });

    // Legend
    const legend = g.append('g')
      .attr('transform', `translate(${innerW - 160}, 0)`);

    metrics.forEach((metric, i) => {
      const row = legend.append('g').attr('transform', `translate(0, ${i * 18})`);
      row.append('rect').attr('width', 12).attr('height', 12).attr('rx', 2).attr('fill', colors[metric]);
      row.append('text').attr('x', 16).attr('y', 10).attr('fill', 'oklch(0.45 0.03 60)')
        .style('font-size', '11px').text(metric);
    });

  }, [stats]);

  return <svg ref={svgRef} />;
}

export function mountFalsePositive(container, stats) {
  if (!container) return;
  const title = document.createElement('h3');
  title.className = 'text-sm font-semibold mb-3';
  title.textContent = 'Error Rates by Race';
  container.prepend(title);
  const subtitle = document.createElement('p');
  subtitle.className = 'text-xs text-text-dim mb-3';
  subtitle.textContent = 'False positive = scored Medium/High but did not recidivate. False negative = scored Low but did recidivate.';
  container.insertBefore(subtitle, title.nextSibling);
  const wrapper = document.createElement('div');
  container.appendChild(wrapper);
  const root = createRoot(wrapper);
  root.render(<FalsePositiveRates stats={stats} />);
}
