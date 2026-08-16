import assert from 'node:assert/strict';
import test from 'node:test';

import { observeWorldModificationAuthority } from '../../src/agent/runtime/world-modification-authority.js';

function siteBot({ crafted = null, unloaded = false } = {}) {
  return {
    blockAt(position) {
      if (unloaded && position.x === 3) return null;
      const name = crafted && position.x === crafted.x && position.y === crafted.y && position.z === crafted.z
        ? crafted.name
        : position.y < 64 ? 'dirt' : 'air';
      return { name, boundingBox: name === 'air' ? 'empty' : 'block' };
    },
  };
}

test('nearby manufactured blocks protect a natural-looking courtyard floor', () => {
  const authority = observeWorldModificationAuthority(
    siteBot({ crafted: { name: 'oak_planks', x: 2, y: 63, z: 0 } }),
    { x: 0, y: 64, z: 0 },
    { purpose: 'emergency_shelter', mutation: 'excavate' },
  );

  assert.equal(authority.allowed, false);
  assert.equal(authority.code, 'protected_site');
  assert.equal(authority.site.evidence[0].name, 'oak_planks');
});

test('fully loaded natural terrain grants bounded local mutation authority', () => {
  const authority = observeWorldModificationAuthority(
    siteBot(),
    { x: 0, y: 64, z: 0 },
    { purpose: 'emergency_shelter', mutation: 'excavate' },
  );

  assert.equal(authority.allowed, true);
  assert.equal(authority.code, 'natural_site_authorized');
});

test('unloaded site evidence fails closed', () => {
  const authority = observeWorldModificationAuthority(
    siteBot({ unloaded: true }),
    { x: 0, y: 64, z: 0 },
    { purpose: 'resource_collection', mutation: 'harvest_tree' },
  );

  assert.equal(authority.allowed, false);
  assert.equal(authority.code, 'site_authority_unknown');
});
