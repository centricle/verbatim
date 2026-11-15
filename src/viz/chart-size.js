// Sizing helpers shared by the explorer charts.
import { useEffect, useState } from 'react';

// Charts draw at their container's real pixel width (no viewBox scaling), so
// the type sizes set in app.css are the sizes a reader sees at every width.
// The first width arrives once web fonts are ready, so labels are measured in
// the face they render in.
export function useContainerWidth(ref) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return undefined;
    let ro = null;
    let stopped = false;
    document.fonts.ready.then(() => {
      if (stopped) return;
      ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
      ro.observe(el);
    });
    return () => {
      stopped = true;
      if (ro) ro.disconnect();
    };
  }, []);
  return width;
}

// Widest rendered width, in pixels, of a set of labels set in an SVG text
// class. Used to size a category margin to its longest label.
export function measureText(svgNode, labels, className) {
  const probe = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  probe.setAttribute('class', className);
  svgNode.appendChild(probe);
  let max = 0;
  for (const label of labels) {
    probe.textContent = label;
    max = Math.max(max, probe.getComputedTextLength());
  }
  probe.remove();
  return Math.ceil(max);
}

// Shorten an SVG text node with an ellipsis until it fits maxWidth pixels,
// keeping the full label as a <title> for hover.
export function fitText(node, maxWidth) {
  const full = node.textContent;
  if (node.getComputedTextLength() <= maxWidth) return;
  let text = full;
  while (text.length > 1 && node.getComputedTextLength() > maxWidth) {
    text = text.slice(0, -1);
    node.textContent = `${text.trimEnd()}…`;
  }
  const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
  title.textContent = full;
  node.appendChild(title);
}

// Break an axis label onto two lines at its last hyphen or space when it is
// wider than maxWidth pixels. The text node must be centered (text-anchor
// middle) and positioned by its parent tick.
export function wrapText(node, maxWidth) {
  const full = node.textContent;
  if (node.getComputedTextLength() <= maxWidth) return;
  const cut = Math.max(full.lastIndexOf('-'), full.lastIndexOf(' '));
  if (cut <= 0) return;
  const first = full.slice(0, cut + (full[cut] === '-' ? 1 : 0));
  const second = full.slice(cut + 1);
  const x = node.getAttribute('x') || 0;
  const y = node.getAttribute('y') || 0;
  const dy = node.getAttribute('dy') || '0.71em';
  node.textContent = '';
  const ns = 'http://www.w3.org/2000/svg';
  const a = document.createElementNS(ns, 'tspan');
  a.setAttribute('x', x);
  a.setAttribute('y', y);
  a.setAttribute('dy', dy);
  a.textContent = first;
  const b = document.createElementNS(ns, 'tspan');
  b.setAttribute('x', x);
  b.setAttribute('dy', '1.15em');
  b.textContent = second;
  node.append(a, b);
}
