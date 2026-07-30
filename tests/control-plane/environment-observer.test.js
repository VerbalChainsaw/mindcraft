import assert from 'node:assert/strict';
import test from 'node:test';

import Vec3 from 'vec3';

import { EnvironmentObserver } from '../../src/agent/runtime/environment-observer.js';

test('Environment observer turns nearby player, entity, item, and structure changes into factual bounded events', () => {
  let now = 60_000;
  const events = [];
  const agent = {
    name: 'Observer',
    bot: {
      entity: { position: new Vec3(0, 64, 0) },
      players: {
        Alex: {
          username: 'Alex',
          entity: {
            id: 2,
            username: 'Alex',
            position: new Vec3(0, 64, 5),
            yaw: Math.PI,
          },
        },
      },
    },
    publishBehaviorEvent(event) {
      events.push(event);
    },
  };
  const observer = new EnvironmentObserver(agent, { now: () => now });

  observer.update();
  observer.observeEntityHurt({ id: 7, name: 'villager', position: new Vec3(3, 64, 0) });
  observer.observeEntityDead({ id: 8, name: 'zombie', position: new Vec3(4, 64, 0) });
  observer.observeEntitySpawn({
    id: 9,
    name: 'item',
    position: new Vec3(1, 64, 0),
    getDroppedItem: () => ({ name: 'diamond' }),
  });
  observer.observeBlockUpdate(
    { name: 'air', position: new Vec3(2, 64, 0) },
    { name: 'crafting_table', position: new Vec3(2, 64, 0) },
  );

  assert.deepEqual(events.map(event => event.type), [
    'player.approached',
    'player.looked',
    'entity.hurt',
    'entity.died',
    'observation.item',
    'observation.structure',
  ]);
  assert.equal(events.find(event => event.type === 'observation.item').target.name, 'diamond');
  assert.equal(events.every(event => event.salience >= 2 && event.salience <= 4), true);

  now += 500;
  observer.update();
  assert.equal(events.filter(event => event.type === 'player.looked').length, 1);
});
