import assert from 'node:assert/strict';
import test from 'node:test';

import { createComponentTransactionReceipt } from '../../src/agent/runtime/component-transaction.js';

test('component completion requires custody, cleanup, and final terrain independently', () => {
  const receipt = createComponentTransactionReceipt({
    kind: 'tree',
    componentId: 'oak:1:64:1',
    requestedQuantity: 4,
    selectedQuantity: 5,
    acquiredQuantity: 5,
    remainingComponentCount: 0,
    componentCompletionRequired: true,
    accessOutcome: 'native_route',
    temporaryCreated: 2,
    temporaryReconciled: 1,
    temporaryRemaining: 1,
    terrainSettled: true,
    terrainOutcome: 'supported_stance',
  });

  assert.equal(receipt.outcome, 'incomplete');
  assert.equal(receipt.custody.verified, true);
  assert.equal(receipt.component.complete, true);
  assert.equal(receipt.cleanup.complete, false);
  assert.equal(receipt.terrain.settled, true);
});

test('a fully reconciled component transaction is complete and immutable', () => {
  const receipt = createComponentTransactionReceipt({
    kind: 'tree',
    componentId: 'spruce:4:70:9',
    requestedQuantity: 4,
    selectedQuantity: 6,
    acquiredQuantity: 6,
    componentCompletionRequired: true,
    accessOutcome: 'native_route',
    temporaryCreated: 2,
    temporaryReconciled: 2,
    terrainSettled: true,
    terrainOutcome: 'supported_stance',
  });

  assert.equal(receipt.outcome, 'complete');
  assert.equal(receipt.materialChanged, true);
  assert.equal(Object.isFrozen(receipt), true);
  assert.equal(Object.isFrozen(receipt.cleanup), true);
});

test('interruption censors the transaction even after physical yield', () => {
  const receipt = createComponentTransactionReceipt({
    kind: 'tree',
    componentId: 'birch:8:64:8',
    selectedQuantity: 4,
    acquiredQuantity: 2,
    remainingComponentCount: 2,
    interrupted: true,
  });

  assert.equal(receipt.outcome, 'censored');
  assert.equal(receipt.materialChanged, true);
});
