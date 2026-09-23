// The files a shell command says, outright, that it is going to write.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shellWriteTargets as targets } from './shell.mjs';

test('a redirect names its target, however it is spelled', () => {
  assert.deepEqual(targets('echo hi > src/a.ts'), ['src/a.ts']);
  assert.deepEqual(targets('echo hi >> src/a.ts'), ['src/a.ts']);
  assert.deepEqual(targets('echo hi>src/a.ts'), ['src/a.ts']);
  assert.deepEqual(targets('echo hi > "my file.ts"'), ['my file.ts']);
  assert.deepEqual(targets('echo a > src/a.ts; echo b > src/b.ts'), ['src/a.ts', 'src/b.ts']);
  assert.deepEqual(targets('grep -r foo . > out.txt && echo ok'), ['out.txt']);
});

test('tee writes its arguments, but only at a command position', () => {
  assert.deepEqual(targets('npm test 2>&1 | tee build.log'), ['build.log']);
  assert.deepEqual(targets('ls | tee -a one.log two.log'), ['one.log', 'two.log']);
  // `echo tee is nice` names no file. Treating every occurrence of the word as a writer would
  // block sentences.
  assert.deepEqual(targets('echo tee is nice'), []);
});

test('SENSOR: a heredoc body is data, not shell', () => {
  // Without this, one legitimate `cat > page.html <<EOF` yields a target for every `>` in the
  // markup that follows — a fistful of invented paths, which is how a guard earns a reputation
  // for being wrong and gets removed.
  const cmd = 'cat > page.html <<"EOF"\n<div>x > src/other/y.ts</div>\n<p>a > b</p>\nEOF\necho done';
  assert.deepEqual(targets(cmd), ['page.html']);

  // `<<-` strips leading tabs from the terminator.
  assert.deepEqual(targets('cat <<-EOF\n\tstuff > nope.ts\n\tEOF'), []);
});

test('a > inside a quoted string is not a redirect', () => {
  assert.deepEqual(targets('echo "a > b.ts"'), []);
  assert.deepEqual(targets("echo 'a > b.ts'"), []);
});

test('fd duplication and devices are not files', () => {
  assert.deepEqual(targets('npm test 2>&1 | head'), []);
  assert.deepEqual(targets('npm test > /dev/null 2>&1'), []);
});

test('a target the text does not determine yields nothing, which allows', () => {
  // Blocking on a string nobody can read is the false-block direction, and the whole boundary of
  // this file is that absent means allowed.
  assert.deepEqual(targets('echo hi > "$out"'), []);
  assert.deepEqual(targets('echo hi > $(mktemp)'), []);
  assert.deepEqual(targets('echo a > out*.ts'), []);
});

test('a comment at a command position is not a command', () => {
  assert.deepEqual(targets('# echo x > commented.ts'), []);
});

test('the stated boundary: it does not parse cp, mv, sed or dd', () => {
  // Not an oversight — covering those means one argument grammar per utility and a new false
  // block per mistake. The limit is asserted so that nobody later reads the silence as coverage.
  for (const cmd of ['cp a.ts b.ts', 'mv a.ts b.ts', 'sed -i s/a/b/ a.ts', 'dd of=a.ts if=/dev/zero']) {
    assert.deepEqual(targets(cmd), [], `${cmd} is outside what this claims`);
  }
});

test('nothing in, nothing out', () => {
  for (const v of ['', null, undefined, 42, {}]) assert.deepEqual(targets(v), []);
});
