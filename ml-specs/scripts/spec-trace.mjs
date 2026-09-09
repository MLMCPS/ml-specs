#!/usr/bin/env node
// Verify the ID chain from ticket to test case for one spec, or every spec.
// Pure Node, no dependencies. Read-only. No network calls — nothing leaves this machine.
//
//   node spec-trace.mjs                          # every spec in the repo
//   node spec-trace.mjs specs/0031-foo.md        # one spec
//   node spec-trace.mjs 0031                     # by id
//   node spec-trace.mjs --json                   # machine-readable
//   node spec-trace.mjs --root /path/to/repo
//
// Exit code 1 if any chain is broken, so it can gate a merge.
//
// Why this exists: "which requirement is covered by which test, and did it ship?"
// is the question an auditor asks and the one a repo usually cannot answer without
// a week of archaeology. It only stays answerable if every artifact carries the
// spec's id — and the way that silently stops being true is a hand-typed branch
// name. This checks it in milliseconds, for free, on every push.
//
// It deliberately distinguishes BROKEN from UNVERIFIABLE. A ticket reference a
// human typed into the header table cannot be checked from inside the repo; saying
// so is honest, and quietly counting it as passing would make the report a lie.

import { listSpecs } from './lib/specs.mjs';
import { buildChain, verifyChain, renderChain } from './lib/trace.mjs';

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? fallback);
};
const has = (name) => argv.includes(`--${name}`);

const root = flag('root', process.cwd());
const json = has('json');
const target = argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--root');

const C = process.stdout.isTTY && !json
  ? { dim: (s) => `\x1b[2m${s}\x1b[0m`, red: (s) => `\x1b[31m${s}\x1b[0m`,
      green: (s) => `\x1b[32m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m` }
  : { dim: (s) => s, red: (s) => s, green: (s) => s, bold: (s) => s };

const all = listSpecs(root);
const specs = target
  ? all.filter((s) => s.id === target || s.file.endsWith(target) || s.file === target)
  : all;

if (specs.length === 0) {
  console.error(target ? `no spec matching "${target}" under ${root}` : `no specs under ${root}`);
  process.exit(1);
}

const results = specs.map((spec) => {
  const chain = buildChain(spec);
  const report = verifyChain(chain);
  return { spec, chain, report };
});

if (json) {
  console.log(JSON.stringify({
    root,
    ok: results.every((r) => r.report.ok),
    specs: results.map(({ spec, chain, report }) => ({
      id: spec.id,
      title: spec.title,
      status: spec.status,
      ok: report.ok,
      links: chain.links.map((l) => ({ kind: l.kind, ref: l.ref, origin: l.origin })),
      broken: report.broken.map((b) => ({ kind: b.link.kind, ref: b.link.ref, reason: b.reason, found: b.found })),
      unverifiable: report.unverifiable.map((l) => ({ kind: l.kind, ref: l.ref })),
    })),
  }, null, 2));
} else {
  for (const { spec, chain, report } of results) {
    console.log(`${C.bold(`SPEC-${spec.id}`)} ${spec.title}  ${C.dim(spec.status ?? 'unknown')}`);
    console.log(`  ${renderChain(chain)}`);
    console.log(report.ok ? `  ${C.green('chain intact')}` : `  ${C.red(`${report.broken.length} broken link(s)`)}`);
    for (const b of report.broken) {
      console.log(`    ${C.red('x')} ${b.link.kind} ${b.link.ref} ${C.dim(`(${b.reason}, found ${b.found ?? 'nothing'})`)}`);
    }
    for (const u of report.unverifiable) {
      console.log(`    ${C.dim(`? ${u.kind} ${u.ref} — hand-typed, cannot be verified from the repo`)}`);
    }
    console.log();
  }
  const broken = results.filter((r) => !r.report.ok).length;
  console.log(broken === 0
    ? C.green(`  ${results.length} spec(s), every chain intact`)
    : C.red(`  ${broken} of ${results.length} spec(s) have a broken chain`));
}

process.exit(results.every((r) => r.report.ok) ? 0 : 1);
