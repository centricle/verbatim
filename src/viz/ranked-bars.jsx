// Horizontal bars, one per category: the shape of most explorer figures
// ("reports by make", "top districts"). Bars keep the order the data arrives
// in, as the stats function sorted and trimmed it: most first, or another
// order it chose (presidents in term order on /executive/). This draws them
// at true size and sets a filter when a bar is selected.
import React, { useRef, useEffect } from 'react';
import { rootFor } from './mount.js';
import * as d3 from 'd3';
import { showTooltip, hideTooltip } from './tooltip.js';
import { useContainerWidth, measureText, fitText } from './chart-size.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

function RankedBars({ data, label, value, noun, filterKey, onFilter, display, format, exact }) {
  const svgRef = useRef();
  const fullWidth = useContainerWidth(svgRef);

  useEffect(() => {
    if (!data?.length || !fullWidth) return;
    const rows = data.map((d) => ({ key: String(d[label]), text: display ? display(d) : String(d[label]), n: Number(d[value]) }));
    const fmt = format ?? ((n) => n.toLocaleString());
    const tip = exact ?? fmt;

    d3.select(svgRef.current).selectAll('*').remove();

    const labelWidth = measureText(svgRef.current, rows.map((d) => d.text), 'cat-label');
    const valueWidth = measureText(svgRef.current, rows.map((d) => fmt(d.n)), 'value-label');
    const margin = { top: 4, right: valueWidth + 10, bottom: 4, left: Math.min(labelWidth, Math.round(fullWidth * 0.45)) + 12 };
    const rowHeight = 24;
    const height = rows.length * rowHeight;
    const width = fullWidth - margin.left - margin.right;

    const svg = d3.select(svgRef.current)
      .attr('width', fullWidth)
      .attr('height', height + margin.top + margin.bottom)
      .attr('viewBox', `0 0 ${fullWidth} ${height + margin.top + margin.bottom}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const y = d3.scaleBand().domain(rows.map((d) => d.key)).range([0, height]).padding(0.28);
    const x = d3.scaleLinear().domain([0, d3.max(rows, (d) => d.n)]).range([0, width]);

    svg.selectAll('.bar')
      .data(rows)
      .join('rect')
      .attr('class', 'bar')
      .attr('x', 0)
      .attr('y', (d) => y(d.key))
      .attr('width', (d) => Math.max(1, x(d.n)))
      .attr('height', y.bandwidth())
      .style('fill', 'var(--color-figure)')
      .style('cursor', onFilter ? 'pointer' : null)
      .on('mouseenter', function () { d3.select(this).style('opacity', 0.8); })
      .on('mouseleave', function () { d3.select(this).style('opacity', 1); hideTooltip(); })
      .on('mousemove', (event, d) => {
        showTooltip(event, `<strong>${esc(d.text)}</strong><br>${esc(tip(d.n))}${noun ? ` ${esc(noun)}` : ''}`);
      })
      .on('click', (event, d) => { if (onFilter) onFilter({ key: filterKey, value: d.key }); });

    svg.selectAll('.cat-label')
      .data(rows)
      .join('text')
      .attr('class', 'cat-label')
      .attr('x', -10)
      .attr('y', (d) => y(d.key) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'end')
      .text((d) => d.text)
      .each(function () { fitText(this, margin.left - 12); });

    svg.selectAll('.value-label')
      .data(rows)
      .join('text')
      .attr('class', 'value-label')
      .attr('x', (d) => Math.max(1, x(d.n)) + 6)
      .attr('y', (d) => y(d.key) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .text((d) => fmt(d.n));

    svg.append('line')
      .attr('class', 'baseline')
      .attr('x1', 0.5).attr('x2', 0.5)
      .attr('y1', 0).attr('y2', height);
  }, [data, fullWidth]);

  return <svg ref={svgRef} className="chart" style={{ width: '100%', height: 'auto' }} />;
}

/**
 * @param {HTMLElement} container
 * @param {object[]} data   Ranked rows from a stats function.
 * @param {object} opts
 * @param {string} opts.label      Field holding the category name.
 * @param {string} opts.value      Field holding the count.
 * @param {string} opts.noun       Plural noun for the tooltip ("reports"); empty for none.
 * @param {string} opts.filterKey  Explorer filter a bar sets.
 * @param {Function} [opts.onFilter]  Unset leaves the bars unselectable.
 * @param {(n: number) => string} [opts.format]  Value label text. Default `toLocaleString`.
 * @param {(n: number) => string} [opts.exact]   Tooltip value text, when the label rounds
 *                                (a dollar amount). Default `format`.
 * @param {(row: object) => string} [opts.display]  Text for a bar's label and tooltip
 *                                when it differs from the value the filter takes
 *                                (a speaker's name for a slug).
 */
export function mountRankedBars(container, data, opts) {
  if (!container) return;
  rootFor(container).render(<RankedBars data={data} {...opts} />);
}
