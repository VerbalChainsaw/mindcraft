import { canonicalJson, sha256 } from '../a0/aggregate.mjs';

export const REQUEST_COMPLETION_FIXTURE = Object.freeze({
  schemaVersion: 'scenario-lab.request-completion-fixture.v1',
  fixtureId: 'scenario-lab.deliver-item-flat.v1',
  botName: 'MindcraftBot',
  recipientName: 'FollowTarget',
  botPosition: Object.freeze({ x: 1027.5, y: 100, z: 1008.5 }),
  recipientPosition: Object.freeze({ x: 1029.5, y: 100, z: 1008.5 }),
  craftingTable: Object.freeze({ x: 1031, y: 100, z: 1011, block: 'crafting_table' }),
  ground: Object.freeze({ y: 99, block: 'grass_block' }),
  difficulty: 'peaceful',
  spawnMobs: false,
  droppedItems: 'none',
});

const fingerprint = value => sha256(Buffer.from(canonicalJson(value), 'utf8'));

function itemCounts(grants) {
  return Object.fromEntries(
    grants
      .map(({ item, count }) => [String(item).replace(/^minecraft:/, ''), count])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function defineCase(definition) {
  const grants = definition.grants.map(entry => Object.freeze({ ...entry }));
  const outcomes = definition.outcomes.map(entry => Object.freeze({ ...entry }));
  const acceptedSegments = (definition.acceptedSegments || []).map(String);
  const traceDefinition = Object.freeze({
    schemaVersion: 'scenario-lab.recorded-trace.v1',
    caseId: definition.id,
    request: definition.request,
    response: definition.recordedResponse,
  });
  const t0 = Object.freeze({
    schemaVersion: 'scenario-lab.request-completion-t0.v1',
    fixture: REQUEST_COMPLETION_FIXTURE,
    caseId: definition.id,
    botInventory: Object.freeze(itemCounts(grants)),
    recipientInventory: Object.freeze({}),
    botHeld: true,
    botIdle: true,
    botPathfinding: false,
  });
  return Object.freeze({
    ...definition,
    grants: Object.freeze(grants),
    outcomes: Object.freeze(outcomes),
    acceptedSegments: Object.freeze(acceptedSegments),
    traceDefinition,
    expectedT0: t0,
    fixtureFingerprint: fingerprint(t0),
    recordedTraceFingerprint: fingerprint(traceDefinition),
    recordedResponseFingerprint: fingerprint(definition.recordedResponse),
  });
}

export const REQUEST_COMPLETION_CASES = Object.freeze([
  defineCase({
    id: '1-give',
    label: 'hand over something already in inventory',
    request: 'Give me 4 oak logs.',
    grants: [{ item: 'minecraft:oak_log', count: 8 }],
    outcomes: [{ holder: 'recipient', item: 'oak_log', count: 4 }],
    recordedResponse: 'I will give you four oak logs. !requestItemGoal("deliver", "oak_log", 4, "FollowTarget", "delivery")',
    timeoutMs: 180_000,
  }),
  defineCase({
    id: '2-craft-give',
    label: 'one craft, then hand over',
    request: 'Make me 8 oak planks and give them to me.',
    grants: [{ item: 'minecraft:oak_log', count: 8 }],
    outcomes: [{ holder: 'recipient', item: 'oak_planks', count: 8 }],
    recordedResponse: 'I will make and deliver eight oak planks. !requestItemGoal("deliver", "oak_planks", 8, "FollowTarget", "delivery")',
    timeoutMs: 180_000,
  }),
  defineCase({
    id: '3-chain-give',
    label: 'two crafts, then hand over',
    request: 'Make me 4 sticks and hand them over.',
    grants: [{ item: 'minecraft:oak_log', count: 8 }],
    outcomes: [{ holder: 'recipient', item: 'stick', count: 4 }],
    recordedResponse: 'I will make and deliver four sticks. !requestItemGoal("deliver", "stick", 4, "FollowTarget", "delivery")',
    timeoutMs: 180_000,
  }),
  defineCase({
    id: '4-tool-prep',
    label: 'campaign 28: prepare and equip a wooden pickaxe',
    request: 'Make yourself a wooden pickaxe and equip it.',
    grants: [{ item: 'minecraft:oak_log', count: 4 }],
    outcomes: [{ holder: 'bot', item: 'wooden_pickaxe', count: 1, equipped: 'main_hand' }],
    recordedResponse: 'I will make and equip a wooden pickaxe. !requestItemGoal("acquire", "wooden_pickaxe", 1, "FollowTarget", "main_hand")',
    acceptedSegments: ['Campaign 28'],
    timeoutMs: 180_000,
  }),
  defineCase({
    id: '5-mine-exact',
    label: 'campaigns 29/70: mine an exact quantity and deliver it',
    request: 'Mine 4 cobblestone and bring them to me.',
    grants: [{ item: 'minecraft:stone_pickaxe', count: 1 }],
    outcomes: [{ holder: 'recipient', item: 'cobblestone', count: 4 }],
    recordedResponse: 'I will mine and deliver four cobblestone. !requestItemGoal("deliver", "cobblestone", 4, "FollowTarget", "delivery")',
    acceptedSegments: ['Campaign 29', 'Campaign 70'],
    timeoutMs: 300_000,
  }),
  defineCase({
    id: '6-kit',
    label: 'campaign 68: craft a multi-item kit and keep it',
    request: 'Make a stone sword and a stone shovel.',
    grants: [
      { item: 'minecraft:oak_planks', count: 32 },
      { item: 'minecraft:stick', count: 16 },
      { item: 'minecraft:cobblestone', count: 16 },
    ],
    outcomes: [
      { holder: 'bot', item: 'stone_sword', count: 1 },
      { holder: 'bot', item: 'stone_shovel', count: 1 },
    ],
    recordedResponse: 'I will make and keep both tools. !queueItemPlan("stone_sword:1|stone_shovel:1", "FollowTarget", false)',
    acceptedSegments: ['Campaign 68'],
    timeoutMs: 180_000,
  }),
  defineCase({
    id: '7-workshop',
    label: 'M2: craft at the table and deliver the exact output',
    request: 'Craft an iron axe and give it to me.',
    grants: [
      { item: 'minecraft:iron_ingot', count: 8 },
      { item: 'minecraft:stick', count: 8 },
    ],
    outcomes: [{ holder: 'recipient', item: 'iron_axe', count: 1 }],
    recordedResponse: 'I will craft and deliver an iron axe. !requestItemGoal("deliver", "iron_axe", 1, "FollowTarget", "delivery")',
    acceptedSegments: ['M2'],
    timeoutMs: 180_000,
  }),
]);

const CASES_BY_ID = new Map(REQUEST_COMPLETION_CASES.map(entry => [entry.id, entry]));

export function requestCompletionCase(caseId) {
  const value = CASES_BY_ID.get(String(caseId || ''));
  if (!value) {
    throw new Error(
      `Unknown request-completion case '${String(caseId || '')}'. Known cases: ${[...CASES_BY_ID.keys()].join(', ')}.`,
    );
  }
  return value;
}

export function recordedTraceModelName(varianceCase) {
  return `scenario-recorded-trace/${varianceCase.id}/${varianceCase.recordedTraceFingerprint.slice(0, 16)}`;
}

export function fingerprintVarianceValue(value) {
  return fingerprint(value);
}
