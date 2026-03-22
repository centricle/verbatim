import React, { useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';
import { showTooltip, hideTooltip } from './tooltip.js';

function AccuracyBreakdown({ stats }) {
  const svgRef = useRef(null);

  useEffect(() => {
    if (!stats?.score_by_race || !stats?.recid_by_race || !svgRef.current) return;

    const container = svgRef.current.parentElement;
    const width = container.clientWidth;
    const height = 240;
    const margin = { top: 20, right: 20, bottom: 40, left: 50 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const svg = d3.select(svgRef.current)
      .attr('width', width)
      .attr('height', height);

    svg.selectAll('*').remove();

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Calculate prediction accuracy per race
    // "Accurate" = (scored High/Medium AND recidivated) OR (scored Low AND did not recidivate)
    const scoreByRace = stats.score_by_race;
    const recidByRace = stats.recid_by_race;

    // We need per-defendant accuracy, but we have aggregates
    // Use the false positive/negative rates to derive accuracy
    const fpData = stats.false_positive_by_race || [];
    const fnData = stats.false_negative_by_race || [];

    // Build accuracy data: for each race, accuracy = 1 - (weighted error rate)
    const races = ['African-American', 'Caucasian', 'Hispanic'];
    const raceColors = {
      'African-American': 'oklch(0.55 0.12 30)',
      'Caucasian': 'oklch(0.60 0.10 210)',
      'Hispanic': 'oklch(0.60 0.10 145)',
    };

    // Recidivism rates by race
    const recidRates = {};
    recidByRace.forEach(d => {
      if (!recidRates[d.race]) recidRates[d.race] = { recid: 0, total: 0 };
      recidRates[d.race].total += d.count;
      if (d.two_year_recid === 1) recidRates[d.race].recid += d.count;
    });

    // Build stacked data: recidivism rate + high-score rate per race
    const chartData = races.map(race => {
      const rr = recidRates[race] || { recid: 0, total: 1 };
      const fp = fpData.find(d => d.race === race);
      const fn = fnData.find(d => d.race === race);

      return {
        race,
        recidivismRate: rr.recid / rr.total,
        falsePositiveRate: fp ? fp.rate : 0,
        falseNegativeRate: fn ? fn.rate : 0,
        total: rr.total,
      };
    });

    // Grouped bar: recidivism rate vs. high-score rate
    const metrics = [
      { key: 'recidivismRate', label: 'Actual Recidivism Rate' },
      { key: 'falsePositiveRate', label: 'False Positive Rate' },
      { key: 'falseNegativeRate', label: 'False Negative Rate' },
    ];
    const metricColors = [
      'oklch(0.55 0.08 70)',
      'oklch(0.55 0.12 30)',
      'oklch(0.60 0.10 210)',
    ];

    const x0 = d3.scaleBand()
      .domain(races)
      .range([0, innerW])
      .padding(0.3);

    const x1 = d3.scaleBand()
      .domain(metrics.map(m => m.key))
      .range([0, x0.bandwidth()])
      .padding(0.08);

    const maxVal = d3.max(chartData.flatMap(d => metrics.map(m => d[m.key]))) || 0.6;

    const y = d3.scaleLinear()
      .domain([0, Math.ceil(maxVal * 10) / 10])
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
    chartData.forEach(d => {
      metrics.forEach((m, i) => {
        const val = d[m.key];
        g.append('rect')
          .attr('x', x0(d.race) + x1(m.key))
          .attr('y', y(val))
          .attr('width', x1.bandwidth())
          .attr('height', innerH - y(val))
          .attr('fill', metricColors[i])
          .attr('rx', 2)
          .style('cursor', 'pointer')
          .on('mouseenter', function() { d3.select(this).style('opacity', 0.8); })
          .on('mouseleave', function() { d3.select(this).style('opacity', 1); hideTooltip(); })
          .on('mousemove', (event) => {
            showTooltip(event, `<strong>${d.race}</strong><br>${m.label}: ${d3.format('.1%')(val)}`);
          });

        g.append('text')
          .attr('x', x0(d.race) + x1(m.key) + x1.bandwidth() / 2)
          .attr('y', y(val) - 3)
          .attr('text-anchor', 'middle')
          .attr('fill', 'oklch(0.45 0.03 60)')
          .style('font-size', '9px')
          .style('font-weight', '600')
          .text(d3.format('.0%')(val));
      });
    });

    // Legend
    const legend = g.append('g')
      .attr('transform', `translate(0, ${innerH + 25})`);

    metrics.forEach((m, i) => {
      const offset = i * (innerW / 3);
      const row = legend.append('g').attr('transform', `translate(${offset}, 0)`);
      row.append('rect').attr('width', 10).attr('height', 10).attr('rx', 2).attr('fill', metricColors[i]);
      row.append('text').attr('x', 14).attr('y', 9).attr('fill', 'oklch(0.45 0.03 60)')
        .style('font-size', '10px').text(m.label);
    });

  }, [stats]);

  return <svg ref={svgRef} />;
}

export function mountAccuracy(container, stats) {
  if (!container) return;
  const title = document.createElement('h3');
  title.className = 'text-sm font-semibold mb-3';
  title.textContent = 'Prediction Accuracy by Race';
  container.prepend(title);
  const subtitle = document.createElement('p');
  subtitle.className = 'text-xs text-text-dim mb-3';
  subtitle.textContent = 'Actual recidivism rates alongside COMPAS prediction error rates. The algorithm errors differently depending on race.';
  container.insertBefore(subtitle, title.nextSibling);
  const wrapper = document.createElement('div');
  container.appendChild(wrapper);
  const root = createRoot(wrapper);
  root.render(<AccuracyBreakdown stats={stats} />);
}
