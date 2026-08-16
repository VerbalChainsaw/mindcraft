const STANDING_DIRECTIVES = new Set(['follow', 'guard']);

function standingDirective(value) {
  const directive = String(value || '').toLowerCase();
  return STANDING_DIRECTIVES.has(directive) ? directive : null;
}

function sameDirectiveIdentity(left, right) {
  if (!left || !right) return false;
  const leftDirective = standingDirective(left.directive);
  const rightDirective = standingDirective(right.directive);
  const leftPlayer = String(left.canonicalUsername || '').trim().toLowerCase();
  const rightPlayer = String(right.canonicalUsername || '').trim().toLowerCase();
  return Boolean(
    leftDirective
    && rightDirective
    && leftDirective === rightDirective
    && leftPlayer
    && leftPlayer === rightPlayer
    && (left.authorizedAt ?? left.directiveAuthorizedAt ?? null)
      === (right.authorizedAt ?? right.directiveAuthorizedAt ?? null)
  );
}

function decision(intent, code, reason, rejected = [], detail = {}) {
  return Object.freeze({
    intent,
    code,
    reason,
    rejected: Object.freeze(rejected.map(item => Object.freeze({ ...item }))),
    ...detail,
  });
}

/**
 * Pure policy for the first migrated companion-continuity edge. It chooses
 * among already-supported capabilities; it never observes the world, mutates
 * runtime state, schedules work, or infers success.
 */
export function chooseCompanionAction(snapshot = {}) {
  const directive = standingDirective(snapshot.directive?.directive);
  if (!directive) {
    return decision(
      'continue_existing_policy',
      'standing_directive_absent',
      'The migrated policy does not own this decision because no standing follow or guard promise exists.',
    );
  }

  if (snapshot.operatorHeld === true || snapshot.runtimeStopped === true || snapshot.dead === true) {
    return decision(
      'hold',
      snapshot.dead === true ? 'body_unavailable' : 'operator_authority',
      'A stopped, held, or dead body cannot continue the standing directive.',
      [{ intent: 'resume_directive', code: 'body_not_authorized' }],
    );
  }

  const rawThreatId = snapshot.threat?.entityId;
  const threatId = rawThreatId === null || rawThreatId === undefined || rawThreatId === ''
    ? Number.NaN
    : Number(rawThreatId);
  const hasAttributedThreat = Number.isFinite(threatId)
    && ['protected_player', 'self_damage'].includes(snapshot.threat?.attribution);

  if (hasAttributedThreat) {
    if (snapshot.recoveryOwnsThreat === true) {
      return decision(
        'yield_safety_recovery',
        'safety_recovery_owns_threat',
        'The existing safety incident must settle before combat or follow can reclaim the body.',
        [
          { intent: 'protect', code: 'same_threat_already_disengaged' },
          { intent: 'resume_directive', code: 'safety_unresolved' },
        ],
        { targetEntityId: threatId },
      );
    }
    if (snapshot.tacticalEligible !== true) {
      return decision(
        'wait_material_change',
        snapshot.tacticalCode || 'tactical_evidence_unchanged',
        'The last tactical response failed and no material Minecraft evidence authorizes the same attempt.',
        [
          { intent: 'retreat', code: 'unchanged_failed_tactical' },
          { intent: 'protect', code: 'unchanged_failed_tactical' },
          { intent: 'resume_directive', code: 'attributed_threat_unresolved' },
        ],
        { targetEntityId: threatId },
      );
    }
    if (snapshot.retreatRequired === true) {
      return decision(
        'retreat',
        'critical_self_preservation',
        'Recent attributed damage makes disengagement safer than continuing combat or follow.',
        [
          { intent: 'protect', code: 'critical_self_preservation_first' },
          { intent: 'resume_directive', code: 'attributed_threat_unresolved' },
        ],
        { targetEntityId: threatId },
      );
    }
    return decision(
      'protect',
      'attributed_protection',
      'A loaded, attributable threat can be handled by the existing tactical-combat capability.',
      [{ intent: 'resume_directive', code: 'attributed_threat_unresolved' }],
      { targetEntityId: threatId },
    );
  }

  if (snapshot.resumeRequested === true) {
    if (!sameDirectiveIdentity(snapshot.resumeRequest, snapshot.directive)) {
      return decision(
        'cancel_stale_resume',
        'directive_identity_changed',
        'The standing promise changed after the interruption, so the old continuation has no authority.',
        [{ intent: 'resume_directive', code: 'stale_directive_identity' }],
      );
    }
    if (snapshot.safetyIncidentActive === true) {
      return decision(
        'yield_safety_recovery',
        'safety_incident_unsettled',
        'Safety recovery remains unsettled, so exact continuation must wait.',
        [{ intent: 'resume_directive', code: 'safety_unresolved' }],
      );
    }
    if (
      snapshot.directiveSettlement?.active === true
      && snapshot.directiveSettlement?.state !== 'changed'
    ) {
      const settlementState = snapshot.directiveSettlement?.state === 'unchanged'
        ? 'unchanged'
        : 'unknown';
      return decision(
        'wait_material_change',
        snapshot.directiveSettlement?.code || `directive_material_change_${settlementState}`,
        settlementState === 'unchanged'
          ? 'The preserved standing promise is waiting for a material Minecraft change before it can safely resume.'
          : 'The preserved standing promise lacks the evidence needed to prove that its blocker changed.',
        [{ intent: 'resume_directive', code: `directive_blocker_${settlementState}` }],
      );
    }
    if (snapshot.bodyIdle !== true) {
      return decision(
        'wait_body_release',
        'body_owner_active',
        'The current serialized action must settle before the standing promise resumes.',
        [{ intent: 'resume_directive', code: 'body_owner_active' }],
      );
    }
    if (snapshot.directive?.presence !== 'present') {
      return decision(
        'reacquire_player',
        'companion_not_present',
        'The exact companion must be authoritatively reacquired before follow can resume.',
        [{ intent: 'resume_directive', code: 'companion_not_present' }],
      );
    }
    return decision(
      'resume_directive',
      'exact_directive_resume',
      'The interruption settled and the exact preserved standing promise can resume once.',
    );
  }

  return decision(
    'continue_existing_policy',
    'no_migrated_edge_active',
    'No attributed interruption or authorized continuation currently needs the migrated policy.',
  );
}

export { sameDirectiveIdentity };
