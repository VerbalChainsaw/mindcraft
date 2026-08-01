import { createWorkOrder } from '../work-order.js';
import { validateStructureBlueprint } from './structure-catalog.js';

// A parametric design language, so a player can ask for a building nobody wrote
// a function for.
//
// The catalog holds four hand-authored structures. Everything below them is
// already generic: `normalizeBlueprint` accepts any 32x32x32 arrangement of
// cells, `validateStructureBlueprint` proves a design holds itself up, and the
// Builder places and verifies whatever it is handed. The only missing piece was
// something that could produce a NEW arrangement. This is that piece.
//
// The model writes a design, not code. That distinction is the whole safety
// argument: a design is data, it is proven before a single block is placed, and
// a bad one is rejected with the exact reason instead of half-built. Nothing
// here can execute anything.
//
// Syntax is deliberately free of quotes and commas so a design survives the
// command argument parser as one plain string:
//
//   box 0 0 0 5 1 5; shell 0 1 0 5 4 5; put 0 1 2 door; roof 0 5 0 5 5 gable
//
// Operations are applied in order and a later one overwrites an earlier one, so
// `carve` and `put` cut windows and doors into walls that were already planned.

const MAX_STATEMENTS = 32;
const MAX_OPS = 96;
const MAX_CELLS = 2048;
const MAX_EXTENT = 32;
const MAX_STAGE = 16;
const CANONICAL_NAME = /^[a-z0-9_]{1,64}$/;

// Accessories are fixed, matching the catalog's rule that only the structural
// material is the caller's to choose: a chest is a chest.
const ACCESSORIES = Object.freeze({
  door: { material: 'oak_door', function: 'access' },
  glass: { material: 'glass', function: 'daylight' },
  torch: { material: 'torch', function: 'interior_light' },
  chest: { material: 'chest', function: 'storage' },
  ladder: { material: 'ladder', function: 'access' },
  fence: { material: 'oak_fence', function: 'containment' },
  gate: { material: 'oak_fence_gate', function: 'access' },
  crafting: { material: 'crafting_table', function: 'crafting' },
  furnace: { material: 'furnace', function: 'smelting' },
  bed: { material: 'red_bed', function: 'rest' },
});

export const ACCESSORY_NAMES = Object.freeze(Object.keys(ACCESSORIES));

/**
 * The syntax summary the model reads in the command description. A function
 * rather than a constant so it can name the templates, which are declared below
 * it.
 */
export function designLanguageHelp() {
  return [
  'Separate steps with ; and arguments with spaces. No commas or quotes inside the design.',
  'START FROM A TEMPLATE when one fits, then add your own steps after it to make it specific:',
  '@tower 5 12 gives a finished tower, and @tower 5 12; ring 0 12 0 7 7 adds a balcony to it.',
  `Templates, with optional arguments that have sensible defaults: ${describeTemplates()}.`,
  'Coordinates are relative to the build site: x east, y up, z south, all starting at 0.',
  'box X Y Z W H D - solid block of material.',
  'shell X Y Z W H D - four walls only, open top and bottom.',
  'room X Y Z W H D - floor, four walls, and a roof.',
  'slab X Y Z W D - one-block-thick floor or platform.',
  'ring X Y Z W D - one-block-tall rectangular outline.',
  'line X1 Y1 Z1 X2 Y2 Z2 - straight run between two points on one axis.',
  'roof X Y Z W D STYLE - flat, gable, or pyramid; stepped and solid so it supports itself.',
  'carve X Y Z W H D - remove already-planned blocks to cut a doorway, window, or interior.',
  `put X Y Z THING - place one fixture: ${ACCESSORY_NAMES.join(' ')}.`,
  ].join(' ');
}

// Templates are macros, not a second system. `@tower 5 12` expands into ordinary
// operations before anything is validated, so a template and a hand-written
// design are the same language all the way down. That is what lets the model
// treat a template as a starting point -- take a working tower, then append a
// balcony -- instead of choosing between "canned" and "from scratch".
const TEMPLATES = Object.freeze({
  tower: {
    args: ['width', 'height'],
    defaults: [5, 10],
    build: (w, h) => {
      const door = Math.floor(w / 2);
      const light = Math.max(1, w - 2);
      return [
        `box 0 0 0 ${w} 1 ${w}`,
        `shell 0 1 0 ${w} ${h - 1} ${w}`,
        `carve 0 1 ${door} 1 2 1`,
        `put 0 1 ${door} door`,
        `put ${light} ${h - 2} ${light} torch`,
        `roof 0 ${h} 0 ${w} ${w} pyramid`,
      ];
    },
  },
  hut: {
    args: ['width', 'depth'],
    defaults: [5, 5],
    build: (w, d) => {
      const door = Math.floor(d / 2);
      return [
        `box 0 0 0 ${w} 1 ${d}`,
        `shell 0 1 0 ${w} 3 ${d}`,
        `carve 0 1 ${door} 1 2 1`,
        `put 0 1 ${door} door`,
        `put 1 1 1 crafting`,
        `put 1 1 ${Math.max(2, d - 2)} chest`,
        `put ${Math.max(1, w - 2)} 3 ${Math.max(1, d - 2)} torch`,
        `roof 0 4 0 ${w} ${d} gable`,
      ];
    },
  },
  wall: {
    args: ['length', 'height'],
    defaults: [10, 3],
    build: (length, h) => [`box 0 0 0 ${length} ${h} 1`],
  },
  bridge: {
    args: ['length'],
    defaults: [10],
    build: (length) => [
      `box 0 0 0 ${length} 1 3`,
      `line 0 1 0 ${length - 1} 1 0`,
      `line 0 1 2 ${length - 1} 1 2`,
    ],
  },
  platform: {
    args: ['width', 'depth'],
    defaults: [5, 5],
    build: (w, d) => [`slab 0 0 0 ${w} ${d}`],
  },
  pen: {
    args: ['width', 'depth'],
    defaults: [7, 7],
    build: (w, d) => [
      `ring 0 0 0 ${w} ${d}`,
      `ring 0 1 0 ${w} ${d} oak_fence`,
      `put 0 1 ${Math.floor(d / 2)} gate`,
    ],
  },
  pillar: {
    args: ['height'],
    defaults: [6],
    build: (h) => [`box 0 0 0 1 ${h} 1`],
  },
  // Each tread is filled to the ground, because a run of blocks stepping up and
  // along is diagonal to its neighbour and would be a design nothing can place.
  stairs: {
    args: ['height'],
    defaults: [6],
    build: (h) => Array.from({ length: h }, (_, i) => `box ${i} 0 0 1 ${i + 1} 1`),
  },
  room: {
    args: ['width', 'depth', 'height'],
    defaults: [7, 7, 4],
    build: (w, d, h) => {
      const door = Math.floor(d / 2);
      return [
        `room 0 0 0 ${w} ${h} ${d}`,
        `carve 0 1 ${door} 1 2 1`,
        `put 0 1 ${door} door`,
        `put ${Math.max(1, w - 2)} ${h - 2} ${Math.max(1, d - 2)} torch`,
      ];
    },
  },
});

export const TEMPLATE_NAMES = Object.freeze(Object.keys(TEMPLATES));

/** The template menu the model reads, with each one's parameters. */
export function describeTemplates() {
  return TEMPLATE_NAMES
    .map(name => `@${name} ${TEMPLATES[name].args.join(' ')}`)
    .join(', ');
}

/**
 * Replace every `@template a b` statement with the operations it stands for.
 * Templates expand to base operations only, so this runs once and cannot
 * recurse.
 */
function expandTemplates(statements) {
  const expanded = [];
  for (const [index, statement] of statements.entries()) {
    if (!statement.startsWith('@')) {
      expanded.push(statement);
      continue;
    }
    const tokens = statement.slice(1).split(/\s+/);
    const name = String(tokens[0] || '').toLowerCase();
    const template = TEMPLATES[name];
    if (!template) {
      throw new TypeError(
        `Design step ${index + 1} uses unknown template '@${name}'. Available: ${describeTemplates()}.`,
      );
    }
    const values = template.defaults.map((fallback, position) => {
      const raw = tokens[position + 1];
      if (raw === undefined) return fallback;
      const number = Number(raw);
      if (!Number.isInteger(number) || number < 1 || number > MAX_EXTENT) {
        throw new TypeError(
          `Template @${name} ${template.args[position]} must be a whole number between 1 and ${MAX_EXTENT}.`,
        );
      }
      return number;
    });
    expanded.push(...template.build(...values));
  }
  return expanded;
}

function canonicalMaterial(value, label = 'material') {
  const material = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (!CANONICAL_NAME.test(material)) {
    throw new TypeError(`Design ${label} must be a canonical block name.`);
  }
  return material;
}

function integer(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number)) throw new TypeError(`Design ${label} must be a whole number.`);
  return number;
}

function extent(value, label) {
  const number = integer(value, label);
  if (number < 1 || number > MAX_EXTENT) {
    throw new TypeError(`Design ${label} must be between 1 and ${MAX_EXTENT}.`);
  }
  return number;
}

function coordinate(value, label) {
  const number = integer(value, label);
  if (number < 0 || number > MAX_EXTENT - 1) {
    throw new TypeError(`Design ${label} must be between 0 and ${MAX_EXTENT - 1}.`);
  }
  return number;
}

/**
 * Split a design string into validated operations. Kept separate from expansion
 * so a malformed design reports the step that was wrong before any geometry is
 * computed.
 */
export function parseStructureDesign(text) {
  const source = String(text ?? '').trim();
  if (!source) throw new TypeError('The design is empty.');
  const written = source
    .split(';')
    .map(part => part.trim())
    .filter(part => part.length > 0);
  if (!written.length) throw new TypeError('The design has no steps.');
  if (written.length > MAX_STATEMENTS) {
    throw new TypeError(`The design has ${written.length} steps, above the ${MAX_STATEMENTS} limit.`);
  }
  const statements = expandTemplates(written);
  if (statements.length > MAX_OPS) {
    throw new TypeError(`The design expands to ${statements.length} operations, above the ${MAX_OPS} limit.`);
  }
  return statements.map((statement, index) => {
    const tokens = statement.split(/\s+/);
    const op = String(tokens[0] || '').toLowerCase();
    const step = `step ${index + 1} (${op || 'blank'})`;
    const need = (count) => {
      if (tokens.length < count + 1) {
        throw new TypeError(`Design ${step} needs ${count} values but got ${tokens.length - 1}.`);
      }
    };
    switch (op) {
      case 'box':
      case 'shell':
      case 'room':
      case 'carve': {
        need(6);
        return {
          op,
          x: coordinate(tokens[1], `${step} x`),
          y: coordinate(tokens[2], `${step} y`),
          z: coordinate(tokens[3], `${step} z`),
          w: extent(tokens[4], `${step} width`),
          h: extent(tokens[5], `${step} height`),
          d: extent(tokens[6], `${step} depth`),
          material: tokens[7] ? canonicalMaterial(tokens[7], `${step} material`) : null,
        };
      }
      case 'slab':
      case 'ring': {
        need(5);
        return {
          op,
          x: coordinate(tokens[1], `${step} x`),
          y: coordinate(tokens[2], `${step} y`),
          z: coordinate(tokens[3], `${step} z`),
          w: extent(tokens[4], `${step} width`),
          d: extent(tokens[5], `${step} depth`),
          material: tokens[6] ? canonicalMaterial(tokens[6], `${step} material`) : null,
        };
      }
      case 'line': {
        need(6);
        return {
          op,
          x1: coordinate(tokens[1], `${step} x1`),
          y1: coordinate(tokens[2], `${step} y1`),
          z1: coordinate(tokens[3], `${step} z1`),
          x2: coordinate(tokens[4], `${step} x2`),
          y2: coordinate(tokens[5], `${step} y2`),
          z2: coordinate(tokens[6], `${step} z2`),
          material: tokens[7] ? canonicalMaterial(tokens[7], `${step} material`) : null,
        };
      }
      case 'roof': {
        need(5);
        const style = String(tokens[6] || 'flat').toLowerCase();
        if (!['flat', 'gable', 'pyramid'].includes(style)) {
          throw new TypeError(`Design ${step} style must be flat, gable, or pyramid.`);
        }
        return {
          op,
          x: coordinate(tokens[1], `${step} x`),
          y: coordinate(tokens[2], `${step} y`),
          z: coordinate(tokens[3], `${step} z`),
          w: extent(tokens[4], `${step} width`),
          d: extent(tokens[5], `${step} depth`),
          style,
          material: tokens[7] ? canonicalMaterial(tokens[7], `${step} material`) : null,
        };
      }
      case 'put': {
        need(4);
        const thing = String(tokens[4] || '').toLowerCase();
        if (!ACCESSORIES[thing]) {
          throw new TypeError(`Design ${step} fixture must be one of: ${ACCESSORY_NAMES.join(', ')}.`);
        }
        return {
          op,
          x: coordinate(tokens[1], `${step} x`),
          y: coordinate(tokens[2], `${step} y`),
          z: coordinate(tokens[3], `${step} z`),
          thing,
        };
      }
      default:
        throw new TypeError(`Design ${step} is not a known operation.`);
    }
  });
}

/**
 * Every cell not reachable from the lowest course through a face-adjacent path
 * of planned blocks. The stock audit checks each cell for a neighbour placed by
 * its own stage, which a floating ring satisfies by leaning on itself; this
 * proves the whole design actually reaches the ground it is built from.
 */
function floatingCells(placed) {
  const keys = [...placed.keys()];
  if (!keys.length) return [];
  const parsed = new Map(keys.map(key => [key, key.split(':').map(Number)]));
  const lowest = Math.min(...[...parsed.values()].map(([, y]) => y));
  const reached = new Set();
  const queue = [];
  for (const [key, [, y]] of parsed) {
    if (y === lowest) {
      reached.add(key);
      queue.push(key);
    }
  }
  const steps = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  while (queue.length) {
    const [x, y, z] = parsed.get(queue.pop());
    for (const [dx, dy, dz] of steps) {
      const key = `${x + dx}:${y + dy}:${z + dz}`;
      if (placed.has(key) && !reached.has(key)) {
        reached.add(key);
        queue.push(key);
      }
    }
  }
  return keys.filter(key => !reached.has(key));
}

function applyOperation(placed, operation, block) {
  const material = operation.material || block;
  const set = (x, y, z, cellMaterial, cellFunction) => {
    placed.set(`${x}:${y}:${z}`, { material: cellMaterial, function: cellFunction });
  };

  switch (operation.op) {
    case 'box': {
      for (let x = 0; x < operation.w; x += 1) {
        for (let y = 0; y < operation.h; y += 1) {
          for (let z = 0; z < operation.d; z += 1) {
            set(operation.x + x, operation.y + y, operation.z + z, material, 'structure');
          }
        }
      }
      return;
    }
    case 'shell':
    case 'room': {
      for (let x = 0; x < operation.w; x += 1) {
        for (let y = 0; y < operation.h; y += 1) {
          for (let z = 0; z < operation.d; z += 1) {
            const onWall = x === 0 || z === 0 || x === operation.w - 1 || z === operation.d - 1;
            const onFloor = y === 0;
            const onCeiling = y === operation.h - 1;
            const include = operation.op === 'shell'
              ? onWall
              : onWall || onFloor || onCeiling;
            if (!include) continue;
            const role = onFloor ? 'foundation' : onCeiling ? 'weather_cover' : 'enclosure';
            set(operation.x + x, operation.y + y, operation.z + z, material, role);
          }
        }
      }
      return;
    }
    case 'slab': {
      for (let x = 0; x < operation.w; x += 1) {
        for (let z = 0; z < operation.d; z += 1) {
          set(operation.x + x, operation.y, operation.z + z, material, 'foundation');
        }
      }
      return;
    }
    case 'ring': {
      for (let x = 0; x < operation.w; x += 1) {
        for (let z = 0; z < operation.d; z += 1) {
          if (x !== 0 && z !== 0 && x !== operation.w - 1 && z !== operation.d - 1) continue;
          set(operation.x + x, operation.y, operation.z + z, material, 'enclosure');
        }
      }
      return;
    }
    case 'line': {
      const differing = [
        operation.x1 !== operation.x2,
        operation.y1 !== operation.y2,
        operation.z1 !== operation.z2,
      ].filter(Boolean).length;
      if (differing > 1) throw new TypeError('A line must run along one axis only.');
      const steps = Math.max(
        Math.abs(operation.x2 - operation.x1),
        Math.abs(operation.y2 - operation.y1),
        Math.abs(operation.z2 - operation.z1),
      );
      const sign = (from, to) => Math.sign(to - from);
      for (let i = 0; i <= steps; i += 1) {
        set(
          operation.x1 + sign(operation.x1, operation.x2) * i,
          operation.y1 + sign(operation.y1, operation.y2) * i,
          operation.z1 + sign(operation.z1, operation.z2) * i,
          material,
          'structure',
        );
      }
      return;
    }
    case 'roof': {
      // Each course is nested inside the one below it, so a roof always rests on
      // its own previous layer. A stepped solid roof is blunt, but it is a roof
      // that can actually be placed rather than one that audits well and then
      // has nothing to attach to.
      if (operation.style === 'flat') {
        for (let x = 0; x < operation.w; x += 1) {
          for (let z = 0; z < operation.d; z += 1) {
            set(operation.x + x, operation.y, operation.z + z, material, 'weather_cover');
          }
        }
        return;
      }
      const levels = operation.style === 'gable'
        ? Math.ceil(operation.d / 2)
        : Math.ceil(Math.min(operation.w, operation.d) / 2);
      for (let i = 0; i < levels; i += 1) {
        const fromX = operation.style === 'gable' ? 0 : i;
        const toX = operation.style === 'gable' ? operation.w - 1 : operation.w - 1 - i;
        const fromZ = i;
        const toZ = operation.d - 1 - i;
        if (fromX > toX || fromZ > toZ) break;
        for (let x = fromX; x <= toX; x += 1) {
          for (let z = fromZ; z <= toZ; z += 1) {
            set(operation.x + x, operation.y + i, operation.z + z, material, 'weather_cover');
          }
        }
      }
      return;
    }
    case 'carve': {
      for (let x = 0; x < operation.w; x += 1) {
        for (let y = 0; y < operation.h; y += 1) {
          for (let z = 0; z < operation.d; z += 1) {
            placed.delete(`${operation.x + x}:${operation.y + y}:${operation.z + z}`);
          }
        }
      }
      return;
    }
    case 'put': {
      const accessory = ACCESSORIES[operation.thing];
      set(operation.x, operation.y, operation.z, accessory.material, accessory.function);
      return;
    }
    default:
      throw new TypeError(`Design operation '${operation.op}' is not supported.`);
  }
}

/**
 * Turn a design into a proven blueprint, or throw with the exact reason it
 * cannot be built.
 */
export function expandStructureDesign(design, material, { id = 'designed_structure' } = {}) {
  const block = canonicalMaterial(material);
  const operations = Array.isArray(design) ? design : parseStructureDesign(design);
  const placed = new Map();
  for (const operation of operations) applyOperation(placed, operation, block);

  if (!placed.size) throw new TypeError('The design places no blocks.');
  if (placed.size > MAX_CELLS) {
    throw new TypeError(`The design needs ${placed.size} blocks, above the ${MAX_CELLS} limit.`);
  }

  const floating = floatingCells(placed);
  if (floating.length) {
    const [first] = floating;
    throw new TypeError(
      `The design has ${floating.length} block(s) with no path down to the ground, starting at ${first.replaceAll(':', ', ')}.`,
    );
  }

  const entries = [...placed.entries()].map(([key, value]) => {
    const [x, y, z] = key.split(':').map(Number);
    return { x, y, z, ...value };
  });
  const minX = Math.min(...entries.map(cell => cell.x));
  const minY = Math.min(...entries.map(cell => cell.y));
  const minZ = Math.min(...entries.map(cell => cell.z));

  // Stage is the course: everything on one level goes down together, and a level
  // is never placed before the level holding it up. Stage saturates at the
  // work-order ceiling, which keeps tall designs valid because a cell and its
  // support then share a stage rather than inverting.
  const cells = entries
    .map(cell => ({
      x: cell.x - minX,
      y: cell.y - minY,
      z: cell.z - minZ,
      material: cell.material,
      stage: Math.min(cell.y - minY, MAX_STAGE),
      function: cell.function,
    }))
    .sort((left, right) => left.stage - right.stage || left.x - right.x || left.z - right.z);

  const blueprint = {
    id: String(id).slice(0, 64),
    version: 1,
    width: Math.max(...cells.map(cell => cell.x)) + 1,
    depth: Math.max(...cells.map(cell => cell.z)) + 1,
    height: Math.max(...cells.map(cell => cell.y)) + 1,
    functions: Object.freeze([...new Set(cells.map(cell => cell.function))]),
    cells,
  };

  const problems = validateStructureBlueprint(blueprint);
  if (problems.length) throw new TypeError(`The design is not buildable: ${problems[0]}.`);
  return blueprint;
}

export function createDesignedStructureOrder({
  design,
  name = 'designed_structure',
  x,
  y,
  z,
  material = 'cobblestone',
  requester = 'player',
  constraints,
} = {}) {
  const id = String(name || 'designed_structure')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 48) || 'designed_structure';
  const blueprint = expandStructureDesign(design, material, { id: `${id}_${canonicalMaterial(material)}` });
  return createWorkOrder({
    role: 'builder',
    kind: 'build',
    source: 'player',
    requester,
    target: { name: 'construction_site', x, y, z },
    quota: blueprint.cells.length,
    blueprint,
    constraints,
  });
}
