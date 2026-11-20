// Pure pieces of the fetcher: links out of the Court's list pages, local file
// names, and robots.txt. Nothing here touches the network or the disk.

// Every href in a page, resolved against the page's URL, fragment dropped,
// deduplicated in page order. `keep` sees the resolved URL object.
export function links(html, pageUrl, keep = () => true) {
  const out = [];
  const seen = new Set();
  for (const m of html.matchAll(/href\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const href = (m[1] ?? m[2]).replace(/&amp;/g, '&').trim();
    if (!href || href.startsWith('#') || /^(mailto|javascript):/i.test(href)) continue;
    let u;
    try {
      u = new URL(href, pageUrl);
    } catch {
      continue;
    }
    u.hash = '';
    if (!keep(u) || seen.has(u.href)) continue;
    seen.add(u.href);
    out.push(u.href);
  }
  return out;
}

export const pdfLinks = (html, pageUrl, keep = () => true) =>
  links(html, pageUrl, (u) => /\.pdf$/i.test(u.pathname) && keep(u));

// The U.S. Reports page links one PDF per bound volume (2 to 501 under
// /pdfs/USReports/, 502 to 587 under /opinions/boundvolumes/) and each
// preliminary print in parts (588US1PP_Ord.pdf). Volume -> URLs.
export function usReportsVolumes(html, pageUrl) {
  const vols = new Map();
  for (const url of pdfLinks(html, pageUrl)) {
    const m = /\/USREPORTS-(\d+)_[^/]*\.pdf$|\/boundvolumes\/(\d+)bv\.pdf$|\/preliminaryprint\/(\d+)US\d+PP[^/]*\.pdf$/i.exec(new URL(url).pathname);
    if (!m) continue;
    const v = Number(m[1] ?? m[2] ?? m[3]);
    if (!vols.has(v)) vols.set(v, []);
    vols.get(v).push(url);
  }
  return vols;
}

// The last path segment, decoded, with anything but [A-Za-z0-9._-] made '_'.
export function localName(url) {
  const base = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? '');
  const safe = base.replace(/[^A-Za-z0-9._-]/g, '_');
  if (!safe || /^\.+$/.test(safe)) throw new Error(`no file name in ${url}`);
  return safe;
}

// Targets that would land on the same local path. A fetch refuses to start
// with any.
export function collisions(targets) {
  const by = new Map();
  for (const t of targets) by.set(t.file, [...(by.get(t.file) ?? []), t.url]);
  return [...by].filter(([, urls]) => new Set(urls).size > 1).map(([file, urls]) => ({ file, urls }));
}

// robots.txt for one user agent: the group naming a token our UA contains,
// else the '*' group. Returns { allow, disallow, crawlDelay } (seconds or
// null). A missing robots.txt is `parseRobots('')`: everything allowed.
export function parseRobots(text, ua) {
  const groups = [];
  let cur = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === 'user-agent') {
      if (!lastWasAgent) groups.push((cur = { agents: [], allow: [], disallow: [], crawlDelay: null }));
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (field === 'allow' && value) cur.allow.push(value);
    else if (field === 'disallow' && value) cur.disallow.push(value);
    else if (field === 'crawl-delay' && Number.isFinite(Number(value))) cur.crawlDelay = Number(value);
  }
  const lower = ua.toLowerCase();
  const named = groups.find((g) => g.agents.some((a) => a !== '*' && lower.includes(a)));
  const group = named ?? groups.find((g) => g.agents.includes('*'));
  return group ? { allow: group.allow, disallow: group.disallow, crawlDelay: group.crawlDelay } : { allow: [], disallow: [], crawlDelay: null };
}

// Longest matching rule wins; Allow wins a tie. '*' matches any run of
// characters and a trailing '$' anchors the end, as Google reads them.
export function robotsAllows(rules, path) {
  const match = (rule) => {
    const anchored = rule.endsWith('$');
    const body = anchored ? rule.slice(0, -1) : rule;
    const re = new RegExp('^' + body.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (anchored ? '$' : ''));
    return re.test(path);
  };
  let best = { len: -1, allow: true };
  for (const r of rules.disallow) if (match(r) && r.length > best.len) best = { len: r.length, allow: false };
  for (const r of rules.allow) if (match(r) && r.length >= best.len) best = { len: r.length, allow: true };
  return best.allow;
}
