// Shared tooltip utility for all D3 charts
// Uses position: fixed + clientX/clientY to avoid SVG coordinate math.
// Colors and type come from the @theme tokens in app.css.

let tooltipEl = null;

function ensureTooltip() {
  if (tooltipEl) return tooltipEl;
  tooltipEl = document.createElement('div');
  tooltipEl.setAttribute('role', 'presentation');
  tooltipEl.style.cssText = `
    position: fixed;
    pointer-events: none;
    background: var(--color-ink);
    color: var(--color-ground);
    padding: 7px 10px 8px;
    font-family: var(--font-label);
    font-size: 13px;
    line-height: 1.45;
    font-variant-numeric: tabular-nums;
    max-width: 260px;
    z-index: 9999;
    opacity: 0;
    transition: opacity 150ms ease;
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
