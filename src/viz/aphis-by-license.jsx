import React, { useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';

const LICENSE_LABELS = {
  A: 'Breeder',
  B: 'Broker',
  C: 'Exhibitor',
  R: 'Research',
  T: 'Carrier',
  H: 'Handler',
  G: 'Govt Research',
};

function AphisByLicense({ stats }) {
  const svgRef = useRef();

  useEffect(() => {
    if (!stats.by_license_type) return;
    const data = stats.by_license_type
      .filter(d => LICENSE_LABELS[d.license_type])
      .map(d => ({ ...d, label: LICENSE_LABELS[d.license_type] || d.license_type }));

    const margin = { top: 30, right: 60, bottom: 20, left: 10 };
    const width = 440 - margin.left - margin.right;
    const height = 220 - margin.top - margin.bottom;

    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current)
      .attr('viewBox', `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const y = d3.scaleBand()
      .domain(data.map(d => d.label))
      .range([0, height])
      .padding(0.2);

    const x = d3.scaleLinear()
      .domain([0, d3.max(data, d => Number(d.count)) * 1.1])
      .range([0, width]);

    svg.selectAll('rect')
      .data(data)
      .join('rect')
      .attr('x', 0)
      .attr('y', d => y(d.label))
      .attr('width', d => x(Number(d.count)))
      .attr('height', y.bandwidth())
      .attr('fill', '#6b5a3e')
      .attr('rx', 2);

    svg.selectAll('.label')
      .data(data)
      .join('text')
      .attr('x', 4)
      .attr('y', d => y(d.label) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .text(d => d.label)
      .style('fill', '#f5edd6')
      .style('font-size', '10px')
      .style('font-weight', '600');

    svg.selectAll('.value')
      .data(data)
      .join('text')
      .attr('x', d => x(Number(d.count)) + 4)
      .attr('y', d => y(d.label) + y.bandwidth() / 2)
      .attr('dy', '0.35em')
      .text(d => Number(d.count).toLocaleString())
      .style('fill', '#8a7e6b')
      .style('font-size', '9px');

    svg.append('text')
      .attr('x', 0).attr('y', -15)
      .text('Inspections by License Type')
      .style('fill', '#2d2418').style('font-size', '13px').style('font-weight', '600');

  }, [stats]);

  return <svg ref={svgRef} style={{ width: '100%', height: 'auto' }} />;
}

export function mountAphisByLicense(container, stats) {
  if (!container) return;
  const root = createRoot(container);
  root.render(<AphisByLicense stats={stats} />);
}
