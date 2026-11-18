// Who filed: every filing is joined to one bioguide ID from
// unitedstates/congress-legislators, and the name the page shows comes from
// there, for both chambers. The name as filed stays on the filing.
//
// House rule (the Clerk's index has no ID): a token of `Last` (it can hold
// credentials or a second surname: "Dunn MD, FACS", "Hinson Arenholz") plus
// `StateDst` plus a House term covering the filing date. Then, in order, a
// term that ended within GRACE_DAYS before the filing (reports filed after
// leaving), and the same state on any district (a stale StateDst). First name
// breaks a tie; none needed it on 2013 to 2026. Anything left fails the load
// until overrides.json pins it.
//
// Senate rows arrive with a bioguide ID already (Senate Stock Watcher's).

export const GRACE_DAYS = 400;

const norm = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '');

export function displayName(p) {
  const n = p.name;
  return n.official_full ?? [n.first, n.last, n.suffix].filter(Boolean).join(' ');
}

// Index-style sort key: surname first.
export function sortName(p) {
  const n = p.name;
  return [n.last, [n.first, n.suffix].filter(Boolean).join(' ')].join(', ');
}

function lastKeys(p) {
  const keys = new Set([norm(p.name.last)]);
  for (const o of p.other_names || []) if (o.last) keys.add(norm(o.last));
  // Compound surnames: the index's Last may hold one half ("Lujan Grisham").
  for (const part of (p.name.last || '').split(/[\s-]+/)) if (part.length > 2) keys.add(norm(part));
  return keys;
}

export function houseMatcher(people, since = '2013-01-01') {
  const terms = [];
  for (const p of people) {
    const keys = lastKeys(p);
    for (const t of p.terms || []) {
      if (t.type !== 'rep' || t.end < since) continue;
      terms.push({ p, keys, state: t.state, district: t.district, start: t.start, end: t.end });
    }
  }
  return (ix) => {
    const st = ix.StateDst.slice(0, 2), dist = Number(ix.StateDst.slice(2));
    const lasts = new Set([norm(ix.Last), ...ix.Last.split(/[\s,]+/).map(norm).filter((x) => x.length > 1)]);
    const nameOk = (t) => [...lasts].some((x) => t.keys.has(x));
    const seat = (t) => t.state === st && t.district === dist && nameOk(t);
    const date = ix.filed;
    const graceFrom = new Date(Date.parse(date) - GRACE_DAYS * 864e5).toISOString().slice(0, 10);
    const passes = [
      ['term', (t) => seat(t) && t.start <= date && date <= t.end],
      ['after-term', (t) => seat(t) && t.end < date && t.end >= graceFrom],
      ['state', (t) => t.state === st && nameOk(t) && t.start <= date && date <= t.end],
    ];
    for (const [how, test] of passes) {
      const ids = [...new Map(terms.filter(test).map((t) => [t.p.id.bioguide, t.p])).values()];
      if (!ids.length) continue;
      if (ids.length === 1) return { bioguide: ids[0].id.bioguide, how };
      const first = norm(ix.First.split(' ')[0]);
      const pick = ids.filter((p) => [p.name.first, p.name.nickname, p.name.middle].some((n) => norm(n) === first));
      if (pick.length === 1) return { bioguide: pick[0].id.bioguide, how: `${how}+first` };
      return { bioguide: null, how: 'ambiguous', candidates: ids.map((p) => p.id.bioguide) };
    }
    return { bioguide: null, how: 'none' };
  };
}

// trade_members rows for the people actually filing. Two people with one
// display name (Mike Rogers of AL-03 and of MI-08) each get their last seat
// in parentheses, so a member filter always means one person.
export function memberRows(people, bioguides) {
  const byId = new Map(people.map((p) => [p.id.bioguide, p]));
  const chosen = [...bioguides].map((b) => {
    const p = byId.get(b);
    if (!p) throw new Error(`bioguide ${b} is not in congress-legislators`);
    return p;
  });
  const count = new Map();
  for (const p of chosen) count.set(displayName(p), (count.get(displayName(p)) ?? 0) + 1);
  return chosen.map((p) => {
    let member = displayName(p);
    if (count.get(member) > 1) {
      const t = p.terms.at(-1);
      member += ` (${t.state}${t.type === 'rep' ? `-${String(t.district).padStart(2, '0')}` : ''})`;
    }
    return { bioguide: p.id.bioguide, member, member_sort: sortName(p) };
  }).sort((a, b) => a.bioguide.localeCompare(b.bioguide));
}
