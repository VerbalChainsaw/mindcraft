// TD-TEXT-001 -- the RuleEngine's boundedText was a copy of the rules.js helper
// whose literal control bytes had been lost, leaving the ASCII class
// [space-hyphen]. It therefore stripped hyphens (never intended) and passed
// NUL/ESC/DEL through (the whole point of the helper).
//
// That is not cosmetic: remove() builds its lookup key with it, and
// normalizeRule() generates ids as `rule-<createdAt>-<sequence>` and default
// names as `<trigger> -> <action>`, both of which contain hyphens.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { RuleEngine } from '../../src/agent/runtime/rule-engine.js';
import { normalizeRule } from '../../src/agent/runtime/rules.js';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'agent', 'runtime');

function engine() {
  const saved = [];
  const store = { load: () => [], save: (rules) => saved.push(rules), lastError: null };
  return { engine: new RuleEngine({ name: 'TestBot' }, { store, now: () => 1_760_000_000_000 }), saved };
}

const VALID_RULE = Object.freeze({ trigger: 'player.approached', action: 'shelter' });

test('Given a rule with a generated id, when it is removed by that id, then it is actually removed', () => {
  // Given
  const { engine: rules } = engine();
  const added = rules.add({ ...VALID_RULE });
  assert.equal(added.accepted, true);
  assert.match(added.id, /-/, 'generated ids contain hyphens; that is what made this fail');

  // When
  const removed = rules.remove(added.id);

  // Then
  assert.deepEqual(removed, { removed: true });
  assert.equal(rules.list().length, 0);
});

test('Given a rule with the default generated name, when it is removed by that name, then it is actually removed', () => {
  // Given -- the default name is `<trigger> -> <action>`, whose arrow has a hyphen
  const { engine: rules } = engine();
  rules.add({ ...VALID_RULE });
  const name = rules.rules[0].name;
  assert.match(name, /->/);

  // When
  const removed = rules.remove(name);

  // Then
  assert.deepEqual(removed, { removed: true });
});

test('Given a hyphenated rule name, when it is normalized, then the hyphen survives', () => {
  // Given / When
  const rule = normalizeRule({ ...VALID_RULE, name: 'guard the iron-pickaxe chest' }, { sequence: 1, now: () => 1 });

  // Then
  assert.equal(rule.name, 'guard the iron-pickaxe chest');
});

test('Given control characters in rule text, when it is normalized, then they are removed', () => {
  // Given -- NUL, ESC and DEL all previously survived normalization
  const NUL = String.fromCharCode(0);
  const ESC = String.fromCharCode(27);
  const DEL = String.fromCharCode(127);
  const BELL = String.fromCharCode(7);

  // When
  const rule = normalizeRule(
    { ...VALID_RULE, name: `a${NUL}b${ESC}c${DEL}d${BELL}e` },
    { sequence: 1, now: () => 1 },
  );

  // Then
  assert.equal(rule.name, 'a b c d e');
  assert.equal([...rule.name].some(c => c.codePointAt(0) < 32 || c.codePointAt(0) === 127), false);
});

test('Given whitespace and overlong text, when it is normalized, then it collapses and truncates', () => {
  // Given / When
  const rule = normalizeRule(
    { ...VALID_RULE, name: `  spaced\tout\nname  ${'x'.repeat(200)}` },
    { sequence: 1, now: () => 1 },
  );

  // Then
  assert.equal(rule.name.startsWith('spaced out name x'), true, 'tabs and newlines collapse to single spaces');
  assert.equal(rule.name.length, 48, 'name is bounded at 48');
});

test('Given empty rule text, when it is normalized, then the generated fallbacks are used', () => {
  // Given / When
  const rule = normalizeRule({ ...VALID_RULE, name: '', id: '' }, { sequence: 7, now: () => 1_760_000_000_000 });

  // Then
  assert.equal(rule.name, 'player.approached -> shelter');
  assert.equal(rule.id, 'rule-1760000000000-7');
});

test('Given an unknown id, when removal is attempted, then nothing is removed', () => {
  // Given
  const { engine: rules } = engine();
  rules.add({ ...VALID_RULE });

  // When / Then -- the repair must not turn removal into a loose match
  assert.deepEqual(rules.remove('no-such-rule'), { removed: false });
  assert.equal(rules.list().length, 1);
});

// The other half of TD-TEXT-001: rules.js encoded a correct control-character
// range as literal binary bytes, which made ordinary source search treat the
// file as binary. Both files must stay readable as text.
// This file is included in the sweep deliberately: writing it reproduced the
// original corruption, because a regex literal typed as an escape reached disk
// as raw bytes. The guard has to cover the guard.
test('Given the rule sources, when they are read as text, then neither contains raw control bytes', () => {
  const targets = [
    path.join(SRC, 'rules.js'),
    path.join(SRC, 'rule-engine.js'),
    fileURLToPath(import.meta.url),
  ];
  for (const file of targets) {
    const text = readFileSync(file, 'utf8');
    const offending = [...text].reduce((found, char, index) => {
      const code = char.codePointAt(0);
      const isAllowedWhitespace = code === 9 || code === 10 || code === 13;
      if ((code < 32 && !isAllowedWhitespace) || code === 127) found.push({ index, code });
      return found;
    }, []);
    assert.deepEqual(
      offending, [],
      `${path.basename(file)} must encode control characters as escapes, not literal bytes`,
    );
  }
});
