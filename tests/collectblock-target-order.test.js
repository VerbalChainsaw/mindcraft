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
    targets.removeTarget(minedDrop);
    assert.equal(targets.getClosestDrop(), null);
});
