// The ONE comment-delimiter stripper — spec 0014 AC55, AC60, AC61.
//
// WHY THIS FILE EXISTS AT ALL, AND WHY THE PROPERTY LIVES HERE RATHER THAN IN
// pr-address.test.mjs
//
// The algorithm used to be written twice — once in lib/scm.mjs feeding quoted(),
// once in lib/pr-address.mjs feeding parseFrom. The AC55 corpus property was
// asserted through parseFrom, so it could only ever reach ONE of them: reverting
// only the scm.mjs copy to a single pass left 360/360 green while re-opening a
// live bare-opener splice on the GitHub quote-back path — the attacker-facing
// one. Five rounds of the same bug were closed on the module that does not face
// the attacker.
//
// So the property now runs against the EXPORT, and a structural pin below holds
// the "one implementation" half. Neither call site is covered by coincidence:
// both call the function this file tests, or the pin fails.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripComments, stripMarkers, anyDelimiter, onePass } from './comment-text.mjs';

const LIB = dirname(fileURLToPath(import.meta.url));
// Non-defensive on purpose: if either module is gone or renamed, this file fails
// rather than quietly asserting nothing.
const source = (name) => readFileSync(join(LIB, name), 'utf8');

const TAG = 'ml-specs:pr-address';
const survives = (out) => anyDelimiter().test(out);

describe('stripComments is the single shared implementation', () => {
  test('AC60/AC63 — both lib/scm.mjs and lib/pr-address.mjs import theirs, and neither keeps a copy', () => {
    // THE MUTATION THIS PINS. A second copy is not a style problem: it is a
    // second place for the fix to be missing, and the round-6 finding is that a
    // property test cannot tell the difference. Whatever else changes, the count
    // of implementations stays one PER STRIPPER, and both live here.
    //
    // AC63 split the one function into two — `stripComments` for host text a
    // renderer will parse, `stripMarkers` for the tool's own reply body — because
    // the hardening set, correct on the first, CORRUPTED the second (`List<?>` ->
    // `List>`). So each module is pinned to the export its call site needs, and
    // still to importing it rather than writing it out again.
    for (const [name, fn] of [['scm.mjs', 'stripComments'], ['pr-address.mjs', 'stripMarkers']]) {
      const src = source(name);
      assert.match(src, new RegExp(`import \\{[^}]*\\b${fn}\\b[^}]*\\} from '\\./comment-text\\.mjs'`),
        `lib/${name} does not import ${fn} from lib/comment-text.mjs`);
      // No private stripper: nothing in either module may DEFINE a function whose
      // body removes comment delimiters. The pair regex is the signature of one.
      const defines = [...src.matchAll(/(?:const|function)\s+(\w*[Ss]trip\w*)\s*[=(]/g)]
        .map((m) => m[1])
        .filter((n) => n !== 'stripComments' && n !== 'stripMarkers');
      assert.deepEqual(defines, [],
        `lib/${name} declares its own stripper (${defines.join(', ')}); there must be exactly one`);
      // Nor may either module inline the strip without declaring a function: a
      // `.replace(/<!--.../)` anywhere in these two files IS a second copy.
      assert.doesNotMatch(src, /replace\(\s*\/<[!/]/,
        `lib/${name} strips a comment delimiter inline, so it has a second implementation`);
    }

    // And the pure module really is import-free, which is what lets the pure
    // lib/pr-address.mjs use it: reaching into lib/scm.mjs for the same function
    // would drag lib/http.mjs in behind it.
    assert.doesNotMatch(source('comment-text.mjs'), /^\s*import\s/m,
      'lib/comment-text.mjs has grown an import, so lib/pr-address.mjs is no longer pure');
  });
});

describe('no comment delimiter survives', () => {
  test('AC55/AC61 — the property, over an exhaustive corpus, against the export itself', () => {
    // FIVE review rounds found five variants of ONE bug, because each fix was
    // written against the previous round's literal payload:
    //   r2  `<<!--X-->!-- … <!--Y-->-->`  reconstructed a marker from fragments
    //   r4  a dangling `<!--` survived the pair loop by construction
    //   r5  `<-->!--` spliced a NEW opener out of the single-pass neutralisation
    //   r6  the fix existed twice and the property reached one copy
    // A property over a generated corpus catches the CLASS, so the next variant
    // cannot ship green.
    //
    // THE ALPHABET. `< ! - >` build the `--` family; `?`, `/` and the letter `x`
    // build the BOGUS-COMMENT openers AC61 adds — `<!x`, `<?`, `</ ` — and `x`
    // doubles as the non-letter/letter discriminator for `</`, which must strip
    // before a non-letter and NOT before one. Seven symbols to length 7 is
    // 960,799 inputs (~150ms against the export; the old shape ran through
    // parseFrom and JSON.stringify, which is what made depth the binding cost).
    // Length 7 is kept because the historical splice payloads `<-->!--` and
    // `----!>>` are exactly seven characters — a shallower walk would stop
    // generating them and the guard below would be the only thing left holding
    // the splice case.
    const alphabet = ['<', '!', '-', '>', '?', '/', 'x'];
    const survivors = [];
    const walk = (prefix, depth) => {
      if (prefix && survives(stripComments(`k ${prefix}`))) {
        survivors.push({ in: prefix, out: stripComments(`k ${prefix}`) });
      }
      if (depth === 0 || survivors.length) return;
      for (const ch of alphabet) walk(prefix + ch, depth - 1);
    };
    walk('', 7);
    assert.deepEqual(survivors, [],
      `a comment delimiter survived the stripper: ${JSON.stringify(survivors[0])}`);
  });

  test('AC55 — the corpus really does contain inputs that defeat a single pass', () => {
    // NON-VACUITY. Without this, a stripper that returned '' would pass the
    // property above and prove nothing.
    //
    // `onePass` is IMPORTED from the module under test, built from the very same
    // PAIR and RESIDUAL constants the real stripper uses. It used to be a local
    // copy of those regexes, which made this a claim about a MODEL of the code
    // rather than about the code — the same duplication mistake, one level down.
    // The last three are AC61's forms reached the r5 way — the neutralisation
    // splicing its OWN neighbours into a fresh bogus opener:
    //   `<-->!x`  -- delete the `-->` at index 1 -->  `<` + `!x`  ==  `<!x`
    for (const payload of ['<-->!--', '----!>>', '<<!--!--', '<-->!x', '<-->?x', '<-->/ ']) {
      assert.ok(survives(onePass(payload)),
        `${payload} no longer defeats a single pass — the corpus has stopped testing the splice`);
      assert.ok(!survives(stripComments(`ok ${payload}`)),
        `${payload} survived the real stripper`);
    }
    // The corpus is exhaustive over the alphabet to length 7, so these are
    // MEMBERS of it rather than spot checks — the property above really does walk
    // over them.
    for (const payload of ['<-->!--', '----!>>', '<-->!x', '<-->?x']) {
      assert.ok(payload.length <= 7, `${payload} is longer than the corpus walk`);
      assert.ok([...payload].every((c) => '<!->?/x'.includes(c)),
        `${payload} is no longer spelled from the corpus alphabet`);
    }
  });

  test('AC55 — the r2 reconstruction and the r4 dangling opener, at the export', () => {
    // Kept as named regressions beside the property: when one of them fires, the
    // message says which round came back.
    const r2 = `Renamed in a1b2c3d. <<!--X-->!-- ${TAG} 99 T <!--Y-->-->`;
    assert.equal(r2.replace(/<!--[\s\S]*?-->/g, '').trim(), `Renamed in a1b2c3d. <!-- ${TAG} 99 T -->`,
      'the payload no longer reconstructs a marker in one pass, so this proves nothing');
    assert.ok(!stripComments(r2).includes(TAG), 'a reconstructed marker survived');

    const r4 = 'Fixed it.\n<!-- dangling';
    let pairsOnly = r4;
    for (;;) {
      const next = pairsOnly.replace(/<!--[\s\S]*?-->/g, '');
      if (next === pairsOnly) break;
      pairsOnly = next;
    }
    assert.equal(pairsOnly, r4,
      'a dangling opener is no longer a fixed point of the pair loop, so this proves nothing');
    assert.equal(stripComments(r4), 'Fixed it.\n dangling');
  });
});

describe('AC61 — every opener a tokenizer recognises, not just the -- family', () => {
  test('a bogus-comment opener is removed, whatever form it takes', () => {
    // HTML enters BOGUS COMMENT STATE on `<!` followed by anything that is not
    // `--`, on `<?`, and on `</` before a non-letter. Each swallows what follows
    // exactly as a bare `<!--` does — so the tool's own reply and its marker go
    // invisible while the raw body still carries the marker, and the next run
    // skips that comment forever. The sixth security review verified
    //   "> <!x nothing to see here\n\nfixed it\n\n<!-- ml-specs:pr-address 55 T1 -->"
    // reaching the wire, and returned INCONCLUSIVE rather than clean, because
    // whether a given host's sanitiser drops the rest is not knowable from this
    // repo. Stripping the forms makes the question moot instead of unanswered.
    for (const [body, expected] of [
      ['fixed <!x nothing to see here', 'fixed x nothing to see here'],
      ['fixed <![CDATA[ hidden ]]>', 'fixed [CDATA[ hidden ]]>'],
      // `?>` is not a delimiter — a bogus comment ends at the first `>`, so the
      // opener is the whole of what has to go.
      ['fixed <?php echo 1; ?>', 'fixed php echo 1; ?>'],
      ['fixed </ hidden', 'fixed  hidden'],
      ['fixed <!DOCTYPE html>', 'fixed DOCTYPE html>'],
      ['fixed <!', 'fixed '],
      ['fixed <?', 'fixed '],
    ]) {
      const out = stripComments(body);
      assert.equal(out, expected, `${JSON.stringify(body)} was not neutralised`);
      assert.ok(!survives(out), `a delimiter survived ${JSON.stringify(body)}: ${JSON.stringify(out)}`);
    }
  });

  test('an ordinary end tag is NOT a comment opener, and is left alone', () => {
    // `</` before a LETTER is an end tag, not a bogus comment. Stripping it would
    // silently rewrite a reviewer's markup in the quoted text, which is a
    // different kind of lying about what they wrote.
    for (const body of ['see <div>x</div>', 'a < b and c > d', 'path a/b/c', 'is it? yes']) {
      assert.equal(stripComments(body), body, `${JSON.stringify(body)} was rewritten`);
    }
  });

  test('a marker cannot be smuggled behind a bogus opener either', () => {
    // The whole point of the set: whichever opener hides the rest of the body, the
    // marker behind it is gone too.
    for (const opener of ['<!x', '<![CDATA[', '<?php', '</ ']) {
      const out = stripComments(`ok ${opener} <!-- ${TAG} 99 T -->`);
      assert.ok(!out.includes(TAG), `a marker survived behind ${opener}: ${JSON.stringify(out)}`);
      assert.ok(!survives(out), `a delimiter survived behind ${opener}: ${JSON.stringify(out)}`);
    }
  });
});

describe('AC63 — stripMarkers is the narrower stripper, for the tool\'s OWN reply body', () => {
  test('ordinary prose the operator wrote comes back UNCHANGED', () => {
    // THE REGRESSION THIS CLOSES, and it shipped: AC61 extended the hardening set
    // to every tokenizer opener — right for host text a renderer will parse — and
    // parseFrom ran that same set over the body the OPERATOR wrote. `<?` and `<!`
    // are ordinary characters in a code answer, so the tool corrupted its own
    // reply and posted the result to the reviewer under its own account:
    //   List<?>            -> List>
    //   Map<?,?>           -> Map,?>
    //   <?xml version="1.0"?> -> xml version="1.0"?>
    // Verified by execution against the shipped stripComments, below, so this is a
    // real difference rather than a hypothetical one.
    for (const body of [
      'Renamed to List<?> in a1b2c3d.',
      'The signature is now Map<?,?>, per your note.',
      'The fixture is <?xml version="1.0"?> and the parser reads it verbatim.',
      'See <div>x</div> and a < b and c > d.',
      'Deleted the </ stray in the template.',
      'Use <![CDATA[ ... ]]> for the payload.',
    ]) {
      assert.equal(stripMarkers(body), body, `stripMarkers rewrote the operator's own prose`);
    }

    // NON-VACUITY: the hardening set really does mangle each of these, so the
    // assertions above are about a difference between the two functions.
    for (const [body, mangled] of [
      ['List<?>', 'List>'],
      ['Map<?,?>', 'Map,?>'],
      ['<?xml version="1.0"?>', 'xml version="1.0"?>'],
    ]) {
      assert.equal(stripComments(body), mangled,
        `stripComments no longer mangles ${JSON.stringify(body)}, so the split proves nothing`);
    }
  });

  test('no foreign marker survives it — the one invariant this call site needs', () => {
    // A marker is an HTML comment carrying the tag, so a body with no `<!--` and
    // no `-->` left in it cannot carry one, whatever else it contains.
    for (const body of [
      `Renamed in a1b2c3d. <!-- ${TAG} 99 T -->`,
      `<!-- a -->done\n<!--\n${TAG} 99 T\n-->`,
      // r2: one non-greedy pass RECONSTRUCTS the marker out of fragments.
      `Renamed. <<!--X-->!-- ${TAG} 99 T <!--Y-->-->`,
      // r4: a dangling opener is a fixed point of the PAIR loop by construction.
      `Fixed it.\n<!-- ${TAG} 99 T`,
      // r5: the neutralisation splicing its own neighbours into a fresh opener.
      `ok <-->!-- ${TAG} 99 T ---->>`,
    ]) {
      const out = stripMarkers(body);
      // A WELL-FORMED marker is what alreadyAnswered() reads, and it is spelled
      // with the delimiters — a bare mention of the tag in prose is not one
      // (AC56), which is why this counts markers rather than tags.
      assert.doesNotMatch(out, /<!--\s*ml-specs:pr-address\b[\s\S]*?-->/,
        `a marker survived ${JSON.stringify(body)}: ${JSON.stringify(out)}`);
      assert.ok(!out.includes('<!--'), `an opener survived ${JSON.stringify(body)}: ${JSON.stringify(out)}`);
      assert.ok(!out.includes('-->'), `a closer survived ${JSON.stringify(body)}: ${JSON.stringify(out)}`);
    }
  });

  test('a fixed point over the exhaustive corpus, the same property one class down', () => {
    // The AC55 corpus, against stripMarkers' own — narrower — invariant: no marker
    // delimiter survives, from ANY string over the alphabet. The `<-->!--` splice
    // is why this needs a loop rather than one pass, exactly as it does above.
    const alphabet = ['<', '!', '-', '>', '?', '/', 'x'];
    const survivors = [];
    const walk = (prefix, depth) => {
      if (prefix) {
        const out = stripMarkers(`k ${prefix}`);
        if (out.includes('<!--') || out.includes('-->')) survivors.push({ in: prefix, out });
      }
      if (depth === 0 || survivors.length) return;
      for (const ch of alphabet) walk(prefix + ch, depth - 1);
    };
    walk('', 7);
    assert.deepEqual(survivors, [],
      `a marker delimiter survived stripMarkers: ${JSON.stringify(survivors[0])}`);

    // Non-vacuity: a single pass does NOT hold the property, so the loop is load-bearing.
    const once = (t) => t.replace(/<!--[\s\S]*?-->/g, '').replace(/<!--|-->/g, '');
    assert.ok(once('<-->!--').includes('<!--'),
      'a single pass no longer splices a fresh opener, so this guard proves nothing');
  });
});

describe('the test-facing exports stay test-facing', () => {
  test('nothing in production imports anyDelimiter or onePass', () => {
    // comment-text.mjs exports two helpers ONLY so this file cannot re-declare the
    // production regexes — the mistake one level down from the duplication AC60
    // exists to kill. That is a deliberate house-style call, so it is pinned
    // rather than left as a comment: if either helper acquires a production
    // caller, the justification for exporting it has evaporated and this fails.
    const root = dirname(dirname(fileURLToPath(import.meta.url)));   // ml-specs/scripts
    const offenders = [];
    const walk = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, e.name);
        if (e.isDirectory()) { walk(full); continue; }
        if (!e.name.endsWith('.mjs') || e.name.endsWith('.test.mjs')) continue;
        if (full.endsWith(join('lib', 'comment-text.mjs'))) continue;
        if (/\b(anyDelimiter|onePass)\b/.test(readFileSync(full, 'utf8'))) offenders.push(full);
      }
    };
    walk(root);
    assert.deepEqual(offenders, [],
      `a production module now uses a test-facing export: ${offenders.join(', ')}`);
  });
});
