// Figure 1 on /over-time/: one series of addresses over time.
//
// With no terms, the words each year's records hold, as bars. With terms,
// each term's rate per million words, one line per term. A line joins
// consecutive members of the series (every year for the State of the Union,
// every fourth for inaugurals) and breaks at a member with no record in the
// corpus; those members are marked on the baseline in both views. A member
// standing alone between two breaks is drawn as a point. Hairlines mark the
// years amendments were ratified, labeled above the plot where they fit and
// named in the tooltip everywhere.
//
// Years sit at the center of their band, so bars and points line up.
import React, { useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';
import { showTooltip, hideTooltip } from './tooltip.js';
import { useContainerWidth, measureText } from './chart-size.js';

export const TERM_COLORS = ['var(--color-series-1)', 'var(--color-series-2)', 'var(--color-series-3)'];

const fmtInt = d3.format(',');
const fmtRate = (v) => (v >= 100 ? d3.format(',.0f')(v) : v >= 10 ? d3.format('.1f')(v) : d3.format('.2f')(v));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const swatch = (color) => `<span style="display:inline-block;width:9px;height:9px;margin-right:6px;background:${color}"></span>`;

function TermRate({ data, members, ratifications, onYear }) {
  const svgRef = useRef();
  const fullWidth = useContainerWidth(svgRef);

  useEffect(() => {
    if (!fullWidth || !data) return;
    const byYear = new Map(data.years.map((d) => [d.year, d]));
    const memberYears = [...new Set(members?.length ? members : data.years.map((d) => d.year))].sort((a, b) => a - b);
    const absent = memberYears.filter((y) => !byYear.has(y));
    const terms = data.terms
      .map((t, i) => ({ ...t, idx: i, color: TERM_COLORS[i], counts: new Map(t.counts.map((c) => [c.year, c.n])) }))
      .filter((t) => t.status === 'ok');
    const lineMode = terms.length > 0;
    const svgNode = svgRef.current;
    d3.select(svgNode).selectAll('*').remove();
    if (!memberYears.length) return;

    const narrow = fullWidth < 560;
    const series = terms.map((t) => ({
      ...t,
      points: memberYears.map((year) => {
        const y = byYear.get(year);
        return { year, n: y ? t.counts.get(year) || 0 : null, v: y ? ((t.counts.get(year) || 0) / y.words) * 1e6 : null };
      }),
    }));

    // Direct labels at each line's last point, wide screens only; below 560
    // the term inputs above the figure are the legend.
    const labelWidth = lineMode && !narrow
      ? measureText(svgNode, series.map((s) => s.input), 'value-label') + 10 : 0;
    const margin = { top: 0, right: Math.max(8, labelWidth), bottom: 26, left: narrow ? 40 : 48 };
    const width = fullWidth - margin.left - margin.right;
    const first = memberYears[0];
    const last = memberYears[memberYears.length - 1];
    const x = d3.scaleLinear().domain([first, last + 1]).range([0, width]);
    const cx = (year) => x(year + 0.5);

    // Ratification labels: right of the rule, a row down where they would
    // overlap the label before. Wide screens only.
    const ROW = 14;
    const rules = (ratifications || []).filter((r) => r.year >= first && r.year <= last);
    const placed = [];
    if (!narrow) {
      const widths = rules.map((r) => measureText(svgNode, [r.label], 'value-label'));
      rules.forEach((r, i) => {
        const left = Math.round(cx(r.year)) + 3;
        let row = 0;
        while (placed.some((p) => p.row === row && left < p.right + 6)) row += 1;
        placed.push({ ...r, left, right: left + widths[i], row });
      });
    }
    const rows = placed.length ? Math.max(...placed.map((p) => p.row)) + 1 : 0;
    margin.top = rows ? rows * ROW + 8 : 10;
    const height = (narrow ? 250 : 330) - margin.top - margin.bottom;

    const svg = d3.select(svgNode)
      .attr('width', fullWidth)
      .attr('height', height + margin.top + margin.bottom)
      .attr('viewBox', `0 0 ${fullWidth} ${height + margin.top + margin.bottom}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const yMax = lineMode
      ? d3.max(series, (s) => d3.max(s.points, (p) => p.v)) || 1
      : d3.max(data.years, (d) => d.words) || 1;
    const y = d3.scaleLinear().domain([0, yMax * 1.05]).nice().range([height, 0]);

    svg.append('g')
      .attr('class', 'axis axis-y')
      .call(d3.axisLeft(y).ticks(narrow ? 4 : 5).tickSize(-width).tickPadding(8)
        .tickFormat(lineMode ? d3.format(',~r') : d3.format('~s')));
    const step = narrow ? 50 : 25;
    svg.append('g')
      .attr('class', 'axis axis-x')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x)
        .tickValues(d3.range(Math.ceil(first / step) * step, last + 1, step).map((t) => t + 0.5))
        .tickSize(0).tickPadding(9).tickFormat((t) => String(t - 0.5)));

    // Ratification hairlines, under the data.
    for (const r of rules) {
      const px = Math.round(cx(r.year)) + 0.5;
      svg.append('line')
        .attr('x1', px).attr('x2', px)
        .attr('y1', narrow ? 0 : -margin.top + 2).attr('y2', height)
        .style('stroke', 'var(--color-ink-dim)')
        .style('stroke-width', 1)
        .style('stroke-dasharray', '2 3')
        .style('opacity', 0.55);
    }
    for (const p of placed) {
      svg.append('text')
        .attr('class', 'value-label')
        .attr('x', p.left)
        .attr('y', -margin.top + 11 + p.row * ROW)
        .style('paint-order', 'stroke')
        .style('stroke', 'var(--color-ground)')
        .style('stroke-width', '4px')
        .style('stroke-linejoin', 'round')
        .text(p.label);
    }

    if (lineMode) {
      for (const s of series) {
        const line = d3.line().defined((p) => p.v != null).x((p) => cx(p.year)).y((p) => y(p.v));
        svg.append('path')
          .datum(s.points)
          .attr('d', line)
          .style('fill', 'none')
          .style('stroke', s.color)
          .style('stroke-width', 2)
          .style('stroke-linejoin', 'round');
        const lone = s.points.filter((p, i, a) => p.v != null && a[i - 1]?.v == null && a[i + 1]?.v == null);
        svg.append('g').selectAll('circle').data(lone).join('circle')
          .attr('cx', (p) => cx(p.year)).attr('cy', (p) => y(p.v)).attr('r', 3.5)
          .style('fill', s.color).style('stroke', 'var(--color-ground)').style('stroke-width', 2);
      }
      if (!narrow) {
        // Labels at each line's last drawn point, nudged apart vertically,
        // then lifted as a stack so the lowest stays above the baseline and
        // clear of the year axis (lines often end near zero).
        const GAP = 14;
        const ends = series.map((s) => {
          const p = [...s.points].reverse().find((q) => q.v != null);
          return p ? { s, y: y(p.v) } : null;
        }).filter(Boolean).sort((a, b) => a.y - b.y);
        for (let i = 1; i < ends.length; i += 1) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + GAP);
        const floor = height - 7;
        if (ends.length && ends[ends.length - 1].y > floor) {
          ends[ends.length - 1].y = floor;
          for (let i = ends.length - 2; i >= 0; i -= 1) ends[i].y = Math.min(ends[i].y, ends[i + 1].y - GAP);
        }
        for (const e of ends) {
          svg.append('text')
            .attr('class', 'value-label')
            .attr('x', width + 6)
            .attr('y', e.y + 4)
            .text(e.s.input);
        }
      }
    } else {
      const bw = Math.max(1, x(first + 1) - x(first) - (x(first + 1) - x(first) > 5 ? 2 : 0));
      svg.append('g').selectAll('rect').data(data.years).join('rect')
        .attr('class', 'bar')
        .attr('x', (d) => cx(d.year) - bw / 2)
        .attr('y', (d) => y(d.words))
        .attr('width', bw)
        .attr('height', (d) => height - y(d.words))
        .style('fill', 'var(--color-figure)');
    }

    // Members with no record in the corpus, on the baseline.
    svg.append('g').selectAll('circle').data(absent).join('circle')
      .attr('cx', (yr) => cx(yr)).attr('cy', height).attr('r', 3)
      .style('fill', 'var(--color-ground)').style('stroke', 'var(--color-ink-dim)').style('stroke-width', 1.25);

    svg.append('line')
      .attr('class', 'baseline')
      .attr('x1', 0).attr('x2', width)
      .attr('y1', height + 0.5).attr('y2', height + 0.5);

    // Crosshair and tooltip: the pointer snaps to the nearest member year.
    const cross = svg.append('line')
      .attr('y1', 0).attr('y2', height)
      .style('stroke', 'var(--color-ink)').style('stroke-width', 1).style('opacity', 0);
    const marks = svg.append('g');
    const rulesByYear = d3.group(rules, (r) => r.year);
    const nearest = (mx) => {
      const yr = x.invert(mx) - 0.5;
      const i = d3.bisectCenter(memberYears, yr);
      return memberYears[Math.max(0, Math.min(memberYears.length - 1, i))];
    };
    const tooltip = (yr) => {
      const d = byYear.get(yr);
      const head = `<strong>${yr}</strong>${d ? ` · ${d.speakers.map(esc).join(', ')}` : ''}`;
      const body = !d ? ['No record in the corpus']
        : lineMode
          ? series.map((s) => {
            const p = s.points.find((q) => q.year === yr);
            return `${swatch(s.color)}${esc(s.input)}: ${fmtInt(p.n)} · ${fmtRate(p.v)} per million`;
          }).concat(`${fmtInt(d.words)} words`)
          : [`${fmtInt(d.words)} words`, `${d.records} ${d.records === 1 ? 'record' : 'records'}`];
      const amend = (rulesByYear.get(yr) || []).flatMap((r) => r.details.map(esc));
      return [head, ...body, ...amend].join('<br>');
    };
    const termAt = (yr, my) => {
      if (!lineMode) return null;
      let best = null;
      for (const s of series) {
        const p = s.points.find((q) => q.year === yr);
        if (p?.v == null) continue;
        const dist = Math.abs(y(p.v) - my);
        if (!best || dist < best.dist) best = { i: s.idx, dist };
      }
      return best?.i ?? null;
    };
    svg.append('rect')
      .attr('width', width).attr('height', height)
      .style('fill', 'transparent')
      .style('cursor', 'pointer')
      .on('mousemove', (event) => {
        const [mx] = d3.pointer(event);
        const yr = nearest(mx);
        cross.attr('x1', cx(yr)).attr('x2', cx(yr)).style('opacity', 0.35);
        marks.selectAll('*').remove();
        if (lineMode && byYear.has(yr)) {
          for (const s of series) {
            const p = s.points.find((q) => q.year === yr);
            marks.append('circle').attr('cx', cx(yr)).attr('cy', y(p.v)).attr('r', 4)
              .style('fill', s.color).style('stroke', 'var(--color-ground)').style('stroke-width', 2);
          }
        }
        showTooltip(event, tooltip(yr));
      })
      .on('mouseleave', () => {
        cross.style('opacity', 0);
        marks.selectAll('*').remove();
        hideTooltip();
      })
      .on('click', (event) => {
        const [mx, my] = d3.pointer(event);
        const yr = nearest(mx);
        if (byYear.has(yr) && onYear) onYear(yr, termAt(yr, my));
      });
  }, [data, members, ratifications, fullWidth]);

  return <svg ref={svgRef} className="chart" style={{ width: '100%', height: 'auto' }} />;
}

// One root per container, re-rendered with each new response.
const roots = new WeakMap();
export function mountTermRate(container, props) {
  if (!container) return;
  if (!roots.has(container)) roots.set(container, createRoot(container));
  roots.get(container).render(<TermRate {...props} />);
}
