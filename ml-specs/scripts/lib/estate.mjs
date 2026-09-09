// Read docs/ESTATE.md — the index /repo-estate generates — as a contract graph,
// and answer "who else breaks if this changes".
//
// Pure Node, no dependencies. Read-only.
//
// Parsing is tolerant by design: this file is written for humans and edited by
// them, and a parser that demanded exact formatting would fail on the first
// sensible edit someone makes.

const ROW = /^\|(.+)\|\s*$/;
const SEP = /^\|[\s:|-]+\|\s*$/;
const PLACEHOLDER = /^(<.*>|_TBD_|—|-|n\/?a|none|)$/i;

const clean = (v) => String(v ?? '').replace(/[`*]/g, '').replace(/\s*\(.*\)\s*$/, '').trim();
const names = (v) => String(v ?? '').split(/[,/]| and /).map(clean).filter((n) => n && !PLACEHOLDER.test(n));

function tables(raw) {
  const out = [];
  let current = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    // The `|---|---|` rule belongs to the table it divides. Treating it as a
    // break splits every table in two and orphans its header.
    if (SEP.test(t)) continue;
    const m = ROW.exec(t);
    if (!m) { if (current.length) out.push(current); current = []; continue; }
    current.push(m[1].split('|').map((c) => c.trim()));
  }
  if (current.length) out.push(current);
  return out;
}

const headerHas = (row, ...required) => {
  const lower = row.map((c) => c.toLowerCase());
  return required.every((r) => lower.some((c) => c.includes(r)));
};

export function parseEstate(raw) {
  const publishes = new Map();
  const consumes = new Map();
  const note = (repo) => {
    if (!publishes.has(repo)) { publishes.set(repo, new Set()); consumes.set(repo, new Set()); }
    return repo;
  };

  for (const table of tables(raw)) {
    const [header, ...rows] = table;
    if (!header) continue;

    if (headerHas(header, 'service', 'owns')) {
      for (const row of rows) for (const n of names(row[0])) note(n);

    } else if (headerHas(header, 'caller', 'callee')) {
      for (const row of rows) {
        const contract = clean(row[3]) || clean(row[2]);
        if (!contract || PLACEHOLDER.test(contract)) continue;
        for (const callee of names(row[1])) publishes.get(note(callee)).add(contract);
        for (const caller of names(row[0])) consumes.get(note(caller)).add(contract);
      }

    } else if (headerHas(header, 'producer', 'consumer')) {
      for (const row of rows) {
        const event = clean(row[0]);
        if (!event || PLACEHOLDER.test(event)) continue;
        for (const p of names(row[1])) publishes.get(note(p)).add(event);
        for (const c of names(row[2])) consumes.get(note(c)).add(event);
      }

    } else if (headerHas(header, 'owner', 'used by')) {
      for (const row of rows) {
        const thing = clean(row[0]);
        if (!thing || PLACEHOLDER.test(thing)) continue;
        for (const o of names(row[1])) publishes.get(note(o)).add(thing);
        for (const u of names(row[2])) consumes.get(note(u)).add(thing);
      }
    }
  }

  const generatedAt = (/(?:generated|updated|refreshed)[^\n]*?(\d{4}-\d{2}-\d{2})/i.exec(raw) ?? [])[1] ?? '';
  return {
    generatedAt,
    repos: [...publishes.keys()].sort().map((name) => ({
      name,
      publishes: [...publishes.get(name)].sort(),
      consumes: [...consumes.get(name)].sort(),
    })),
  };
}

/** Who consumes what this change touches — directly, and one hop further out. */
export function impactOf(index, changed) {
  const owners = index.repos.filter((r) => r.publishes.some((c) => changed.includes(c))).map((r) => r.name);

  const directlyAffected = index.repos
    .filter((r) => !owners.includes(r.name))
    .map((r) => ({ repo: r.name, via: r.consumes.filter((c) => changed.includes(c)) }))
    .filter((r) => r.via.length);

  const directNames = directlyAffected.map((d) => d.repo);
  const secondWave = new Set(index.repos.filter((r) => directNames.includes(r.name)).flatMap((r) => r.publishes));

  const transitivelyAffected = index.repos
    .filter((r) => !owners.includes(r.name) && !directNames.includes(r.name))
    .map((r) => ({ repo: r.name, via: r.consumes.filter((c) => secondWave.has(c)) }))
    .filter((r) => r.via.length);

  return { changed, directlyAffected, transitivelyAffected };
}
