#!/usr/bin/env node
// Generate a self-contained HTML dashboard of a repo's specs.
// Pure Node, no dependencies. Read-only. NO network calls, and the output embeds everything
// it needs — no CDN, no fonts, no telemetry. Open the file, or commit it; either way the
// spec data never leaves the machine that ran this.
//
//   node spec-dashboard.mjs --root /path/to/repo [--out spec-dashboard.html] [--open]
//
// Design notes, so later edits don't undo the reasoning:
//   * ONE chart. The lifecycle bars are the only thing where a picture beats a number; the
//     rest are stat tiles and tables, because that is what the data actually is.
//   * The bars are a SINGLE hue with the stage named on the axis and the count direct-labeled.
//     Colouring five stages five ways would be decoration — the axis already carries identity.
//   * Status colours (critical/serious/warning) appear ONLY in the attention list, always with
//     an icon and a word, so meaning is never carried by colour alone.

import { writeFileSync, existsSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { listSpecs, analyze, LIFECYCLE } from './lib/specs.mjs';

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i === -1 ? null : args[i + 1]; };
const ROOT = resolve(flag('--root') || process.cwd());
const OUT = resolve(flag('--out') || join(ROOT, 'spec-dashboard.html'));

if (!existsSync(join(ROOT, 'specs'))) {
  console.error(`No specs/ directory in ${ROOT}. Nothing to chart.`);
  process.exit(1);
}

const specs = listSpecs(ROOT);
if (specs.length === 0) {
  console.error(`No spec files (specs/NNNN-*.md) found in ${ROOT}.`);
  process.exit(1);
}
const a = analyze(specs);

const repoName = (() => {
  try {
    const url = execFileSync('git', ['-C', ROOT, 'remote', 'get-url', 'origin'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return url.replace(/\.git$/, '').split(/[/:]/).slice(-2).join('/');
  } catch { return basename(ROOT); }
})();

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── in-flight work ──────────────────────────────────────────────────────────
// Running several specs at once (the three-developers pattern) means several worktrees on
// several branches, and it gets hard to tell which is which. This joins live worktrees back
// to the spec each one is building, so four concurrent builds are four labelled rows.
function inFlight() {
  const g = (cwd, ...a) => {
    try {
      return execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch { return ''; }
  };
  const porcelain = g(ROOT, 'worktree', 'list', '--porcelain');
  if (!porcelain) return [];

  const trees = [];
  let cur = null;
  for (const line of porcelain.split('\n')) {
    if (line.startsWith('worktree ')) { cur = { path: line.slice(9) }; trees.push(cur); }
    else if (cur && line.startsWith('branch ')) cur.branch = line.slice(7).replace('refs/heads/', '');
    else if (cur && line === 'detached') cur.branch = '(detached)';
  }

  const mainPath = trees[0]?.path;
  const dflt = g(ROOT, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD').split('/').pop()
    || (g(ROOT, 'branch', '--list', 'main') ? 'main' : 'master');

  return trees.map((t) => {
    const dirty = g(t.path, 'status', '--porcelain').split('\n').filter(Boolean).length;
    const ahead = t.branch && t.branch !== dflt
      ? Number(g(t.path, 'rev-list', '--count', `${dflt}..HEAD`) || 0) : 0;
    // Match the spec by its recorded Branch first, then by its id appearing in the branch name.
    const spec = specs.find((s) => s.branch && s.branch === t.branch)
      ?? specs.find((s) => t.branch && new RegExp(`(^|[^0-9])${s.id}([^0-9]|$)`).test(t.branch));
    return {
      path: t.path, branch: t.branch ?? '(none)', dirty, ahead, spec,
      isMain: t.path === mainPath,
    };
  });
}

const trees = inFlight();
// Only worth showing when work is genuinely spread out.
const showTrees = trees.filter((t) => !t.isMain).length > 0;
const treeRows = trees.map((t) => `
  <tr>
    <td>${t.spec
      ? `<code>${esc(t.spec.id)}</code> ${esc(t.spec.slug)}`
      : `<span class="muted">${t.isMain ? 'main checkout' : 'no matching spec'}</span>`}</td>
    <td>${t.spec?.status ? esc(t.spec.status) : '<span class="muted">—</span>'}</td>
    <td class="num">${t.spec?.acTotal ? `${t.spec.acChecked}/${t.spec.acTotal}` : '<span class="muted">—</span>'}</td>
    <td><code>${esc(t.branch)}</code></td>
    <td class="num">${t.ahead || '<span class="muted">0</span>'}</td>
    <td>${t.dirty
      ? `<span class="pill pill-warning"><span aria-hidden="true">!</span> ${t.dirty} uncommitted</span>`
      : '<span class="muted">clean</span>'}</td>
    <td><code>${esc(t.path.replace(process.env.HOME ?? '~~~', '~'))}</code></td>
  </tr>`).join('');

const inFlightSection = !showTrees ? '' : `
  <section class="card">
    <h2>In flight — parallel work</h2>
    <p class="sub">One row per git worktree, joined to the spec it's building. This is the view
      for running several specs at once: which spec, which branch, which directory, how far along.</p>
    <div class="scroll">
      <table class="tbl">
        <thead><tr><th>Spec</th><th>Status</th><th class="num">AC</th><th>Branch</th>
          <th class="num">Commits</th><th>Working tree</th><th>Path</th></tr></thead>
        <tbody>${treeRows}</tbody>
      </table>
    </div>
  </section>`;

const pct = (n, d) => (d === 0 ? 0 : Math.round((n / d) * 100));
const maxCount = Math.max(1, ...LIFECYCLE.map((s) => a.byStatus[s]));

// ── the one chart: lifecycle stages, single hue, direct-labeled ──────────────
const bars = LIFECYCLE.map((stage) => {
  const n = a.byStatus[stage];
  return `<div class="bar-row">
      <div class="bar-label">${stage}</div>
      <div class="bar-track" title="${n} spec${n === 1 ? '' : 's'} at ${stage}">
        <div class="bar-fill" style="width:${(n / maxCount) * 100}%"></div>
      </div>
      <div class="bar-value">${n}</div>
    </div>`;
}).join('\n');

const ICON = { critical: '✕', serious: '▲', warning: '!' };
const attention = a.attention.length === 0
  ? `<p class="empty">Nothing needs attention — every spec's status is backed by what's on disk.</p>`
  : `<table class="tbl">
      <thead><tr><th>Level</th><th>Spec</th><th>What's wrong</th></tr></thead>
      <tbody>${a.attention.map((x) => `
        <tr>
          <td><span class="pill pill-${x.level}"><span aria-hidden="true">${ICON[x.level]}</span> ${x.level}</span></td>
          <td><code>${esc(x.spec.id)}</code> ${esc(x.spec.slug)}</td>
          <td>${esc(x.why)}</td>
        </tr>`).join('')}
      </tbody></table>`;

const dupes = a.duplicateIds.length === 0 ? '' : `
  <section class="card">
    <h2>Duplicate spec numbers</h2>
    <p class="sub">Two files sharing an id collide at merge — git resolves that badly.
      <code>scripts/fix-specs.mjs</code> renumbers the later one and keeps history.</p>
    <table class="tbl"><thead><tr><th>Id</th><th>Files</th></tr></thead><tbody>
      ${a.duplicateIds.map((d) => `<tr><td><code>${esc(d.id)}</code></td>
        <td>${d.files.map((f) => `<code>${esc(f)}</code>`).join('<br>')}</td></tr>`).join('')}
    </tbody></table>
  </section>`;

const rows = specs.map((s) => `
  <tr data-status="${esc(s.status ?? 'Unknown')}" data-text="${esc((s.id + ' ' + s.slug + ' ' + (s.ticket ?? '')).toLowerCase())}">
    <td><code>${esc(s.id)}</code></td>
    <td>${esc(s.title)}${s.archived ? ' <span class="tag">archived</span>' : ''}</td>
    <td>${s.status ? esc(s.status) : '<span class="muted">—</span>'}${
      s.rawStatus && !s.statusIsCanonical ? ' <span class="tag tag-warn" title="Status holds prose, not a lifecycle word">prose</span>' : ''}</td>
    <td class="num">${s.acTotal ? `${s.acChecked}/${s.acTotal}` : '<span class="muted">—</span>'}</td>
    <td>${s.ticket ? esc(s.ticket) : '<span class="muted">—</span>'}</td>
    <td>${s.branch ? `<code>${esc(s.branch)}</code>` : '<span class="muted">—</span>'}</td>
  </tr>`).join('');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Specs — ${esc(repoName)}</title>
<style>
  :root {
    color-scheme: light;
    --surface-0:#f4f4f2; --surface-1:#fcfcfb; --border:#e0e0dc;
    --text-primary:#0b0b0b; --text-secondary:#52514e; --text-muted:#8a8985;
    --series-1:#2a78d6; --track:#e8e8e4;
    --critical:#d03b3b; --serious:#ec835a; --warning:#fab219;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      color-scheme: dark;
      --surface-0:#121211; --surface-1:#1a1a19; --border:#33332f;
      --text-primary:#ffffff; --text-secondary:#c3c2b7; --text-muted:#8d8c84;
      --series-1:#3987e5; --track:#2a2a27;
      --critical:#d03b3b; --serious:#ec835a; --warning:#fab219;
    }
  }
  :root[data-theme="dark"] {
    color-scheme: dark;
    --surface-0:#121211; --surface-1:#1a1a19; --border:#33332f;
    --text-primary:#ffffff; --text-secondary:#c3c2b7; --text-muted:#8d8c84;
    --series-1:#3987e5; --track:#2a2a27;
  }
  * { box-sizing:border-box; }
  body { margin:0; padding:32px 24px 64px; background:var(--surface-0); color:var(--text-primary);
    font:15px/1.55 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif; }
  .wrap { max-width:1120px; margin:0 auto; }
  header { display:flex; justify-content:space-between; align-items:baseline; gap:16px; flex-wrap:wrap; margin-bottom:24px; }
  h1 { font-size:22px; margin:0; letter-spacing:-0.01em; }
  h2 { font-size:15px; margin:0 0 4px; letter-spacing:-0.01em; }
  .sub, .meta { color:var(--text-secondary); font-size:13px; margin:0 0 16px; }
  .meta { margin:0; }
  .card { background:var(--surface-1); border:1px solid var(--border); border-radius:10px; padding:20px; margin-bottom:16px; }
  .tiles { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:12px; margin-bottom:16px; }
  .tile { background:var(--surface-1); border:1px solid var(--border); border-radius:10px; padding:16px 18px; }
  .tile .n { font-size:30px; font-weight:600; letter-spacing:-0.02em; font-variant-numeric:tabular-nums; }
  .tile .k { color:var(--text-secondary); font-size:13px; margin-top:2px; }
  .bar-row { display:grid; grid-template-columns:110px 1fr 48px; align-items:center; gap:12px; margin:7px 0; }
  .bar-label { color:var(--text-secondary); font-size:13px; }
  .bar-track { background:var(--track); border-radius:4px; height:22px; overflow:hidden; }
  .bar-fill { background:var(--series-1); height:100%; border-radius:4px; min-width:2px; }
  .bar-value { text-align:right; font-variant-numeric:tabular-nums; font-size:13px; color:var(--text-secondary); }
  .meter { background:var(--track); border-radius:4px; height:10px; overflow:hidden; margin-top:10px; }
  .meter > div { background:var(--series-1); height:100%; border-radius:4px; }
  .tbl { width:100%; border-collapse:collapse; font-size:13.5px; }
  .tbl th { text-align:left; font-weight:600; color:var(--text-secondary); font-size:12px;
    text-transform:uppercase; letter-spacing:0.04em; padding:8px 10px; border-bottom:1px solid var(--border); }
  .tbl td { padding:8px 10px; border-bottom:1px solid var(--border); vertical-align:top; }
  .tbl tr:last-child td { border-bottom:none; }
  .num { text-align:right; font-variant-numeric:tabular-nums; }
  code { font:12.5px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace; color:var(--text-secondary); }
  .muted { color:var(--text-muted); }
  .tag { font-size:11px; padding:1px 6px; border-radius:4px; border:1px solid var(--border); color:var(--text-secondary); }
  .tag-warn { border-color:var(--warning); color:var(--text-primary); }
  .pill { display:inline-flex; align-items:center; gap:5px; font-size:12px; padding:2px 8px;
    border-radius:999px; border:1px solid currentColor; white-space:nowrap; }
  .pill-critical { color:var(--critical); } .pill-serious { color:var(--serious); } .pill-warning { color:var(--warning); }
  .filters { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px; }
  input[type=search], select { background:var(--surface-0); color:var(--text-primary);
    border:1px solid var(--border); border-radius:7px; padding:7px 10px; font:inherit; font-size:13.5px; }
  input[type=search] { flex:1; min-width:200px; }
  .scroll { overflow-x:auto; }
  .empty { color:var(--text-secondary); margin:0; }
  footer { color:var(--text-muted); font-size:12px; margin-top:28px; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div>
      <h1>Specs — ${esc(repoName)}</h1>
      <p class="meta">${a.total} spec${a.total === 1 ? '' : 's'} · ${a.active} active · generated locally, no data left this machine</p>
    </div>
  </header>

  <div class="tiles">
    <div class="tile"><div class="n">${a.total}</div><div class="k">Total specs</div></div>
    <div class="tile"><div class="n">${a.byStatus.Verified}</div><div class="k">Verified</div></div>
    <div class="tile"><div class="n">${a.byStatus.Draft + a.byStatus.Approved + a.byStatus.Implemented}</div><div class="k">In flight</div></div>
    <div class="tile"><div class="n">${a.attention.length}</div><div class="k">Need attention</div></div>
  </div>

  ${inFlightSection}

  <section class="card">
    <h2>Lifecycle</h2>
    <p class="sub">Where every spec sits. ${a.unknownStatus > 0
      ? `${a.unknownStatus} spec${a.unknownStatus === 1 ? '' : 's'} had no recognisable lifecycle word and ${a.unknownStatus === 1 ? 'is' : 'are'} excluded from these bars.`
      : 'Every spec has a recognisable status.'}</p>
    ${bars}
  </section>

  <section class="card">
    <h2>Acceptance criteria</h2>
    <p class="sub">${a.acChecked} of ${a.acTotal} criteria checked across all specs (${pct(a.acChecked, a.acTotal)}%).
      A checked box is a claim; <code>/spec-verify</code> is what tests it.</p>
    <div class="meter"><div style="width:${pct(a.acChecked, a.acTotal)}%"></div></div>
  </section>

  <section class="card">
    <h2>Needs attention</h2>
    <p class="sub">Statuses the repo can't back up, ordered by severity.</p>
    <div class="scroll">${attention}</div>
  </section>

  ${dupes}

  <section class="card">
    <h2>All specs</h2>
    <div class="filters">
      <input type="search" id="q" placeholder="Search id, slug, or ticket…" aria-label="Search specs">
      <select id="st" aria-label="Filter by status">
        <option value="">All statuses</option>
        ${LIFECYCLE.map((s) => `<option>${s}</option>`).join('')}
        <option value="Unknown">Unknown</option>
      </select>
    </div>
    <div class="scroll">
      <table class="tbl" id="specs">
        <thead><tr><th>Id</th><th>Title</th><th>Status</th><th class="num">AC</th><th>Ticket</th><th>Branch</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="meta" id="count" style="margin-top:10px"></p>
  </section>

  <footer>Generated by ml-specs · ${esc(ROOT)}</footer>
</div>
<script>
  const q = document.getElementById('q'), st = document.getElementById('st');
  const rows = [...document.querySelectorAll('#specs tbody tr')];
  const count = document.getElementById('count');
  function apply() {
    const term = q.value.trim().toLowerCase(), status = st.value;
    let shown = 0;
    for (const r of rows) {
      const ok = (!term || r.dataset.text.includes(term)) && (!status || r.dataset.status === status);
      r.hidden = !ok; if (ok) shown++;
    }
    count.textContent = shown === rows.length
      ? \`Showing all \${rows.length} specs\`
      : \`Showing \${shown} of \${rows.length} specs\`;
  }
  q.addEventListener('input', apply); st.addEventListener('change', apply); apply();
</script>
</body>
</html>`;

writeFileSync(OUT, html);
console.log(`✓ ${OUT}`);
console.log(`  ${a.total} specs · ${a.attention.length} needing attention · ${a.duplicateIds.length} duplicate id(s) · ${a.unknownStatus} without a lifecycle word`);
console.log('  Self-contained, offline, no network calls — open it in a browser.');
if (args.includes('--open')) {
  try { execFileSync(process.platform === 'darwin' ? 'open' : 'xdg-open', [OUT]); } catch {}
}
