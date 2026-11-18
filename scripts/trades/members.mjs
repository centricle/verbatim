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
// Senate, from eFD (senateMatcher below): eFD has no ID either, and its office
// column is "Senator" more often than a name, so the rule reads the list's
// first and last name columns. Last name (suffixes dropped: "Perdue , Jr",
// "Sessions, III"), then a Senate term at the received date with the same
// GRACE_DAYS, then first name, nickname or middle name to break a tie. On
// November 2026's list it matched all 83 filers and agreed with Senate Stock
// Watcher's corrected ID on every one of the 1,441 filings both hold.
//
// Senate Stock Watcher's rows arrive with a bioguide ID already, and it is
// not always right: three senators carry the ID of a namesake from the 1790s
// to the 1950s. senate.mjs holds every one to a Senate term (senateTerm
// below) and overrides.json's `carambat` corrects the three. senateMatcher
// gets all three right with no pin.

export const GRACE_DAYS = 400;

// Whether a bioguide held a Senate seat on a date, or left one within
// GRACE_DAYS before it (the same allowance the House rule gives a report
// filed after leaving).
export function senateTerm(people) {
  const terms = new Map();
  for (const p of people) {
    const sen = (p.terms || []).filter((t) => t.type === 'sen');
    if (sen.length) terms.set(p.id.bioguide, sen);
  }
  return (bioguide, date) => {
    const graceFrom = new Date(Date.parse(date) - GRACE_DAYS * 864e5).toISOString().slice(0, 10);
    return (terms.get(bioguide) ?? []).some((t) => t.start <= date && t.end >= graceFrom);
  };
}

const fold = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
const SUFFIX = new Set(['jr', 'sr', 'ii', 'iii', 'iv']);
const words = (s) => fold(s).split(' ').filter((w) => w && !SUFFIX.has(w));

// eFD list names to a bioguide: { bioguide, how }, or { bioguide: null, how:
// 'none' | 'ambiguous', candidates }.
export function senateMatcher(people, since = '2011-01-01') {
  const sens = [];
  for (const p of people) {
    const terms = (p.terms || []).filter((t) => t.type === 'sen');
    if (!terms.length || terms.at(-1).end < since) continue;
    const lasts = new Set([words(p.name.last).join(' '), ...(p.other_names || []).filter((o) => o.last).map((o) => words(o.last).join(' '))]);
    const firsts = new Set([p.name.first, p.name.nickname, p.name.middle, ...(p.other_names || []).map((o) => o.first)]
      .filter(Boolean).map((n) => words(n)[0]).filter(Boolean));
    sens.push({ p, terms, lasts, firsts });
  }
  return ({ first, last, date }) => {
    const l = words(last).join(' ');
    const lastOk = (s) => [...s.lasts].some((x) => x === l || x.split(' ').includes(l) || l.split(' ').includes(x));
    const graceFrom = new Date(Date.parse(date) - GRACE_DAYS * 864e5).toISOString().slice(0, 10);
    let c = sens.filter((s) => lastOk(s) && s.terms.some((t) => t.start <= date && t.end >= graceFrom));
    let how = 'term';
    const tied = c;
    if (c.length > 1) {
      const given = new Set(words(first));
      c = c.filter((s) => [...s.firsts].some((f) => given.has(f)));
      how = 'term+first';
    }
    if (c.length === 1) return { bioguide: c[0].p.id.bioguide, how };
    // A first name that fits none of a tie still names the tie, for the pin.
    const left = c.length ? c : tied;
    return { bioguide: null, how: left.length ? 'ambiguous' : 'none', candidates: left.map((s) => s.p.id.bioguide) };
  };
}

// When a senator's last Senate term ended, or null while it runs.
export function senateDeparture(people, today = new Date().toISOString().slice(0, 10)) {
  const end = new Map();
  for (const p of people) {
    const sen = (p.terms || []).filter((t) => t.type === 'sen');
    if (sen.length) end.set(p.id.bioguide, sen.at(-1).end);
  }
  return (bioguide) => {
    const e = end.get(bioguide);
    return e && e <= today ? e : null;
  };
}

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
