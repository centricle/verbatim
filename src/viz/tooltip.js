// Shared tooltip utility for all D3 charts
// Uses position: fixed + clientX/clientY to avoid SVG coordinate math

let tooltipEl = null;

function ensureTooltip() {
  if (tooltipEl) return tooltipEl;
  tooltipEl = document.createElement('div');
  tooltipEl.style.cssText = `
    position: fixed;
    pointer-events: none;
    background: #2d2418;
    color: #e8e0d0;
    padding: 6px 10px;
    border-radius: 4px;
    font-size: 12px;
    line-height: 1.4;
    max-width: 260px;
    z-index: 9999;
    opacity: 0;
    transition: opacity 150ms ease;
    box-shadow: 0 2px 8px rgba(0,0,0,0.25);
  `;
  document.body.appendChild(tooltipEl);
  return tooltipEl;
}

export function showTooltip(event, html) {
  const el = ensureTooltip();
  el.innerHTML = html;
  el.style.opacity = '1';

  const pad = 12;
  let x = event.clientX + pad;
  let y = event.clientY - pad;

  // Prevent overflow off right edge
  const rect = el.getBoundingClientRect();
  if (x + rect.width > window.innerWidth) {
    x = event.clientX - rect.width - pad;
  }
  // Prevent overflow off top
  if (y < 0) {
    y = event.clientY + pad;
  }

  el.style.left = x + 'px';
  el.style.top = y + 'px';
}

export function hideTooltip() {
  if (tooltipEl) {
    tooltipEl.style.opacity = '0';
  }
}
