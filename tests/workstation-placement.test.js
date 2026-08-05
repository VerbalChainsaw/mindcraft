import assert from 'node:assert/strict';
import test from 'node:test';
import Vec3 from 'vec3';

import { getNearestFreeSpaces } from '../src/agent/library/world.js';

const key = position => `${position.x}:${position.y}:${position.z}`;
const block = (name, position, boundingBox = name === 'air' ? 'empty' : 'block') => ({
    name,
    position,
    boundingBox,
});

test('local workstation binding skips an entity-occupied cell and preserves another candidate', () => {
    const occupied = new Vec3(1, 64, 0);
    const available = new Vec3(2, 64, 0);
    const blocks = new Map();
    for (const position of [occupied, available]) {
        blocks.set(key(position), block('air', position));
        const support = position.offset(0, -1, 0);
        blocks.set(key(support), block('stone', support));
    }
    const bot = {
        entity: { id: 1, position: new Vec3(0.5, 64, 0.5) },
        entities: {
            1: { id: 1, position: new Vec3(0.5, 64, 0.5) },
            2: { id: 2, position: new Vec3(1.5, 64, 0.5) },
        },
        findBlocks() {
            return [occupied, available];
        },
        blockAt(position) {
            return blocks.get(key(position)) || block('air', position);
        },
    };

    assert.deepEqual(
        getNearestFreeSpaces(bot, 1, 8, { limit: 4 }),
        [available],
    );
});
