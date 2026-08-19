import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const agents = await readFile(new URL('../../AGENTS.md', import.meta.url), 'utf8');
const certification = await readFile(
  new URL('../../docs/gameplay-certification-map.md', import.meta.url),
  'utf8',
);

test('local rules cannot weaken Golden Rules and require both non-trivial workflows', () => {
  assert.match(agents, /may never weaken, negate, bypass, or\ncontradict them/u);
  assert.match(agents, /every non-trivial change, invoke both `codeplan` and `center-audit`/u);
  assert.doesNotMatch(agents, /Do not invoke planning/u);
});

test('accepted lower-layer capability stays frozen until real reopening evidence exists', () => {
  assert.match(agents, /Once a gameplay capability has passed real physical acceptance, freeze/u);
  assert.match(agents, /source inside its owning contract changed/u);
  assert.match(agents, /new physical runtime evidence directly contradicts the prior acceptance/u);
  assert.match(agents, /different noun,\nquantity, caller, prompt form/u);
  assert.match(agents, /traversal does not reopen or recertify the lower layer/u);
});

test('certification map is selective and cannot silently rerun bootstrap or smelting', () => {
  assert.match(certification, /This map is a toolbox, not a checklist/u);
  assert.match(certification, /Do not rerun or re-certify collection, crafting, furnace access, smelting/u);
  assert.match(certification, /Full-baseline only/u);
  assert.match(certification, /Do not select this station merely to prepare for or re-prove a higher-level change/u);
  assert.match(certification, /full clean-room survival progression campaign/u);
});
