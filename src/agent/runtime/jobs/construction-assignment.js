import Vec3 from 'vec3';
import {
  fixtureOrientationStances,
  isClearableWorksiteBlock,
  probeSafeNavigationStances,
} from '../../library/skills.js';
import { createWorkOrder } from '../work-order.js';
import {
  selectConstructionSites,
  selectOppositeLandmarkLayoutSites,
} from './structure-site-selector.js';

function canonicalDimension(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^minecraft:/, '');
}

/**
 * Bind a validated blueprint to one exact, loaded, naturally supported site.
 * Both chat commands and Agenda catalogue construction use this single owner;
 * neither path may invent a site or bypass native Pathfinder route proof.
 */
export function bindSafeConstructionOrder(agent, order, origin, constructionIntent = null) {
  const intent = constructionIntent
    || agent.agenda_director?.activeConstructionIntent?.()?.constructionIntent
    || null;
  const siteConstraint = intent?.siteConstraint || null;
  const layoutConstraint = intent?.layoutConstraint || null;
  const currentDimension = canonicalDimension(agent.bot?.game?.dimension);
  const constrainedDimension = canonicalDimension(siteConstraint?.dimension);
  if (siteConstraint && (!currentDimension || currentDimension !== constrainedDimension)) {
    throw new TypeError(
      `The named construction landmark ${siteConstraint.name.replaceAll('_', ' ')} is in ${constrainedDimension || 'an unknown dimension'}, not the bot's current dimension.`,
    );
  }
  const isNaturalTerrain = block => isClearableWorksiteBlock(agent.bot, block);
  const relational = layoutConstraint?.arrangement === 'opposite_sides';
  const selection = relational
    ? selectOppositeLandmarkLayoutSites(agent.bot, order.blueprint, {
        landmark: siteConstraint.position,
        clearance: layoutConstraint.clearance,
        isNaturalTerrain,
      })
    : selectConstructionSites(agent.bot, order.blueprint, {
        origin: siteConstraint?.position || origin,
        ...(siteConstraint ? { radius: siteConstraint.radius } : {}),
        isNaturalTerrain,
      });
  const directions = {
    north: { x: 0, y: 0, z: -1 },
    south: { x: 0, y: 0, z: 1 },
    east: { x: 1, y: 0, z: 0 },
    west: { x: -1, y: 0, z: 0 },
  };
  const probed = selection.sites.map(site => {
    if (!relational) {
      return { site, routes: [probeSafeNavigationStances(agent.bot, site.stances)] };
    }
    const routes = site.blueprint.fixtures.map(fixture => {
      const anchor = new Vec3(
        site.origin.x + fixture.anchor.x,
        site.origin.y + fixture.anchor.y,
        site.origin.z + fixture.anchor.z,
      );
      const stances = fixtureOrientationStances(agent.bot, anchor, directions[fixture.facing]);
      return probeSafeNavigationStances(agent.bot, stances);
    });
    return { site, routes };
  });
  const selected = probed.find(candidate => candidate.routes.every(route => route.reachable));
  const site = selected?.site;
  if (!site) {
    const methodRejected = route => (
      route?.reachable !== true
      && route?.conclusive === true
      && route?.status === 'noPath'
    );
    const unproven = probed.filter(candidate => (
      candidate.routes.some(route => route?.reachable !== true)
      && candidate.routes.every(route => !methodRejected(route))
    ));
    if (unproven.length > 0) {
      const statuses = [...new Set(unproven
        .flatMap(candidate => candidate.routes)
        .filter(route => route?.reachable !== true)
        .map(route => route?.status || 'unknown'))];
      throw new TypeError(
        `Native Pathfinder route checks did not finish for ${unproven.length} geometrically safe construction candidate(s) (${statuses.join(', ')}). No construction site was bound; retry the request.`,
      );
    }
    const routeSummary = probed.length > 0
      ? ` Native Pathfinder completed route checks and rejected ${probed.length} geometrically safe candidate(s): ${[...new Set(probed
          .flatMap(candidate => candidate.routes.map(route => route.status || 'unknown')))]
          .join(', ')}.`
      : '';
    throw new TypeError(
      relational
        ? `No clear, supported, natively reachable opposite-side fixture layout is loaded around ${siteConstraint.name.replaceAll('_', ' ')} after checking ${selection.inspected} bounded axes (${selection.code}).${routeSummary}`
        : siteConstraint
          ? `No clear, naturally supported, non-destructively reachable construction footprint is loaded ${siteConstraint.relation} ${siteConstraint.name.replaceAll('_', ' ')} after checking ${selection.inspected} bounded candidates.${routeSummary}`
          : `No clear, naturally supported, non-destructively reachable construction footprint is loaded near the bot after checking ${selection.inspected} bounded candidates.${routeSummary}`,
    );
  }
  return createWorkOrder({
    ...order,
    blueprint: site.blueprint || order.blueprint,
    target: {
      ...order.target,
      x: site.origin.x,
      y: site.origin.y,
      z: site.origin.z,
    },
  });
}
