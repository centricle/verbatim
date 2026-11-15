import React, { useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';
import { showTooltip, hideTooltip } from './tooltip.js';
import { useContainerWidth, wrapText } from './chart-size.js';

function AccuracyBreakdown({ stats }) {
  const svgRef = useRef(null);
  const fullWidth = useContainerWidth(svgRef);

  useEffect(() => {
    if (!stats?.score_by_race || !stats?.recid_by_race || !fullWidth) return;

    const narrow = fullWidth < 560;
    const margin = { top: 18, right: 4, bottom: 40, left: 44 };
    const width = fullWidth - margin.left - margin.right;
    const height = (narrow ? 240 : 280) - margin.top - margin.bottom;

    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current)
      .attr('width', fullWidth)
      .attr('height', height + margin.top + margin.bottom)
      .attr('viewBox', `0 0 ${fullWidth} ${height + margin.top + margin.bottom}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Calculate prediction accuracy per race
    // "Accurate" = (scored High/Medium AND recidivated) OR (scored Low AND did not recidivate)
    const recidByRace = stats.recid_by_race;

    // We need per-defendant accuracy, but we have aggregates
    // Use the false positive/negative rates to derive accuracy
    const fpData = stats.false_positive_by_race || [];
    const fnData = stats.false_negative_by_race || [];

    const races = ['African-American', 'Caucasian', 'Hispanic'];

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

    // Grouped bar: recidivism rate vs. error rates
    const metrics = [
      { key: 'recidivismRate', label: 'Actual Recidivism Rate' },
      { key: 'falsePositiveRate', label: 'False Positive Rate' },
      { key: 'falseNegativeRate', label: 'False Negative Rate' },
    ];
    const metricColors = [
      'var(--color-series-4)',
      'var(--color-series-2)',
      'var(--color-series-1)',
    ];

    const x0 = d3.scaleBand()
      .domain(races)
      .range([0, width])
      .paddingInner(narrow ? 0.2 : 0.3)
      .paddingOuter(0.1);

    const x1 = d3.scaleBand()
      .domain(metrics.map(m => m.key))
      .range([0, x0.bandwidth()])
      .padding(0.06);

    const maxVal = d3.max(chartData.flatMap(d => metrics.map(m => d[m.key]))) || 0.6;

    const y = d3.scaleLinear()
      .domain([0, Math.ceil(maxVal * 10) / 10])
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
    chartData.forEach(d => {
      metrics.forEach((m, i) => {
        const val = d[m.key];
        svg.append('rect')
          .attr('class', 'bar')
          .attr('x', x0(d.race) + x1(m.key))
          .attr('y', y(val))
          .attr('width', x1.bandwidth())
          .attr('height', height - y(val))
          .style('fill', metricColors[i])
          .on('mouseenter', function() { d3.select(this).style('opacity', 0.8); })
          .on('mouseleave', function() { d3.select(this).style('opacity', 1); hideTooltip(); })
          .on('mousemove', (event) => {
            showTooltip(event, `<strong>${d.race}</strong><br>${m.label}: ${d3.format('.1%')(val)}`);
          });

        svg.append('text')
          .attr('class', 'value-label')
          .attr('x', x0(d.race) + x1(m.key) + x1.bandwidth() / 2)
          .attr('y', y(val) - 5)
          .attr('text-anchor', 'middle')
          .text(d3.format('.0%')(val));
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

export function mountAccuracy(container, stats) {
  if (!container) return;
  const root = createRoot(container);
  root.render(<AccuracyBreakdown stats={stats} />);
}
