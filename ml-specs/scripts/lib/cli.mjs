// Argument and environment handling shared by the scripts that talk to a tracker
// or a source-control host. One implementation, so --dry-run and --root behave
// identically everywhere.
import { recorder, request } from './http.mjs';

export function args(argv = process.argv.slice(2)) {
  const flag = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : (argv[i + 1] ?? d); };
  const has = (n) => argv.includes(`--${n}`);
  const positional = argv.filter((a, i) => !a.startsWith('--') && !String(argv[i - 1] ?? '').startsWith('--'));
  return { argv, flag, has, positional, root: flag('root', process.cwd()), json: has('json'), dryRun: has('dry-run') };
}

export const colours = (enabled) => enabled
  ? { dim: (s) => `\x1b[2m${s}\x1b[0m`, red: (s) => `\x1b[31m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`,
      yellow: (s) => `\x1b[33m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m` }
  : { dim: (s) => s, red: (s) => s, green: (s) => s, yellow: (s) => s, bold: (s) => s };

/** A recording transport for --dry-run, the real one otherwise. */
export const transportFor = (dryRun) => (dryRun ? recorder() : request);

export const env = (name, fallback = '') => process.env[name] ?? fallback;

/** Credentials are read from the environment, never from a file in the repo. */
export function trackerConfig(transport) {
  const tool = env('SDD_PM_TOOL', 'ado');
  return tool === 'jira'
    ? { tool, config: { baseUrl: env('JIRA_BASE_URL'), email: env('JIRA_EMAIL'),
                        apiToken: env('JIRA_API_TOKEN'), projectKey: env('JIRA_PROJECT_KEY', 'PAY'), transport } }
    : { tool, config: { org: env('ADO_ORG'), project: env('ADO_PROJECT'), pat: env('ADO_PAT'), transport } };
}

export function scmConfig(transport) {
  const tool = env('SDD_SCM_TOOL', 'ado-repos');
  return tool === 'github'
    ? { tool, config: { owner: env('GITHUB_OWNER'), token: env('GITHUB_TOKEN'), transport } }
    : { tool, config: { org: env('ADO_ORG'), project: env('ADO_PROJECT'), pat: env('ADO_PAT'), transport } };
}

export function printTranscript(transport, C) {
  if (!transport.calls) return;
  console.log(`\n${C.bold(`requests that would be sent (${transport.calls.length})`)}\n`);
  console.log(transport.transcript());
}
