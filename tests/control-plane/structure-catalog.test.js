import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createStructureBlueprint,
  createStructureOrder,
  describeStructureCatalog,
  STRUCTURE_CATALOG,
  STRUCTURE_NAMES,
  validateStructureBlueprint,
} from '../../src/agent/runtime/jobs/structure-catalog.js';
import { normalizeWorkOrder } from '../../src/agent/runtime/work-order.js';

test('Given every catalog structure, each blueprint can hold itself up in its own placement order', () => {
  assert.ok(STRUCTURE_NAMES.length >= 4, 'the catalog should offer real buildings, not one example');
  for (const name of STRUCTURE_NAMES) {
    const blueprint = createStructureBlueprint(name, 'cobblestone');
    assert.deepEqual(
      validateStructureBlueprint(blueprint),
      [],
      `${name} is not buildable in the order it plans to place its cells`,
    );
    assert.ok(blueprint.cells.length > 0, `${name} has no cells`);
    // Every structure must reach the world through the same audited contract
    // the rest of the Builder uses. A blueprint the contract rejects is a
    // building nobody can ask for.
    const order = normalizeWorkOrder(createStructureOrder({
      name,
      x: 100,
      y: 64,
      z: -20,
      material: 'cobblestone',
      requester: 'Gabriel',
    }));
    assert.equal(order.blueprint.cells.length, blueprint.cells.length);
    assert.equal(order.quota, blueprint.cells.length);
    assert.equal(order.source, 'player');
  }
});

test('Given a staging mistake, validation names the cell that has nothing to hold it', () => {
  // A ladder scheduled before the wall it hangs on passes the world audit,
  // which accepts any planned neighbour, and then fails during placement.
  const problems = validateStructureBlueprint({
    cells: [
      { x: 0, y: 0, z: 0, material: 'cobblestone', stage: 0 },
      { x: 1, y: 1, z: 0, material: 'ladder', stage: 0 },
      { x: 1, y: 0, z: 0, material: 'cobblestone', stage: 1 },
    ],
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /ladder at 1,1,0/);
  assert.match(problems[0], /no support placed by its own stage/);
});

test('Given a duplicate cell, validation refuses the blueprint rather than placing twice', () => {
  const problems = validateStructureBlueprint({
    cells: [
      { x: 0, y: 0, z: 0, material: 'cobblestone', stage: 0 },
      { x: 0, y: 0, z: 0, material: 'oak_planks', stage: 1 },
    ],
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /duplicate cell at 0:0:0/);
});

test('Given an unknown structure or unusable material, the catalog refuses before any work order exists', () => {
  assert.throws(() => createStructureBlueprint('castle', 'cobblestone'), /Unknown structure 'castle'/);
  assert.throws(() => createStructureBlueprint('house', '../../etc/passwd'), /canonical block name/);
  assert.throws(() => createStructureBlueprint('house', ''), /canonical block name/);
  // Names people actually type should still resolve.
  assert.ok(createStructureBlueprint('Lookout Tower', 'stone'));
  assert.ok(createStructureBlueprint('animal-pen', 'stone'));
});

test('Given the catalog description, every structure is named with its footprint for language routing', () => {
  const description = describeStructureCatalog();
  for (const name of STRUCTURE_NAMES) {
    assert.ok(description.includes(name), `${name} is missing from the routing description`);
    assert.ok(
      description.includes(STRUCTURE_CATALOG[name].footprint),
      `${name} does not tell the player how much room it needs`,
    );
  }
});

test('Given a finished structure, it provides the functions its name promises', () => {
  const promised = {
    lookout_tower: ['climbable_access', 'elevated_platform'],
    storage_room: ['usable_access', 'weather_cover', 'bulk_storage'],
    animal_pen: ['containment', 'usable_access'],
    house: ['usable_access', 'weather_cover', 'crafting', 'smelting', 'storage'],
  };
  for (const [name, functions] of Object.entries(promised)) {
    const blueprint = createStructureBlueprint(name, 'cobblestone');
    for (const provided of functions) {
      assert.ok(
        blueprint.functions.includes(provided),
        `${name} claims to be a ${name.replace('_', ' ')} but does not provide ${provided}`,
      );
    }
  }
});
