import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

const EVENT_TYPES = new Set([
  'player.joined',
  'player.left',
  'player.approached',
  'player.returned',
  'player.looked',
  'player.order',
  'self.damaged',
  'self.died',
  'entity.hurt',
  'entity.died',
  'threat.detected',
  'threat.cleared',
  'action.completed',
  'action.failed',
  'survival.changed',
  'job.changed',
  'job.completed',
  'goal.changed',
  'goal.completed',
  'time.sunrise',
  'time.sunset',
  'weather.changed',
  'squad.order',
  'squad.warning',
  'squad.request',
  'squad.completion',
  'observation.item',
  'observation.structure',
  'observation.terrain',
]);
const SAFE_IDENTIFIER = /^[A-Za-z0-9_.:-]{1,96}$/;
const SAFE_NAME = /^[A-Za-z0-9_. -]{0,64}$/;
const EVIDENCE_FIELDS = new Set([
  'workOrderId',
  'goalId',
  'procedureId',
  'actionId',
  'code',
  'phase',
  'amount',
  'sourceName',
  'sourceEntityId',
]);

function boundedName(value, label) {
  const text = String(value || '').trim();
  // eslint-disable-next-line no-control-regex -- Event names cross bot and dashboard boundaries.
  if (!SAFE_NAME.test(text) || /[\u0000-\u001f\u007f]/.test(text)) {
    throw new TypeError(`${label} is invalid.`);
  }
  return text;
}

function normalizeTarget(raw) {
  if (raw == null) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('Event target is invalid.');
  const target = {};
  if (raw.name !== undefined) target.name = boundedName(raw.name, 'Target name');
  if (raw.type !== undefined) target.type = boundedName(raw.type, 'Target type');
  for (const field of ['x', 'y', 'z', 'distance']) {
    if (raw[field] !== undefined) {
      if (!Number.isFinite(raw[field])) throw new TypeError(`Event target coordinate '${field}' is invalid.`);
      target[field] = Number(raw[field].toFixed(2));
    }
  }
  return Object.freeze(target);
}

function normalizeEvidence(raw) {
  if (raw == null) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw instanceof Error) {
    throw new TypeError('Event evidence is invalid.');
  }
  for (const key of Object.keys(raw)) {
    if (!EVIDENCE_FIELDS.has(key)) throw new TypeError(`Event evidence field '${key}' is not allowed.`);
  }
  const evidence = {};
  for (const key of ['workOrderId', 'goalId', 'procedureId', 'actionId', 'code', 'phase']) {
    if (raw[key] !== undefined) {
      const value = String(raw[key] || '').trim().slice(0, 96);
      if (value && !SAFE_IDENTIFIER.test(value)) throw new TypeError(`Event evidence '${key}' is invalid.`);
      evidence[key] = value;
    }
  }
  if (raw.sourceName !== undefined) evidence.sourceName = boundedName(raw.sourceName, 'Evidence source name');
  if (raw.sourceEntityId !== undefined) {
    if (!Number.isFinite(raw.sourceEntityId)) throw new TypeError('Event evidence source entity id is invalid.');
    evidence.sourceEntityId = Math.floor(raw.sourceEntityId);
  }
  if (raw.amount !== undefined) {
    if (!Number.isFinite(raw.amount)) throw new TypeError('Event evidence amount is invalid.');
    evidence.amount = Math.max(0, Math.min(2304, Math.floor(raw.amount)));
  }
  return Object.freeze(evidence);
}

function generatedId(type, actor, target, timestamp) {
  const bucket = Math.floor(timestamp / 1000);
  return createHash('sha256')
    .update(JSON.stringify({ type, actor, target, bucket }))
    .digest('hex')
    .slice(0, 24);
}

export function normalizeBehaviorEvent(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('Behavior event must be an object.');
  const type = String(raw.type || '').trim();
  if (!EVENT_TYPES.has(type)) throw new TypeError('Behavior event type is unknown.');
  const actor = boundedName(raw.actor, 'Event actor');
  const target = normalizeTarget(raw.target);
  const evidence = normalizeEvidence(raw.evidence);
  const timestamp = Number.isFinite(raw.timestamp) ? raw.timestamp : Date.now();
  const salience = Math.max(0, Math.min(5, Math.floor(Number(raw.salience) || 0)));
  const suppliedId = String(raw.id || '').trim();
  const id = suppliedId || generatedId(type, actor, target, timestamp);
  if (!SAFE_IDENTIFIER.test(id)) throw new TypeError('Behavior event id is invalid.');
  const witnesses = Object.freeze(
    [...new Set((Array.isArray(raw.witnesses) ? raw.witnesses : [])
      .slice(0, 32)
      .map(value => boundedName(value, 'Event witness'))
      .filter(Boolean))],
  );
  return Object.freeze({
    id,
    type,
    actor,
    target,
    evidence,
    salience,
    timestamp,
    witnesses,
  });
}

export class BehaviorEventBus extends EventEmitter {
  constructor(actor = '', { maxQueue = 128, maxSeen = 512 } = {}) {
    super();
    this.actor = boundedName(actor, 'Event actor');
    this.maxQueue = Math.max(1, Math.min(256, Math.floor(maxQueue)));
    this.maxSeen = Math.max(this.maxQueue, Math.min(2048, Math.floor(maxSeen)));
    this.queue = [];
    this.seen = new Set();
    this.seenOrder = [];
  }

  publish(raw) {
    const event = normalizeBehaviorEvent({ actor: this.actor, ...raw });
    if (this.seen.has(event.id)) return false;
    this.seen.add(event.id);
    this.seenOrder.push(event.id);
    while (this.seenOrder.length > this.maxSeen) this.seen.delete(this.seenOrder.shift());
    this.queue.push(event);
    while (this.queue.length > this.maxQueue) this.queue.shift();
    this.emit('event', event);
    return true;
  }

  drain(limit = 16) {
    const count = Math.max(0, Math.min(this.queue.length, Math.floor(limit)));
    return this.queue.splice(0, count);
  }

  supersedeActionFailures(actionIds = []) {
    const ids = new Set(
      (Array.isArray(actionIds) ? actionIds : [])
        .slice(0, 64)
        .map(value => String(value || '').trim())
        .filter(value => SAFE_IDENTIFIER.test(value)),
    );
    if (ids.size === 0) return 0;
    const before = this.queue.length;
    this.queue = this.queue.filter(event => !(
      event.type === 'action.failed'
      && ids.has(event.evidence?.actionId)
    ));
    return before - this.queue.length;
  }
}
