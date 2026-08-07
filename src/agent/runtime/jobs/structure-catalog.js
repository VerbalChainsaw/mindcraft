import { createWorkOrder } from '../work-order.js';

// Named structures a person can ask for by name.
//
// `createConstructionBlueprint` already covers the primitive shapes -- a
// platform, a wall, a column -- but nobody asks a bot for a platform. They ask
// for a tower, a pen for the animals, somewhere to put things. Each entry here
// is a real building assembled from cells the existing Builder can already
// place and verify, so nothing new is needed on the execution side.
//
// Two rules govern every blueprint, and `validateStructureBlueprint` enforces
// both mechanically because getting them wrong produces a build that audits
// fine and then fails in the world:
//
//   1. Support. A cell above ground level must have a neighbour -- below or
//      beside it -- that is either already in the world or planned.
//   2. Stage order. That supporting neighbour must be placed no later than the
//      cell that leans on it. The blueprint audit accepts a planned neighbour
//      regardless of stage, so a ladder scheduled before its wall passes the
//      audit and then has nothing to attach to.
//
// Accessory materials are fixed rather than chosen: a chest is a chest. Only
// the structural material is the caller's to pick.

const MAX_STRUCTURE_CELLS = 2048;
const CANONICAL_NAME = /^[a-z0-9_]{1,64}$/;

function structuralMaterial(value) {
  const material = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (!CANONICAL_NAME.test(material)) {
    throw new TypeError('Structure material must be a canonical block name.');
  }
  return material;
}

/**
 * A cell builder that records placement order as it goes. Stages are assigned
 * by call order rather than by hand, which is the whole point: hand-numbered
 * stages are exactly what drifts out of step with the support chain.
 */
function plan() {
  const cells = [];
  let stage = 0;
  return {
    course(build) {
      const before = cells.length;
      build((x, y, z, material, cellFunction) => {
        cells.push({ x, y, z, material, stage, function: cellFunction });
      });
      if (cells.length > before) stage += 1;
    },
    cells: () => cells,
  };
}

/**
 * Reject a blueprint whose own cells cannot hold it up in the order it plans
 * to place them. Exported so a new structure is proven before it reaches a
 * world, not after a bot has half-built it.
 */
export function validateStructureBlueprint(blueprint, { canSupportMaterial = () => true } = {}) {
  const problems = [];
  const cells = blueprint?.cells || [];
  if (!cells.length) problems.push('blueprint has no cells');
  if (cells.length > MAX_STRUCTURE_CELLS) {
    problems.push(`blueprint has ${cells.length} cells, above the ${MAX_STRUCTURE_CELLS} safe limit`);
  }
  // Earliest stage at which each position becomes solid ground for a neighbour.
  const placedAt = new Map();
  const cellAt = new Map();
  for (const cell of cells) {
    const key = `${cell.x}:${cell.y}:${cell.z}`;
    if (placedAt.has(key)) problems.push(`duplicate cell at ${key}`);
    placedAt.set(key, cell.stage);
    cellAt.set(key, cell);
  }
  for (const cell of cells) {
    if (cell.y === 0) continue;
    const neighbours = [
      [0, -1, 0],
      [1, 0, 0],
      [-1, 0, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];
    const held = neighbours.some(([dx, dy, dz]) => {
      const support = cellAt.get(`${cell.x + dx}:${cell.y + dy}:${cell.z + dz}`);
      return support
        && canSupportMaterial(support.material)
        && support.stage <= cell.stage;
    });
    if (!held) {
      problems.push(
        `cell ${cell.material} at ${cell.x},${cell.y},${cell.z} (stage ${cell.stage}) has no support placed by its own stage`,
      );
    }
  }
  const reservationOwners = new Map();
  for (const fixture of blueprint?.fixtures || []) {
    const anchorKey = `${fixture.anchor?.x}:${fixture.anchor?.y}:${fixture.anchor?.z}`;
    const anchorCell = cellAt.get(anchorKey);
    if (
      !anchorCell
      || anchorCell.fixtureId !== fixture.id
      || anchorCell.material !== fixture.material
      || anchorCell.facing !== fixture.facing
    ) {
      problems.push(`fixture ${fixture.id} has no matching anchor cell`);
      continue;
    }
    for (const offset of fixture.occupiedOffsets || []) {
      const key = `${fixture.anchor.x + offset.x}:${fixture.anchor.y + offset.y}:${fixture.anchor.z + offset.z}`;
      const prior = reservationOwners.get(key);
      if (prior && prior !== fixture.id) problems.push(`fixtures ${prior} and ${fixture.id} overlap at ${key}`);
      reservationOwners.set(key, fixture.id);
      if (key !== anchorKey && cellAt.has(key)) {
        problems.push(`fixture ${fixture.id} companion cell collides with a planned block at ${key}`);
      }
    }
    for (const offset of fixture.supportOffsets || []) {
      const key = `${fixture.anchor.x + offset.x}:${fixture.anchor.y + offset.y}:${fixture.anchor.z + offset.z}`;
      const support = cellAt.get(key);
      if (!support || !canSupportMaterial(support.material)) {
        problems.push(`fixture ${fixture.id} lacks planned support at ${key}`);
      }
    }
  }

  const restFixtures = (blueprint?.fixtures || []).filter(fixture => fixture.function === 'rest');
  if (restFixtures.length > 0) {
    const functions = new Set(cells.map(cell => cell.function));
    for (const required of ['enclosure', 'weather_cover']) {
      if (!functions.has(required)) problems.push(`habitable structure lacks ${required}`);
    }
    if (!(blueprint.fixtures || []).some(fixture => fixture.function === 'access')) {
      problems.push('habitable structure lacks a logical access fixture');
    }
    const foundations = cells.filter(cell => cell.function === 'foundation');
    if (foundations.length === 0) {
      problems.push('habitable structure lacks a foundation');
      return problems;
    }
    for (const floor of foundations) {
      const covered = cells.some(cell => (
        cell.function === 'weather_cover'
        && cell.x === floor.x
        && cell.z === floor.z
        && cell.y > floor.y
      ));
      if (!covered) problems.push(`habitable floor column ${floor.x},${floor.z} is open to the sky`);
    }
    const minX = Math.min(...foundations.map(cell => cell.x));
    const maxX = Math.max(...foundations.map(cell => cell.x));
    const minZ = Math.min(...foundations.map(cell => cell.z));
    const maxZ = Math.max(...foundations.map(cell => cell.z));
    const access = (blueprint.fixtures || []).find(fixture => fixture.function === 'access');
    if (
      !access
      || ![
        access.anchor.x === minX,
        access.anchor.x === maxX,
        access.anchor.z === minZ,
        access.anchor.z === maxZ,
      ].some(Boolean)
    ) problems.push('habitable access fixture is not on the enclosure perimeter');
  }
  return problems;
}

function sealed(blueprint) {
  const problems = validateStructureBlueprint(blueprint);
  if (problems.length) {
    throw new TypeError(`Structure blueprint is not buildable: ${problems[0]}.`);
  }
  return Object.freeze({
    ...blueprint,
    cells: Object.freeze(blueprint.cells.map(cell => Object.freeze(cell))),
  });
}

const perimeter = (width, depth) => {
  const positions = [];
  for (let x = 0; x < width; x += 1) {
    for (let z = 0; z < depth; z += 1) {
      if (x === 0 || x === width - 1 || z === 0 || z === depth - 1) positions.push([x, z]);
    }
  }
  return positions;
};

/**
 * A lit landmark you can climb. The column goes up first so the ladder and the
 * platform both have something to hold onto, and the last rung is placed after
 * the parapet so the climber can actually step out at the top.
 */
function lookoutTower(material) {
  const block = structuralMaterial(material);
  const build = plan();
  build.course(add => {
    for (let y = 0; y <= 5; y += 1) add(1, y, 1, block, 'column');
  });
  build.course(add => {
    for (const [x, z] of [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2]]) {
      // (1,0) is left open so the ladder can pass through the platform.
      if (x === 1 && z === 0) continue;
      add(x, 6, z, block, 'lookout_floor');
    }
  });
  build.course(add => {
    for (let y = 1; y <= 6; y += 1) add(1, y, 0, 'ladder', 'access');
  });
  build.course(add => {
    for (const [x, z] of perimeter(3, 3)) {
      if (x === 1 && z === 0) continue;
      add(x, 7, z, block, 'parapet');
    }
  });
  build.course(add => add(1, 7, 0, 'ladder', 'access'));
  build.course(add => {
    add(0, 8, 0, 'torch', 'beacon_light');
    add(2, 8, 2, 'torch', 'beacon_light');
  });
  return sealed({
    id: `lookout_tower_${block}`.slice(0, 64),
    version: 1,
    width: 3,
    depth: 3,
    height: 9,
    functions: Object.freeze(['climbable_access', 'elevated_platform', 'fall_guard', 'beacon_light']),
    cells: build.cells(),
  });
}

/** Somewhere to put things: enclosed, lit, doored, and lined with chests. */
function storageRoom(material) {
  const block = structuralMaterial(material);
  const width = 7;
  const depth = 5;
  const doorZ = 2;
  const build = plan();
  build.course(add => {
    for (let x = 0; x < width; x += 1) {
      for (let z = 0; z < depth; z += 1) add(x, 0, z, block, 'foundation');
    }
  });
  for (const y of [1, 2]) {
    build.course(add => {
      for (const [x, z] of perimeter(width, depth)) {
        if (x === 0 && z === doorZ) continue;
        add(x, y, z, block, 'enclosure');
      }
    });
  }
  build.course(add => add(0, 1, doorZ, 'oak_door', 'access'));
  build.course(add => {
    for (let x = 0; x < width; x += 1) {
      for (let z = 0; z < depth; z += 1) add(x, 3, z, block, 'weather_cover');
    }
  });
  build.course(add => {
    for (let x = 1; x <= width - 2; x += 1) add(x, 1, depth - 2, 'chest', 'storage');
    add(1, 2, 1, 'torch', 'interior_light');
    add(width - 2, 2, 1, 'torch', 'interior_light');
  });
  return sealed({
    id: `storage_room_${block}`.slice(0, 64),
    version: 1,
    width,
    depth,
    height: 4,
    entrance: Object.freeze({ x: 0, y: 1, z: doorZ, width: 1, height: 2 }),
    functions: Object.freeze(['enclosure', 'usable_access', 'weather_cover', 'interior_light', 'bulk_storage']),
    cells: build.cells(),
  });
}

/** A fenced paddock with a gate, on a laid ring so uneven ground cannot void it. */
function animalPen(material) {
  const block = structuralMaterial(material);
  const size = 7;
  const gateZ = 3;
  const build = plan();
  build.course(add => {
    for (const [x, z] of perimeter(size, size)) add(x, 0, z, block, 'foundation');
  });
  build.course(add => {
    for (const [x, z] of perimeter(size, size)) {
      if (x === 0 && z === gateZ) continue;
      add(x, 1, z, 'oak_fence', 'containment');
    }
  });
  build.course(add => add(0, 1, gateZ, 'oak_fence_gate', 'access'));
  return sealed({
    id: `animal_pen_${block}`.slice(0, 64),
    version: 1,
    width: size,
    depth: size,
    height: 2,
    entrance: Object.freeze({ x: 0, y: 1, z: gateZ, width: 1, height: 1 }),
    functions: Object.freeze(['containment', 'usable_access']),
    cells: build.cells(),
  });
}

/** A place to actually live: windows, a door, a roof, and the three stations. */
function house(material) {
  const block = structuralMaterial(material);
  const size = 7;
  const doorZ = 3;
  const windows = new Set(['2:0', '4:0', '2:6', '4:6', '6:2', '6:4'].map(String));
  const build = plan();
  build.course(add => {
    for (let x = 0; x < size; x += 1) {
      for (let z = 0; z < size; z += 1) add(x, 0, z, block, 'foundation');
    }
  });
  for (const y of [1, 2, 3]) {
    build.course(add => {
      for (const [x, z] of perimeter(size, size)) {
        if (x === 0 && z === doorZ && y <= 2) continue;
        if (y === 2 && windows.has(`${x}:${z}`)) continue;
        add(x, y, z, block, 'enclosure');
      }
    });
  }
  build.course(add => {
    for (const key of windows) {
      const [x, z] = key.split(':').map(Number);
      add(x, 2, z, 'glass', 'daylight');
    }
    add(0, 1, doorZ, 'oak_door', 'access');
  });
  build.course(add => {
    for (let x = 0; x < size; x += 1) {
      for (let z = 0; z < size; z += 1) add(x, 4, z, block, 'weather_cover');
    }
  });
  build.course(add => {
    add(1, 1, 1, 'crafting_table', 'crafting');
    add(1, 1, 2, 'furnace', 'smelting');
    add(1, 1, 4, 'chest', 'storage');
    add(1, 1, 5, 'chest', 'storage');
    add(5, 3, 1, 'torch', 'interior_light');
    add(5, 3, 5, 'torch', 'interior_light');
  });
  return sealed({
    id: `house_${block}`.slice(0, 64),
    version: 1,
    width: size,
    depth: size,
    height: 5,
    entrance: Object.freeze({ x: 0, y: 1, z: doorZ, width: 1, height: 2 }),
    functions: Object.freeze([
      'enclosure',
      'usable_access',
      'weather_cover',
      'daylight',
      'interior_light',
      'storage',
      'crafting',
      'smelting',
    ]),
    cells: build.cells(),
  });
}

export const STRUCTURE_CATALOG = Object.freeze({
  lookout_tower: Object.freeze({
    build: lookoutTower,
    summary: 'A 3x3 lit watchtower with a ladder, a railed platform, and torches on top.',
    footprint: '3 wide, 3 deep, 9 tall',
  }),
  storage_room: Object.freeze({
    build: storageRoom,
    summary: 'A 7x5 enclosed room with a door, a roof, torches, and a row of five chests.',
    footprint: '7 wide, 5 deep, 4 tall',
  }),
  animal_pen: Object.freeze({
    build: animalPen,
    summary: 'A 7x7 fenced paddock with a gate, laid on a foundation ring so uneven ground cannot void it.',
    footprint: '7 wide, 7 deep, 2 tall',
  }),
  house: Object.freeze({
    build: house,
    summary: 'A 7x7 house with glass windows, a door, a roof, two chests, a crafting table, a furnace, and interior light.',
    footprint: '7 wide, 7 deep, 5 tall',
  }),
});

export const STRUCTURE_NAMES = Object.freeze(Object.keys(STRUCTURE_CATALOG));

/** The one-line menu the model reads when a player names a building. */
export function describeStructureCatalog() {
  return STRUCTURE_NAMES
    .map(name => `${name} (${STRUCTURE_CATALOG[name].footprint}): ${STRUCTURE_CATALOG[name].summary}`)
    .join(' ');
}

export function createStructureBlueprint(name, material) {
  const key = String(name || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const entry = STRUCTURE_CATALOG[key];
  if (!entry) {
    throw new TypeError(`Unknown structure '${name}'. Known structures: ${STRUCTURE_NAMES.join(', ')}.`);
  }
  return entry.build(material);
}

export function createStructureOrder({
  name,
  x,
  y,
  z,
  material = 'cobblestone',
  requester = 'player',
  constraints,
} = {}) {
  const blueprint = createStructureBlueprint(name, material);
  return createWorkOrder({
    role: 'builder',
    kind: 'build',
    source: 'player',
    requester,
    target: {
      name: 'construction_site',
      x,
      y,
      z,
    },
    quota: blueprint.cells.length,
    blueprint,
    constraints,
  });
}
