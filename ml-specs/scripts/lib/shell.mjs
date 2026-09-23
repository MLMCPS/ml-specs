// The files a shell command says, outright, that it is going to write.
//
// The scope guard hooks the four write tools, so a `Bash` call walks straight past it: one
// `echo … > src/other/thing.ts` writes anywhere in the tree with the guard watching a different
// door. Closing that means reading the command, because a Bash payload has no `file_path` field.
//
// WHAT THIS CLAIMS, and it is deliberately small: redirections (`>`, `>>`) and `tee`. That is one
// concept — send this command's output to that file — with an unambiguous target position, so a
// match is a fact rather than a guess.
//
// WHAT IT DOES NOT CLAIM: everything else a shell can do. `cp`, `mv`, `sed -i`, `dd`, a python
// one-liner, a Makefile. Covering those means one argument grammar per utility and a new false
// block per mistake — and a guard that refuses a legitimate `cp` gets switched off, after which
// it catches nothing at all, including the redirect. The boundary is stated here and in the
// refusal so that nobody reads the silence as coverage.
//
// A target the text does not determine — `> "$out"`, `> $(mktemp)`, a glob — yields nothing,
// which ALLOWS. Blocking on a string we cannot read is the false-block direction.

/** Fd duplication (`2>&1`), not a file. */
const DUP = /^&/;

/** A token whose value is not knowable from the text: a variable, a substitution, a glob. */
const UNRESOLVABLE = /[$`*?[\]]/;

/** Devices and process substitution are not repository files. */
const NOT_A_FILE = /^\/dev\//;

const COMMAND_START = /[;&|(\n]$/;

/**
 * Read one shell word starting at `i`, honouring quotes.
 * `resolvable` is false when the word spans something whose value the text does not determine.
 */
function readWord(s, i) {
  while (i < s.length && (s[i] === ' ' || s[i] === '\t')) i += 1;
  let out = '';
  let resolvable = true;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === ';' || c === '|' || c === '&' || c === ')' || c === '<' || c === '>') break;
    if (c === '\\') {
      out += s[i + 1] ?? '';
      i += 2;
      continue;
    }
    if (c === "'" || c === '"') {
      const quote = c;
      i += 1;
      while (i < s.length && s[i] !== quote) {
        if (quote === '"' && s[i] === '\\') {
          out += s[i + 1] ?? '';
          i += 2;
          continue;
        }
        if (quote === '"' && (s[i] === '$' || s[i] === '`')) resolvable = false;
        out += s[i];
        i += 1;
      }
      i += 1;
      continue;
    }
    if (UNRESOLVABLE.test(c)) resolvable = false;
    out += c;
    i += 1;
  }
  return { end: i, word: out, resolvable };
}

/**
 * Skip a heredoc body, which is DATA rather than shell.
 *
 * Without this, `cat > page.html <<'EOF'` followed by markup reports every `>` in the body as a
 * redirect — a fistful of invented targets from one legitimate write, which is precisely how a
 * guard earns a reputation for being wrong and gets removed.
 */
function skipHeredoc(s, i) {
  let dash = false;
  if (s[i] === '-') {
    dash = true;
    i += 1;
  }
  const { end, word } = readWord(s, i);
  if (!word) return end;
  const lineStart = s.indexOf('\n', end);
  if (lineStart === -1) return s.length;
  for (let at = lineStart + 1; at <= s.length;) {
    const next = s.indexOf('\n', at);
    const line = s.slice(at, next === -1 ? s.length : next);
    if ((dash ? line.replace(/^\t+/, '') : line) === word) return next === -1 ? s.length : next;
    if (next === -1) break;
    at = next + 1;
  }
  return s.length;
}

/**
 * Paths a shell command redirects into, or tees to.
 *
 * @returns {string[]} only what the text determines; everything else — including everything this
 * does not parse — is absent, and absent means allowed.
 */
export function shellWriteTargets(command) {
  if (typeof command !== 'string' || !command) return [];
  const targets = [];
  let i = 0;
  let prev = '\n'; // the start of the string is a command position

  while (i < command.length) {
    const c = command[i];

    if (c === '\\') {
      i += 2;
      prev = ' ';
      continue;
    }

    if (c === "'" || c === '"') {
      const { end } = readWord(command, i);
      i = end;
      prev = 'w';
      continue;
    }

    if (c === '#' && COMMAND_START.test(prev)) {
      const nl = command.indexOf('\n', i);
      i = nl === -1 ? command.length : nl;
      continue;
    }

    if (c === '<') {
      // `<<<` is a here-string and `<` a plain read; neither writes. `<<` opens a heredoc whose
      // body is data, and reading shell out of it is how false targets appear.
      if (command.startsWith('<<<', i)) i += 3;
      else if (command.startsWith('<<', i)) i = skipHeredoc(command, i + 2);
      else i += 1;
      prev = ' ';
      continue;
    }

    if (c === '>') {
      let at = i + 1;
      if (command[at] === '>') at += 1;
      if (DUP.test(command.slice(at))) {
        i = at + 1;
        prev = ' ';
        continue;
      }
      const { end, word, resolvable } = readWord(command, at);
      if (word && resolvable) targets.push(word);
      i = Math.max(end, at);
      prev = ' ';
      continue;
    }

    if (COMMAND_START.test(prev) || prev === ' ' || prev === '\t') {
      const { end, word } = readWord(command, i);
      // `tee` writes its arguments — but only at a command position. `echo tee` names no file.
      if (word === 'tee' && COMMAND_START.test(prev)) {
        let at = end;
        for (;;) {
          const arg = readWord(command, at);
          if (!arg.word || arg.end === at) break;
          at = arg.end;
          if (arg.word.startsWith('-')) continue;
          if (arg.resolvable) targets.push(arg.word);
        }
        i = at;
        prev = ' ';
        continue;
      }
      if (end > i) {
        i = end;
        prev = word ? 'w' : prev;
        continue;
      }
    }

    prev = c;
    i += 1;
  }

  return [...new Set(targets.filter((t) => !NOT_A_FILE.test(t)))];
}
