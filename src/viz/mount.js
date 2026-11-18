// One React root per chart container. A page whose stats are refetched (the
// trades charts, when the chamber filter changes) mounts again with the new
// stats; this hands back the root already there, so the chart re-renders in
// place instead of React warning about a second root on one container.
import { createRoot } from 'react-dom/client';

const roots = new WeakMap();

export function rootFor(container) {
  let root = roots.get(container);
  if (!root) {
    root = createRoot(container);
    roots.set(container, root);
  }
  return root;
}
