import assert from 'node:assert/strict';
import test from 'node:test';

import { GoalDirector } from '../../src/agent/runtime/goal-director.js';
import { createItemGoalContract } from '../../src/agent/runtime/goal-contract.js';
import { buildPrerequisiteMethodFrontier } from '../../src/agent/runtime/prerequisite-planner.js';
import {
  qualifyStrategicBranch as qualifyStrategicBranchContract,
  strategicFrontierFingerprint,
  STRATEGIC_METHOD_ID_PATTERN,
} from '../../src/agent/runtime/strategic-branch-qualification.js';

const COMPLETION = 'completion:coal:inventory:32';
const CAVE_METHOD = `planner_method:v1:${'a'.repeat(64)}`;
const CORRIDOR_METHOD = `planner_method:v1:${'b'.repeat(64)}`;

function plannerBot() {
  const items = {
    1: { id: 1, name: 'test_gem' },
    2: { id: 2, name: 'test_dust' },
  };
  const blocks = {
    10: { id: 10, name: 'alpha_ore', diggable: true, drops: [1], harvestTools: {} },
    11: { id: 11, name: 'beta_ore', diggable: true, drops: [1], harvestTools: {} },
  };
  const carried = [{ name: 'test_dust', type: 2, count: 1 }];
  return {
    inventory: { slots: carried, items: () => carried },
    registry: {
      items,
      itemsByName: Object.fromEntries(Object.values(items).map(item => [item.name, item])),
      blocks,
      blocksByName: Object.fromEntries(Object.values(blocks).map(block => [block.name, block])),
      recipes: {
        1: [{ ingredients: [{ id: 2, count: 1 }], result: { id: 1, count: 1 } }],
      },
    },
  };
}

function plannerBudgetBot(depth = 36) {
  const items = Object.fromEntries(Array.from({ length: depth }, (_, index) => [
    index + 1,
    { id: index + 1, name: `chain_${index}` },
  ]));
  const terminalBlock = {
    id: 100,
    name: 'terminal_ore',
    diggable: true,
    drops: [depth],
    harvestTools: {},
  };
  const recipes = Object.fromEntries(Array.from({ length: depth - 1 }, (_, index) => [
    index + 1,
    [{ ingredients: [{ id: index + 2, count: 1 }], result: { id: index + 1, count: 1 } }],
  ]));
  return {
    inventory: { slots: [], items: () => [] },
    registry: {
      items,
      itemsByName: Object.fromEntries(Object.values(items).map(item => [item.name, item])),
      blocks: { 100: terminalBlock },
      blocksByName: { terminal_ore: terminalBlock },
      recipes,
    },
  };
}

function candidate(methodId, {
  completionIdentity = COMPLETION,
  feasible = true,
  planFingerprint = methodId?.split(':').at(-1),
} = {}) {
  return {
    methodId,
    completionIdentity,
    feasible,
    proof: { planFingerprint },
  };
}

function qualifyStrategicBranch(input = {}) {
  const rankingStatus = ['resolved', 'unresolved'].includes(input.rankingStatus)
    ? input.rankingStatus
    : 'unknown';
  const frontierFingerprint = Object.hasOwn(input, 'frontierFingerprint')
    ? input.frontierFingerprint
    : strategicFrontierFingerprint({
      completionIdentity: input.completionIdentity,
      enumerationComplete: input.enumerationComplete,
      candidates: input.candidates,
      rankingStatus,
      selectedMethodId: input.selectedMethodId,
    });
  return qualifyStrategicBranchContract({
    blockerClass: 'terminal',
    ...input,
    frontierFingerprint,
  });
}

test('branch qualification fails closed until deterministic evidence is complete', () => {
  const incomplete = qualifyStrategicBranch({
    completionIdentity: COMPLETION,
    deterministicRecoveryExhausted: true,
    enumerationComplete: false,
    candidates: [candidate(CAVE_METHOD), candidate(CORRIDOR_METHOD)],
    rankingStatus: 'unresolved',
  });
  assert.equal(incomplete.status, 'not_qualified');
  assert.equal(incomplete.reasonCode, 'method_enumeration_incomplete');
  assert.equal(incomplete.strategicBranchEstablished, false);

  const recoveryAvailable = qualifyStrategicBranch({
    completionIdentity: COMPLETION,
    deterministicRecoveryExhausted: false,
    enumerationComplete: true,
    candidates: [candidate(CAVE_METHOD), candidate(CORRIDOR_METHOD)],
    rankingStatus: 'unresolved',
  });
  assert.equal(recoveryAvailable.reasonCode, 'deterministic_recovery_not_exhausted');

  const mixedCompletion = qualifyStrategicBranch({
    completionIdentity: COMPLETION,
    deterministicRecoveryExhausted: true,
    enumerationComplete: true,
    candidates: [
      candidate(CAVE_METHOD),
      candidate(CORRIDOR_METHOD, { completionIdentity: 'completion:charcoal:inventory:32' }),
    ],
    rankingStatus: 'unresolved',
  });
  assert.equal(mixedCompletion.reasonCode, 'completion_identity_mismatch');

  const unknownFeasibility = qualifyStrategicBranch({
    completionIdentity: COMPLETION,
    deterministicRecoveryExhausted: true,
    enumerationComplete: true,
    candidates: [candidate(CAVE_METHOD, { feasible: null }), candidate(CORRIDOR_METHOD)],
    rankingStatus: 'unresolved',
  });
  assert.equal(unknownFeasibility.reasonCode, 'candidate_feasibility_unknown');
});

test('branch qualification permits only model-eligible terminal blocker classes', () => {
  const candidates = [candidate(CAVE_METHOD), candidate(CORRIDOR_METHOD)];
  const evidence = {
    completionIdentity: COMPLETION,
    deterministicRecoveryExhausted: true,
    enumerationComplete: true,
    candidates,
    rankingStatus: 'unresolved',
    frontierFingerprint: strategicFrontierFingerprint({
      completionIdentity: COMPLETION,
      enumerationComplete: true,
      candidates,
      rankingStatus: 'unresolved',
      selectedMethodId: null,
    }),
  };

  for (const blockerClass of [
    undefined,
    'mechanical_defect',
    'state_reconciliation',
    'known_recovery',
    'clarification_required',
    'forged_class',
  ]) {
    const qualification = qualifyStrategicBranchContract({ ...evidence, blockerClass });
    assert.equal(qualification.status, 'not_qualified');
    assert.equal(qualification.reasonCode, 'blocker_class_ineligible');
    assert.equal(qualification.strategicBranchEstablished, false);
  }

  assert.equal(qualifyStrategicBranchContract({
    ...evidence,
    blockerClass: 'terminal',
  }).status, 'strategic_branch');
  assert.equal(qualifyStrategicBranchContract({
    ...evidence,
    blockerClass: 'capability_gap',
  }).status, 'strategic_branch');
});

test('zero, one, and resolved alternatives remain deterministic outcomes', () => {
  const noMethod = qualifyStrategicBranch({
    completionIdentity: COMPLETION,
    deterministicRecoveryExhausted: true,
    enumerationComplete: true,
    candidates: [candidate(CAVE_METHOD, { feasible: false })],
    rankingStatus: 'unresolved',
  });
  assert.equal(noMethod.status, 'capability_gap');
  assert.equal(noMethod.strategicBranchEstablished, false);

  const oneMethod = qualifyStrategicBranch({
    completionIdentity: COMPLETION,
    deterministicRecoveryExhausted: true,
    enumerationComplete: true,
    candidates: [candidate(CAVE_METHOD), candidate(CORRIDOR_METHOD, { feasible: false })],
    rankingStatus: 'unresolved',
  });
  assert.equal(oneMethod.status, 'deterministic_method_available');
  assert.equal(oneMethod.selectedMethodId, CAVE_METHOD);

  const ranked = qualifyStrategicBranch({
    completionIdentity: COMPLETION,
    deterministicRecoveryExhausted: true,
    enumerationComplete: true,
    candidates: [candidate(CAVE_METHOD), candidate(CORRIDOR_METHOD)],
    rankingStatus: 'resolved',
    selectedMethodId: CORRIDOR_METHOD,
  });
  assert.equal(ranked.status, 'deterministic_method_available');
  assert.equal(ranked.reasonCode, 'deterministic_ranking_resolved');
  assert.equal(ranked.selectedMethodId, CORRIDOR_METHOD);
});

test('only a complete unresolved frontier with two distinct feasible methods establishes a branch', () => {
  const duplicate = qualifyStrategicBranch({
    completionIdentity: COMPLETION,
    deterministicRecoveryExhausted: true,
    enumerationComplete: true,
    candidates: [candidate(CAVE_METHOD), candidate(CAVE_METHOD)],
    rankingStatus: 'unresolved',
  });
  assert.equal(duplicate.status, 'deterministic_method_available');
  assert.deepEqual(duplicate.feasibleMethodIds, [CAVE_METHOD]);

  const branch = qualifyStrategicBranch({
    completionIdentity: COMPLETION,
    deterministicRecoveryExhausted: true,
    enumerationComplete: true,
    candidates: [candidate(CORRIDOR_METHOD), candidate(CAVE_METHOD)],
    rankingStatus: 'unresolved',
  });
  assert.equal(branch.status, 'strategic_branch');
  assert.equal(branch.strategicBranchEstablished, true);
  assert.deepEqual(branch.feasibleMethodIds, [CAVE_METHOD, CORRIDOR_METHOD]);
  assert.equal(Object.isFrozen(branch), true);
  assert.equal(Object.isFrozen(branch.feasibleMethodIds), true);
});

test('branch qualification rejects coercion, truncation, and non-planner method identities', () => {
  const base = {
    completionIdentity: COMPLETION,
    deterministicRecoveryExhausted: true,
    enumerationComplete: true,
    rankingStatus: 'unresolved',
  };
  assert.equal(qualifyStrategicBranch({
    ...base,
    completionIdentity: { toString: () => COMPLETION },
    candidates: [],
  }).reasonCode, 'completion_identity_invalid');
  assert.equal(qualifyStrategicBranch({
    ...base,
    completionIdentity: `${COMPLETION}\nforged`,
    candidates: [],
  }).reasonCode, 'completion_identity_invalid');
  assert.equal(qualifyStrategicBranch({
    ...base,
    completionIdentity: ` ${COMPLETION}`,
    candidates: [],
  }).reasonCode, 'completion_identity_invalid');
  assert.equal(qualifyStrategicBranch({
    ...base,
    candidates: [candidate('cave')],
  }).reasonCode, 'candidate_identity_invalid');
  assert.equal(qualifyStrategicBranch({
    ...base,
    candidates: [candidate(`${CAVE_METHOD}suffix-that-must-not-be-truncated`)],
  }).reasonCode, 'candidate_identity_invalid');
  assert.equal(qualifyStrategicBranch({
    ...base,
    candidates: [candidate(CAVE_METHOD, { completionIdentity: 42 })],
  }).reasonCode, 'candidate_identity_invalid');
  assert.equal(qualifyStrategicBranch({
    ...base,
    candidates: [candidate(CAVE_METHOD), candidate(CORRIDOR_METHOD)],
    rankingStatus: 'resolved',
    selectedMethodId: { toString: () => CAVE_METHOD },
  }).reasonCode, 'frontier_fingerprint_invalid');
  assert.equal(qualifyStrategicBranch({
    ...base,
    candidates: { 0: candidate(CAVE_METHOD), length: 1 },
  }).reasonCode, 'candidate_set_invalid');
  assert.equal(qualifyStrategicBranch({
    ...base,
    candidates: Array.from({ length: 65 }, () => candidate(CAVE_METHOD)),
  }).reasonCode, 'candidate_set_invalid');
  assert.equal(qualifyStrategicBranch({
    ...base,
    candidates: [candidate(CAVE_METHOD), candidate(CAVE_METHOD, { feasible: false })],
  }).reasonCode, 'candidate_feasibility_conflict');
  assert.equal(qualifyStrategicBranch({
    ...base,
    candidates: [
      candidate(CAVE_METHOD),
      candidate(CAVE_METHOD, { planFingerprint: 'c'.repeat(64) }),
    ],
  }).reasonCode, 'candidate_proof_conflict');
  assert.equal(qualifyStrategicBranch({
    ...base,
    candidates: [candidate(CAVE_METHOD, { planFingerprint: 'not-a-proof' })],
  }).reasonCode, 'candidate_proof_invalid');
  assert.equal(qualifyStrategicBranch({
    ...base,
    candidates: [candidate(CAVE_METHOD), candidate(CORRIDOR_METHOD)],
    rankingStatus: 'almost_resolved',
  }).reasonCode, 'deterministic_ranking_unknown');
});

test('planner frontier independently proves and completely enumerates stable whole-goal methods', () => {
  const options = {
    target: 'test_gem',
    quantity: 1,
    completionIdentity: COMPLETION,
  };
  const frontier = buildPrerequisiteMethodFrontier(plannerBot(), options);
  const repeated = buildPrerequisiteMethodFrontier(plannerBot(), options);

  assert.equal(frontier.status, 'complete');
  assert.equal(frontier.enumerationComplete, true);
  assert.equal(frontier.enumerationScope, 'planner_whole_goal_methods_v1');
  assert.equal(frontier.rankingStatus, 'resolved');
  assert.equal(frontier.candidateCount, 2);
  assert.equal(frontier.queryCount, 4);
  assert.ok(frontier.candidates.every(method => method.feasible));
  assert.ok(frontier.candidates.every(method => method.completionIdentity === COMPLETION));
  assert.ok(frontier.candidates.every(method => STRATEGIC_METHOD_ID_PATTERN.test(method.methodId)));
  assert.ok(frontier.candidates.every(method => method.proof.plannerStatus === 'ready'));
  assert.ok(frontier.candidates.every(method => /^[a-f0-9]{64}$/.test(method.proof.planFingerprint)));
  assert.deepEqual(
    frontier.candidates.map(method => method.proof.rootMethodKey).sort(),
    ['collect:*->test_gem', 'craft:test_gem<-1xtest_dust'],
  );
  assert.deepEqual(
    frontier.candidates.map(method => method.methodId),
    repeated.candidates.map(method => method.methodId),
  );
  assert.equal(Object.isFrozen(frontier), true);
  assert.equal(Object.isFrozen(frontier.candidates), true);
  assert.equal(Object.isFrozen(frontier.candidates[0].proof.decisionKeys), true);

  const qualification = qualifyStrategicBranch({
    completionIdentity: COMPLETION,
    deterministicRecoveryExhausted: true,
    enumerationComplete: frontier.enumerationComplete,
    candidates: frontier.candidates,
    rankingStatus: frontier.rankingStatus,
    selectedMethodId: frontier.selectedMethodId,
  });
  assert.equal(qualification.status, 'deterministic_method_available');
  assert.equal(qualification.reasonCode, 'deterministic_ranking_resolved');
});

test('planner proof and frontier fingerprints bind executable arguments and reject tampering', () => {
  const bot = plannerBot();
  const carried = [{ name: 'test_dust', type: 2, count: 4 }];
  bot.inventory = { slots: carried, items: () => carried };
  const common = {
    target: 'test_gem',
    completionIdentity: COMPLETION,
  };
  const one = buildPrerequisiteMethodFrontier(bot, { ...common, quantity: 1 });
  const two = buildPrerequisiteMethodFrontier(bot, { ...common, quantity: 2 });
  const proofByRoot = frontier => new Map(frontier.candidates.map(entry => [
    entry.proof.rootMethodKey,
    entry,
  ]));
  const oneByRoot = proofByRoot(one);
  const twoByRoot = proofByRoot(two);

  assert.deepEqual([...oneByRoot.keys()].sort(), [...twoByRoot.keys()].sort());
  for (const [rootMethodKey, oneMethod] of oneByRoot) {
    const twoMethod = twoByRoot.get(rootMethodKey);
    assert.equal(oneMethod.methodId, twoMethod.methodId);
    assert.notEqual(oneMethod.proof.planFingerprint, twoMethod.proof.planFingerprint);
  }
  assert.match(one.frontierFingerprint, /^[a-f0-9]{64}$/);
  assert.notEqual(one.frontierFingerprint, two.frontierFingerprint);

  const tampered = qualifyStrategicBranch({
    completionIdentity: COMPLETION,
    deterministicRecoveryExhausted: true,
    enumerationComplete: one.enumerationComplete,
    candidates: one.candidates,
    frontierFingerprint: '0'.repeat(64),
    rankingStatus: one.rankingStatus,
    selectedMethodId: one.selectedMethodId,
  });
  assert.equal(tampered.status, 'not_qualified');
  assert.equal(tampered.reasonCode, 'frontier_fingerprint_mismatch');
});

test('planner frontier reports zero and one material completion methods without manufacturing a branch', () => {
  const oneMethodBot = plannerBot();
  oneMethodBot.registry.recipes = {};
  const oneMethod = buildPrerequisiteMethodFrontier(oneMethodBot, {
    target: 'test_gem',
    quantity: 1,
    completionIdentity: COMPLETION,
  });
  assert.equal(oneMethod.status, 'complete');
  assert.equal(oneMethod.candidateCount, 1);
  assert.equal(oneMethod.candidates[0].proof.rootMethodKey, 'collect:*->test_gem');
  const sourceVariant = buildPrerequisiteMethodFrontier(oneMethodBot, {
    target: 'test_gem',
    quantity: 1,
    completionIdentity: COMPLETION,
    excludedMethods: ['collect:alpha_ore->test_gem'],
  });
  assert.equal(sourceVariant.candidateCount, 1);
  assert.equal(sourceVariant.candidates[0].methodId, oneMethod.candidates[0].methodId);
  assert.equal(qualifyStrategicBranch({
    completionIdentity: COMPLETION,
    deterministicRecoveryExhausted: true,
    enumerationComplete: oneMethod.enumerationComplete,
    candidates: oneMethod.candidates,
    rankingStatus: oneMethod.rankingStatus,
    selectedMethodId: oneMethod.selectedMethodId,
  }).status, 'deterministic_method_available');

  const noMethodBot = plannerBot();
  noMethodBot.registry.blocks = {};
  noMethodBot.registry.blocksByName = {};
  noMethodBot.registry.recipes = {};
  const noMethod = buildPrerequisiteMethodFrontier(noMethodBot, {
    target: 'test_gem',
    quantity: 1,
    completionIdentity: COMPLETION,
  });
  assert.equal(noMethod.status, 'complete');
  assert.equal(noMethod.candidateCount, 0);
  const noMethodQualification = qualifyStrategicBranch({
    completionIdentity: COMPLETION,
    deterministicRecoveryExhausted: true,
    enumerationComplete: noMethod.enumerationComplete,
    candidates: noMethod.candidates,
    rankingStatus: noMethod.rankingStatus,
    selectedMethodId: noMethod.selectedMethodId,
  });
  assert.equal(noMethodQualification.status, 'capability_gap');
  assert.equal(noMethodQualification.reasonCode, 'no_feasible_method');
});

test('planner frontier fails closed when its bounded search cannot exhaust alternatives', () => {
  const frontier = buildPrerequisiteMethodFrontier(plannerBot(), {
    target: 'test_gem',
    quantity: 1,
    completionIdentity: COMPLETION,
    frontierMaxSearches: 1,
  });
  assert.equal(frontier.status, 'incomplete');
  assert.equal(frontier.reasonCode, 'frontier_search_budget_exhausted');
  assert.equal(frontier.enumerationComplete, false);
  assert.equal(frontier.candidateCount, 1);
  assert.equal(frontier.selectedMethodId, null);

  const qualification = qualifyStrategicBranch({
    completionIdentity: COMPLETION,
    deterministicRecoveryExhausted: true,
    enumerationComplete: frontier.enumerationComplete,
    candidates: frontier.candidates,
    rankingStatus: frontier.rankingStatus,
    selectedMethodId: frontier.selectedMethodId,
  });
  assert.equal(qualification.status, 'not_qualified');
  assert.equal(qualification.reasonCode, 'method_enumeration_incomplete');
});

test('planner frontier fails closed when the causal planner cannot exhaust its own budget', () => {
  const frontier = buildPrerequisiteMethodFrontier(plannerBudgetBot(), {
    target: 'chain_0',
    quantity: 1,
    completionIdentity: COMPLETION,
    maxDepth: 64,
    maxNodes: 32,
  });
  assert.equal(frontier.status, 'incomplete');
  assert.equal(frontier.reasonCode, 'planner_budget_exhausted');
  assert.equal(frontier.enumerationComplete, false);
  assert.deepEqual(frontier.blockerCodes, ['planner_node_budget']);
});

test('an already-satisfied completion is not misreported as a capability gap', () => {
  const bot = plannerBot();
  const carried = [
    ...bot.inventory.items(),
    { name: 'test_gem', type: 1, count: 1 },
  ];
  bot.inventory = { slots: carried, items: () => carried };
  const frontier = buildPrerequisiteMethodFrontier(bot, {
    target: 'test_gem',
    quantity: 1,
    completionIdentity: COMPLETION,
  });
  assert.equal(frontier.status, 'not_applicable');
  assert.equal(frontier.reasonCode, 'completion_already_satisfied');
  assert.equal(frontier.enumerationComplete, false);

  const qualification = qualifyStrategicBranch({
    completionIdentity: COMPLETION,
    deterministicRecoveryExhausted: true,
    enumerationComplete: frontier.enumerationComplete,
    candidates: frontier.candidates,
    rankingStatus: frontier.rankingStatus,
    selectedMethodId: frontier.selectedMethodId,
  });
  assert.equal(qualification.status, 'not_qualified');
  assert.equal(qualification.reasonCode, 'method_enumeration_incomplete');
});

test('planner frontier rejects an untyped or whitespace-aliased completion contract', () => {
  assert.equal(buildPrerequisiteMethodFrontier(plannerBot(), {
    target: 'test_gem',
    completionIdentity: { toString: () => COMPLETION },
  }).reasonCode, 'completion_identity_invalid');
  assert.equal(buildPrerequisiteMethodFrontier(plannerBot(), {
    target: 'test_gem',
    completionIdentity: `${COMPLETION} `,
  }).reasonCode, 'completion_identity_invalid');
});

test('GoalDirector records the planner frontier without changing lifecycle state', () => {
  const events = [];
  let modelCalls = 0;
  let saves = 0;
  const store = {
    load: () => ({ activeGoal: null, lastGoal: null }),
    save() { saves += 1; },
  };
  const agent = {
    name: 'GateBot',
    bot: plannerBot(),
    flight_recorder: {
      recordRuntimeEvent(code, evidence) {
        events.push({ code, evidence });
        return true;
      },
    },
    prompter: { promptAutonomy() { modelCalls += 1; } },
  };
  const director = new GoalDirector(agent, {
    store,
    procedures: { find: () => null, record: () => null },
  });
  const goal = createItemGoalContract({
    kind: 'acquire',
    requester: 'Director',
    target: {
      requestedName: 'test_gem',
      canonicalName: 'test_gem',
      inventoryName: 'test_gem',
      acquisitionName: 'alpha_ore',
      family: null,
      acquisitionKind: 'collect_block',
    },
    quantity: 1,
  });
  director.activeGoal = {
    ...goal,
    evidence: {
      ...goal.evidence,
      actionId: 'action-terminal-proof',
      code: 'bounded_attempts_exhausted',
      detail: 'The bounded deterministic attempts were exhausted.',
    },
  };
  const activeGoal = director.activeGoal;

  assert.equal(director.recordTerminalBoundary('no_deterministic_recovery', {
    code: 'no_deterministic_recovery',
    detail: 'No safe deterministic recovery remains.',
  }), true);

  assert.equal(events.length, 1);
  assert.equal(events[0].code, 'goal.terminal_boundary');
  assert.equal(events[0].evidence.methods.enumerationComplete, true);
  assert.equal(events[0].evidence.methods.strategicBranchEstablished, false);
  assert.equal(events[0].evidence.methods.frontier.status, 'complete');
  assert.equal(events[0].evidence.methods.frontier.candidateCount, 2);
  assert.equal(events[0].evidence.schemaVersion, 2);
  assert.equal(events[0].evidence.methods.frontier.schemaVersion, 2);
  assert.match(events[0].evidence.methods.frontier.frontierFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(events[0].evidence.methods.qualification.blockerClass, 'terminal');
  assert.equal(events[0].evidence.methods.qualification.status, 'deterministic_method_available');
  assert.equal(
    events[0].evidence.methods.qualification.reasonCode,
    'deterministic_ranking_resolved',
  );
  assert.equal(director.activeGoal, activeGoal);
  assert.equal(modelCalls, 0);
  assert.equal(saves, 0);
});

test('GoalDirector cannot turn a mechanical defect into a strategic branch', () => {
  const events = [];
  let modelCalls = 0;
  let saves = 0;
  const director = new GoalDirector({
    name: 'GateBot',
    bot: plannerBot(),
    flight_recorder: {
      recordRuntimeEvent(code, evidence) {
        events.push({ code, evidence });
        return true;
      },
    },
    prompter: { promptAutonomy() { modelCalls += 1; } },
  }, {
    store: {
      load: () => ({ activeGoal: null, lastGoal: null }),
      save() { saves += 1; },
    },
    procedures: { find: () => null, record: () => null },
  });
  const goal = createItemGoalContract({
    kind: 'acquire',
    requester: 'Director',
    target: {
      requestedName: 'test_gem',
      canonicalName: 'test_gem',
      inventoryName: 'test_gem',
      acquisitionName: 'alpha_ore',
      family: null,
      acquisitionKind: 'collect_block',
    },
    quantity: 1,
  });
  director.activeGoal = {
    ...goal,
    evidence: {
      ...goal.evidence,
      actionId: 'action-mechanical-failure',
      code: 'runtime_error',
      detail: 'The settled physical capability failed.',
    },
  };
  const activeGoal = director.activeGoal;

  assert.equal(director.recordTerminalBoundary('no_deterministic_recovery', {
    code: 'no_deterministic_recovery',
    detail: 'No safe deterministic recovery remains.',
  }), true);

  assert.equal(events.length, 1);
  assert.equal(events[0].evidence.blockerClass, 'mechanical_defect');
  assert.equal(events[0].evidence.methods.frontier.status, 'complete');
  assert.equal(events[0].evidence.methods.frontier.candidateCount, 2);
  assert.equal(events[0].evidence.methods.qualification.status, 'not_qualified');
  assert.equal(
    events[0].evidence.methods.qualification.reasonCode,
    'blocker_class_ineligible',
  );
  assert.equal(events[0].evidence.methods.strategicBranchEstablished, false);
  assert.equal(director.activeGoal, activeGoal);
  assert.equal(modelCalls, 0);
  assert.equal(saves, 0);
});

test('GoalDirector keeps terminal telemetry alive when planner frontier construction fails', () => {
  const events = [];
  const bot = { inventory: { slots: [], items: () => [] } };
  Object.defineProperty(bot, 'registry', {
    get() { throw new Error('synthetic registry failure'); },
  });
  const director = new GoalDirector({
    name: 'GateBot',
    bot,
    flight_recorder: {
      recordRuntimeEvent(code, evidence) {
        events.push({ code, evidence });
        return true;
      },
    },
  }, {
    store: { load: () => ({ activeGoal: null, lastGoal: null }), save() {} },
    procedures: { find: () => null, record: () => null },
  });
  const goal = createItemGoalContract({
    kind: 'acquire',
    requester: 'Director',
    target: {
      requestedName: 'test_gem',
      canonicalName: 'test_gem',
      inventoryName: 'test_gem',
      acquisitionName: 'alpha_ore',
      family: null,
      acquisitionKind: 'collect_block',
    },
    quantity: 1,
  });
  director.activeGoal = {
    ...goal,
    evidence: {
      ...goal.evidence,
      actionId: 'action-terminal-proof',
      code: 'bounded_attempts_exhausted',
      detail: 'The bounded deterministic attempts were exhausted.',
    },
  };
  const activeGoal = director.activeGoal;
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(director.recordTerminalBoundary('no_deterministic_recovery', {
      code: 'no_deterministic_recovery',
      detail: 'No safe deterministic recovery remains.',
    }), true);
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(events.length, 1);
  assert.equal(events[0].evidence.methods.frontier.status, 'incomplete');
  assert.equal(events[0].evidence.methods.frontier.reasonCode, 'planner_runtime_error');
  assert.equal(events[0].evidence.methods.qualification.status, 'not_qualified');
  assert.equal(
    events[0].evidence.methods.qualification.reasonCode,
    'method_enumeration_incomplete',
  );
  assert.equal(director.activeGoal, activeGoal);
});
