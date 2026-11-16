// Speakers over time: one row per speaker, a bar from the year of their first
// dated record to their last, ordered by first record. It orders by date and
// ranks nobody, which is why it replaced a top-15-by-count figure (IA session,
// 2026-11-15: a count partly measures how a source divides a work).
import React, { useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';
import { showTooltip, hideTooltip } from './tooltip.js';
import { useContainerWidth, measureText, fitText } from './chart-size.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

const COLOR = { core: 'var(--color-series-1)', voices: 'var(--color-series-2)' };

function SpeakerSpan({ data, onFilter }) {
  const svgRef = useRef();
  const fullWidth = useContainerWidth(svgRef);

  useEffect(() => {
    if (!data?.length || !fullWidth) return;
    const rows = data.map((d) => ({
      key: d.speaker, text: d.speaker_name, collection: d.collection,
      first: Number(d.first), last: Number(d.last), n: Number(d.count),
    }));

    d3.select(svgRef.current).selectAll('*').remove();

    const narrow = fullWidth < 560;
    const labelWidth = measureText(svgRef.current, rows.map((d) => d.text), 'cat-label');
    const axisH = 22;
    const margin = { top: axisH, right: 14, bottom: axisH, left: Math.min(labelWidth, Math.round(fullWidth * 0.45)) + 12 };
    const rowHeight = 16;
    const height = rows.length * rowHeight;
    const width = fullWidth - margin.left - margin.right;

    const lo = Math.floor(d3.min(rows, (d) => d.first) / 10) * 10;
    const hi = d3.max(rows, (d) => d.last) + 1;
    const x = d3.scaleLinear().domain([lo, hi]).range([0, width]);
    const y = d3.scaleBand().domain(rows.map((d) => d.key)).range([0, height]).padding(0.3);

    const svg = d3.select(svgRef.current)
      .attr('width', fullWidth)
      .attr('height', height + margin.top + margin.bottom)
      .attr('viewBox', `0 0 ${fullWidth} ${height + margin.top + margin.bottom}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Year rules every 50 years (100 when narrow), labeled top and bottom so
    // the axis is in view at both ends of a tall figure.
    const step = narrow ? 100 : 50;
    const ticks = d3.range(Math.ceil(lo / step) * step, hi, step);
    svg.append('g')
      .attr('class', 'axis axis-grid')
      .call(d3.axisTop(x).tickValues(ticks).tickSize(-height).tickPadding(7).tickFormat(String));
    svg.append('g')
      .attr('class', 'axis axis-grid')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x).tickValues(ticks).tickSize(0).tickPadding(9).tickFormat(String));

    const row = svg.selectAll('.span-row')
      .data(rows)
      .join('g')
      .attr('class', 'span-row')
      .attr('transform', (d) => `translate(0,${y(d.key)})`)
      .style('cursor', onFilter ? 'pointer' : null)
      .on('mouseenter', function () { d3.select(this).classed('is-hover', true); })
      .on('mouseleave', function () { d3.select(this).classed('is-hover', false); hideTooltip(); })
      .on('mousemove', (event, d) => {
        const years = d.first === d.last ? String(d.first) : `${d.first} to ${d.last}`;
        const noun = d.n === 1 ? 'dated record' : 'dated records';
        showTooltip(event, `<strong>${esc(d.text)}</strong><br>${years}<br>${d.n.toLocaleString()} ${noun}`);
      })
      .on('click', (event, d) => { if (onFilter) onFilter({ key: 'speaker', value: d.key }); });

    // Full-row hit target, so a one-year bar is as easy to select as a long one.
    row.append('rect')
      .attr('class', 'span-hit')
      .attr('x', -margin.left)
      .attr('y', -y.step() * y.paddingInner() / 2)
      .attr('width', fullWidth)
      .attr('height', y.step());

    // A year is drawn as its full width, so first == last is still a mark.
    row.append('rect')
      .attr('class', 'span-bar')
      .attr('x', (d) => x(d.first))
      .attr('width', (d) => Math.max(3, x(d.last + 1) - x(d.first)))
      .attr('height', y.bandwidth())
      .style('fill', (d) => COLOR[d.collection] || 'var(--color-figure)');

    row.append('text')
      .attr('class', 'cat-label')
      .attr('x', -10)
      .attr('y', y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'end')
      .text((d) => d.text)
      .each(function () { fitText(this, margin.left - 12); });
  }, [data, fullWidth]);

  return <svg ref={svgRef} className="chart" style={{ width: '100%', height: 'auto' }} />;
}

/**
 * @param {HTMLElement} container
 * @param {object[]} data  `speaker_span` from corpus_stats: speaker, speaker_name,
 *                         collection, first, last, count; ordered by first.
 * @param {object} opts
 * @param {Function} [opts.onFilter]  Called with { key: 'speaker', value: slug }.
 */
export function mountCorpusSpeakerSpan(container, data, opts = {}) {
  if (!container) return;
  createRoot(container).render(<SpeakerSpan data={data} onFilter={opts.onFilter} />);
}
