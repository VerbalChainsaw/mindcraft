import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isDrinkableHealingPotion,
  isWaterPotion,
  potionIdentity,
  potionFingerprint,
  resolveBrewingPlan,
} from '../src/agent/runtime/brewing-plan.js';
import {
  clarificationQuestionFromGeneration,
  conversationGroundingViolation,
  groundedActionResultFallback,
  groundedThreatFallback,
  latestMessageRequestsAction,
  recentActionGroundingPrompt,
  unsupportedCapabilityFromGeneration,
} from '../src/models/prompter.js';

test('brewing plan resolves base, modified, splash, and lingering potion stages', () => {
  assert.deepEqual(resolveBrewingPlan('strength'), {
    target: 'strength',
    effect: 'strength',
    modifier: 'normal',
    delivery: 'drinkable',
    outputItem: 'potion',
    ingredients: ['nether_wart', 'blaze_powder'],
  });
  assert.deepEqual(resolveBrewingPlan('long_fire_resistance'), {
    target: 'long_fire_resistance',
    effect: 'fire_resistance',
    modifier: 'long',
    delivery: 'drinkable',
    outputItem: 'potion',
    ingredients: ['nether_wart', 'magma_cream', 'redstone'],
  });
  assert.deepEqual(resolveBrewingPlan('splash_strong_healing'), {
    target: 'splash_strong_healing',
    effect: 'healing',
    modifier: 'strong',
    delivery: 'splash',
    outputItem: 'splash_potion',
    ingredients: ['nether_wart', 'glistering_melon_slice', 'glowstone_dust', 'gunpowder'],
  });
  assert.deepEqual(resolveBrewingPlan('lingering_poison'), {
    target: 'lingering_poison',
    effect: 'poison',
    modifier: 'normal',
    delivery: 'lingering',
    outputItem: 'lingering_potion',
    ingredients: ['nether_wart', 'spider_eye', 'gunpowder', 'dragon_breath'],
  });
});

test('brewing plan rejects impossible vanilla modifiers and unknown effects', () => {
  assert.equal(resolveBrewingPlan('strong_fire_resistance'), null);
  assert.equal(resolveBrewingPlan('long_healing'), null);
  assert.equal(resolveBrewingPlan('haste'), null);
});

test('water bottles and potion state changes are identified through modern components', () => {
  const water = {
    name: 'potion',
    type: 100,
    components: [{ type: 'potion_contents', data: { potionId: 0, customEffects: [] } }],
    componentMap: new Map([
      ['potion_contents', { type: 'potion_contents', data: { potionId: 0, customEffects: [] } }],
    ]),
  };
  const awkward = {
    ...water,
    components: [{ type: 'potion_contents', data: { potionId: 3, customEffects: [] } }],
    componentMap: new Map([
      ['potion_contents', { type: 'potion_contents', data: { potionId: 3, customEffects: [] } }],
    ]),
  };

  assert.equal(isWaterPotion(water), true);
  assert.equal(isWaterPotion(awkward), false);
  assert.notEqual(potionFingerprint(water), potionFingerprint(awkward));
});

test('live 1.21.11 numeric potion components retain verified healing identity', () => {
  const healing = {
    name: 'potion',
    componentMap: new Map([
      ['potion_contents', { data: { potionId: 24, customEffects: [] } }],
    ]),
  };
  const strongHealing = {
    name: 'potion',
    componentMap: new Map([
      ['potion_contents', { data: { potionId: 25, customEffects: [] } }],
    ]),
  };

  assert.equal(potionIdentity(healing, '1.21.11'), 'healing');
  assert.equal(potionIdentity(strongHealing, '1.21.11'), 'strong_healing');
  assert.equal(isDrinkableHealingPotion(healing, '1.21.11'), true);
  assert.equal(isDrinkableHealingPotion(healing, '1.21.10'), false);
});

test('completed natural-language actions do not force a duplicate command', () => {
  const request = { role: 'user', content: 'ADMIN: Brew one swiftness potion.' };

  assert.equal(latestMessageRequestsAction([request]), true);
  assert.equal(latestMessageRequestsAction([
    request,
    { role: 'assistant', content: 'Brewing it. !brewPotion("swiftness", 1)' },
    { role: 'system', content: 'Action output:\nBrewed 1 swiftness potion.' },
  ]), false);
  assert.equal(latestMessageRequestsAction([
    request,
    { role: 'assistant', content: 'Trying it. !notACommand()' },
    { role: 'system', content: 'Command !notACommand does not exist.' },
  ]), true);
});

test('appearance praise remains conversation while imperative look remains action', () => {
  assert.equal(latestMessageRequestsAction([
    { role: 'user', content: 'KidPlayer: You look awesome!' },
  ]), false);
  assert.equal(latestMessageRequestsAction([
    { role: 'user', content: 'KidPlayer: That looks great.' },
  ]), false);
  assert.equal(latestMessageRequestsAction([
    { role: 'user', content: 'KidPlayer: Look at me.' },
  ]), true);
});

test('a typed clarification is one concise commandless question, not an action-evasion channel', () => {
  assert.equal(
    clarificationQuestionFromGeneration('[CLARIFY] Which chest should I use—the oak chest or the barrel?'),
    'Which chest should I use—the oak chest or the barrel?',
  );
  assert.equal(clarificationQuestionFromGeneration('[CLARIFY] Which one? What about later?'), null);
  assert.equal(clarificationQuestionFromGeneration('[CLARIFY] Dad or Kid? !givePlayer("bread", 1, "DadPlayer")'), null);
  assert.equal(clarificationQuestionFromGeneration('Who should receive it?'), null);
});

test('an unsupported action settles as a typed refusal and cannot smuggle a substitute command', () => {
  assert.equal(
    unsupportedCapabilityFromGeneration('[UNSUPPORTED] I cannot grant server operator permissions.'),
    'I cannot grant server operator permissions.',
  );
  assert.equal(
    unsupportedCapabilityFromGeneration('I cannot grant admin, but I can mine coal.'),
    null,
  );
  assert.equal(
    unsupportedCapabilityFromGeneration('[UNSUPPORTED] I cannot grant admin. !collectBlocksInRange("coal_ore", 2, 64)'),
    null,
  );
});

test('conversation grounding leaves hostile reachability unknown and rejects false safety', () => {
  const perception = {
    primaryThreat: {
      name: 'skeleton',
      distance: 7.6,
      direction: 'ahead-left-below',
      visible: false,
      motion: 'approaching',
      threatPriority: 'high',
    },
    hostiles: [{
      name: 'skeleton',
      distance: 7.6,
      direction: 'ahead-left-below',
      visible: false,
      motion: 'approaching',
      threatPriority: 'high',
    }],
  };

  assert.equal(
    conversationGroundingViolation(
      'The skeleton is occluded and it has no clear path to us.',
      perception,
    )?.code,
    'unsupported_hostile_route_claim',
  );
  assert.equal(
    conversationGroundingViolation(
      "We're safe to stand here for now because it is occluded.",
      perception,
    )?.code,
    'unsupported_hostile_safety_claim',
  );
  assert.equal(
    conversationGroundingViolation(
      "The skeleton is approaching about 8 blocks away. I can't promise we're safe, and I have no route proof.",
      perception,
    ),
    null,
  );
  assert.equal(
    conversationGroundingViolation(
      'It is safe to say the skeleton is nearby, so take the western path away from it.',
      perception,
    ),
    null,
  );
  assert.equal(
    groundedThreatFallback(perception),
    "I can confirm high-threat, skeleton, about 7.6 blocks ahead-left-below, approaching, occluded. Occlusion only proves line of sight; I have no route proof, so I can't promise this spot is safe.",
  );
});

test('conversation grounding rejects a relevant denial of a fresh successful action receipt', () => {
  const finishedAt = 10_000;
  const state = {
    _meta: { sampledAt: finishedAt + 321 },
    action: {
      lastResult: {
        phase: 'succeeded',
        code: 'skill_collected',
        label: 'action:collectWoodInRange',
        detail: 'Action output: Wood collection finished with 7 logs from 1 complete tree.',
        target: { name: 'spruce_log' },
        finishedAt,
      },
    },
    perception: { hostiles: [] },
  };
  const messages = [{
    role: 'user',
    content: 'KidPlayer: Did you cut down the whole tree cleanly, or leave pieces floating?',
  }];

  const violation = conversationGroundingViolation(
    'I have not begun harvesting yet, and no logs have been collected or trees cut.',
    state,
    messages,
  );

  assert.equal(violation?.code, 'contradicts_recent_action_result');
  assert.equal(
    violation?.fallback,
    'The latest verified result is: Wood collection finished with 7 logs from 1 complete tree.',
  );
  assert.match(recentActionGroundingPrompt(state), /succeeded\/skill_collected/);
  assert.match(recentActionGroundingPrompt(state), /7 logs from 1 complete tree/);
  assert.equal(
    groundedActionResultFallback(state.action.lastResult),
    violation?.fallback,
  );
});

test('recent-action grounding does not reject unrelated or stale conversational claims', () => {
  const state = {
    _meta: { sampledAt: 200_001 },
    action: {
      lastResult: {
        phase: 'succeeded',
        code: 'skill_collected',
        label: 'action:collectWoodInRange',
        detail: 'Collected 7 spruce logs from one complete tree.',
        target: { name: 'spruce_log' },
        finishedAt: 1,
      },
    },
    perception: { hostiles: [] },
  };

  assert.equal(recentActionGroundingPrompt(state), '');
  assert.equal(conversationGroundingViolation(
    'I have not started building the campsite.',
    { ...state, _meta: { sampledAt: 10_000 } },
    [{ role: 'user', content: 'KidPlayer: Have you built the campsite?' }],
  ), null);
});
