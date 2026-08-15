import assert from 'node:assert/strict';
import test from 'node:test';
import Vec3 from 'vec3';

import { Targets } from '../packages/minecraft-runtime/mineflayer-collectblock/lib/Targets.js';

class Block {
    constructor(position) {
        this.position = position;
    }
}

class Entity {
    constructor(position) {
        this.position = position;
    }
}

test('CollectBlock finishes a mined drop before routing to another block', () => {
    const targets = new Targets({ entity: { position: new Vec3(0, 64, 0) } });
    const nextBlock = new Block(new Vec3(0.5, 65, 0.5));
    const minedDrop = new Entity(new Vec3(2, 64, 0));

    targets.appendTargets([nextBlock, minedDrop]);

    assert.equal(targets.getClosest(), nextBlock);
    assert.equal(targets.getClosestDrop(), minedDrop);
    assert.equal(targets.getClosestBlock(), nextBlock);
    targets.removeTarget(minedDrop);
    assert.equal(targets.getClosestDrop(), null);
});

test('CollectBlock can retain a vertical work stance until every bound block is cut', () => {
    const targets = new Targets({ entity: { position: new Vec3(0, 64, 0) } });
    const crown = new Block(new Vec3(0, 70, 0));
    const lowerDrop = new Entity(new Vec3(4, 64, 0));

    targets.appendTargets([crown, lowerDrop]);

    assert.equal(targets.getClosestDrop(), lowerDrop);
    assert.equal(targets.getClosestBlock(), crown);
    targets.removeTarget(crown);
    assert.equal(targets.getClosestBlock(), null);
    assert.equal(targets.getClosestDrop(), lowerDrop);
});

test('CollectBlock route exhaustion preserves drops from blocks already mined', () => {
    const targets = new Targets({ entity: { position: new Vec3(0, 64, 0) } });
    const unreachableCrown = new Block(new Vec3(0, 72, 0));
    const lowerDrop = new Entity(new Vec3(1, 64, 0));

    targets.appendTargets([unreachableCrown, lowerDrop]);
    targets.removeBlocks();

    assert.equal(targets.getClosestBlock(), null);
    assert.equal(targets.getClosestDrop(), lowerDrop);
    assert.equal(targets.empty, false, 'the mined drop remains unfinished collection work');
});
