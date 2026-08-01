import assert from 'node:assert/strict';
import test from 'node:test';
import Vec3 from 'vec3';

import {
    assessStableMiningCollectionTarget,
    findStableMiningCollectionCandidates,
} from '../src/agent/library/skills.js';

function block(name, x, y, z, boundingBox = name === 'air' ? 'empty' : 'block') {
    return {
        name,
        boundingBox,
        position: new Vec3(x, y, z),
    };
}

function fixture({ supported }) {
    const target = block('stone', 0, 64, 0);
    const blocks = new Map();
    const put = value => blocks.set(`${value.position.x}:${value.position.y}:${value.position.z}`, value);
    put(target);
    if (supported) put(block('stone', 0, 63, 0));
    put(block('stone', 1, 63, 0));
    return {
        target,
        bot: {
            entity: {
                eyeHeight: 1.6,
                position: new Vec3(1.5, 64, 0.5),
            },
            blockAt(position) {
                return blocks.get(`${position.x}:${position.y}:${position.z}`)
                    || block('air', position.x, position.y, position.z);
            },
            world: {
                raycast() {
                    return { position: target.position, face: 1 };
                },
            },
        },
    };
}

test('natural mining requires recoverable drop support and a stance not supported by the target', () => {
    const unsupported = fixture({ supported: false });
    assert.deepEqual(
        assessStableMiningCollectionTarget(unsupported.bot, unsupported.target),
        {
            safe: false,
            code: 'unsafe_drop_support',
            dropDepth: null,
            stances: [],
        },
    );

    const supported = fixture({ supported: true });
    const assessment = assessStableMiningCollectionTarget(supported.bot, supported.target);
    assert.equal(assessment.safe, true);
    assert.equal(assessment.code, 'safe_stance_available');
    assert.equal(assessment.dropDepth, 0);
    assert.ok(assessment.stances.length > 0);
    assert.ok(assessment.stances.every(position => !(
        position.x === supported.target.position.x
        && position.y - 1 === supported.target.position.y
        && position.z === supported.target.position.z
    )));
});

test('nearer unsupported blocks cannot hide a supported mining target from the bounded candidate pool', () => {
    const candidates = Array.from({ length: 60 }, (_, index) => block('stone', index, 64, 0));
    const supported = block('stone', 60, 64, 0);
    candidates.push(supported);
    const blocks = new Map(candidates.map(value => [
        `${value.position.x}:${value.position.y}:${value.position.z}`,
        value,
    ]));
    blocks.set('60:63:0', block('stone', 60, 63, 0));
    const bot = {
        findBlocks({ matching, count }) {
            return candidates
                .filter(candidate => matching(candidate))
                .slice(0, count)
                .map(candidate => candidate.position);
        },
        blockAt(position) {
            return blocks.get(`${position.x}:${position.y}:${position.z}`)
                || block('air', position.x, position.y, position.z);
        },
    };

    const selected = findStableMiningCollectionCandidates(bot, value => value.name === 'stone', 64);
    assert.deepEqual(selected.map(value => value.position), [supported.position]);
});
