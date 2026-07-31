// Comportment is how a bot *carries itself*, not what it is allowed to do.
// Authority still comes from role + autonomy; these knobs only shape pacing,
// hesitation, idle embodiment, persistence, and appetite slack so the same
// gameplay brain can read as a deliberate worker or as a casual human player.
//
// `neutral` is the default and is byte-for-byte the pre-comportment behavior:
// no hesitation, unscaled cadence, idle embodiment on, no policy bias. Every
// other preset is opt-in through `profile.runtime.comportment`.
const PRESETS = Object.freeze({
  neutral: Object.freeze({
    label: 'Neutral',
    cadenceScale: 1.00,
    decisionDelayMs: Object.freeze([0, 0]),
    actionGapMs: Object.freeze([0, 0]),
    idleEmbodiment: true,
    recoveryAttemptBias: 0,
    hungerSlack: 0,
    reactionMode: null,
  }),
  npc_precise: Object.freeze({
    label: 'Precise worker',
    cadenceScale: 0.80,
    decisionDelayMs: Object.freeze([0, 0]),
    actionGapMs: Object.freeze([0, 0]),
    idleEmbodiment: false,
    recoveryAttemptBias: 2,
    hungerSlack: 0,
    reactionMode: 'minimal',
  }),
  npc_steady: Object.freeze({
    label: 'Steady worker',
    cadenceScale: 0.90,
    decisionDelayMs: Object.freeze([40, 110]),
    actionGapMs: Object.freeze([60, 160]),
    idleEmbodiment: false,
    recoveryAttemptBias: 1,
    hungerSlack: 0,
    reactionMode: 'minimal',
  }),
  human_focused: Object.freeze({
    label: 'Focused player',
    cadenceScale: 1.00,
    decisionDelayMs: Object.freeze([110, 260]),
    actionGapMs: Object.freeze([140, 380]),
    idleEmbodiment: true,
    recoveryAttemptBias: 0,
    hungerSlack: 2,
    reactionMode: 'natural',
  }),
  human_casual: Object.freeze({
    label: 'Casual player',
    cadenceScale: 1.35,
    decisionDelayMs: Object.freeze([200, 480]),
    actionGapMs: Object.freeze([350, 950]),
    idleEmbodiment: true,
    recoveryAttemptBias: -1,
    hungerSlack: 4,
    reactionMode: 'natural',
  }),
});

const PRESET_NAMES = new Set(Object.keys(PRESETS));
const MAX_PAUSE_MS = 2_000;

function presetName(value) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .slice(0, 32);
  return PRESET_NAMES.has(normalized) ? normalized : '';
}

function boundedNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(number)));
}

// A range is accepted as [lo, hi], as a single number meaning [n, n], or as
// {min, max}. Anything malformed falls back to the preset range rather than
// throwing, because comportment must never be able to stop a bot from spawning.
function boundedRange(value, fallback) {
  let low;
  let high;
  if (Array.isArray(value)) {
    low = value[0];
    high = value[1];
  } else if (value && typeof value === 'object') {
    low = value.min;
    high = value.max;
  } else if (Number.isFinite(Number(value))) {
    low = value;
    high = value;
  } else {
    return fallback;
  }
  if (!Number.isFinite(Number(low)) && !Number.isFinite(Number(high))) return fallback;
  const lowMs = boundedInteger(low, fallback[0], 0, MAX_PAUSE_MS);
  const highMs = boundedInteger(high, fallback[1], 0, MAX_PAUSE_MS);
  return Object.freeze(lowMs <= highMs ? [lowMs, highMs] : [highMs, lowMs]);
}

/**
 * Accepts a preset name, or an object carrying `preset` plus per-field
 * overrides. Always returns a frozen profile; never throws. When nothing is
 * requested the result is the neutral profile and `explicit` is false, which
 * keeps every pre-existing bot profile behaving exactly as before.
 */
export function normalizeComportment(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const requested = typeof raw === 'string' ? raw : source.preset ?? source.mode ?? source.kind;
  const selected = presetName(requested) || 'neutral';
  const preset = PRESETS[selected];
  const explicit = selected !== 'neutral';

  return Object.freeze({
    schemaVersion: 1,
    preset: selected,
    explicit,
    label: preset.label,
    // Multiplies the arbiter's non-urgent tick period. Urgent lanes ignore it.
    cadenceScale: boundedNumber(source.cadenceScale, preset.cadenceScale, 0.5, 3),
    // Hesitation after the bot becomes free, before it claims new work.
    decisionDelayMs: boundedRange(source.decisionDelayMs, preset.decisionDelayMs),
    // Additional dwell after a completed action, on top of the decision delay.
    actionGapMs: boundedRange(source.actionGapMs, preset.actionGapMs),
    // Cosmetic looking-around and personal-space stepping.
    idleEmbodiment: typeof source.idleEmbodiment === 'boolean'
      ? source.idleEmbodiment
      : preset.idleEmbodiment,
    // Folded into runtime.limits.maxRecoveryAttempts: workers grind, humans quit.
    recoveryAttemptBias: boundedInteger(source.recoveryAttemptBias, preset.recoveryAttemptBias, -3, 3),
    // Folded into runtime.survival.eatAt: humans eat later than they should.
    hungerSlack: boundedInteger(source.hungerSlack, preset.hungerSlack, 0, 8),
    // Seeds runtime.reactions.mode when the profile does not state one.
    reactionMode: preset.reactionMode,
  });
}

/**
 * Bounded hesitation in milliseconds. `random` is injectable so pacing is
 * deterministic under test; production passes Math.random.
 */
export function comportmentPauseMs(comportment, { afterAction = false, random = Math.random } = {}) {
  if (!comportment) return 0;
  const decision = comportment.decisionDelayMs || [0, 0];
  const gap = afterAction ? (comportment.actionGapMs || [0, 0]) : [0, 0];
  const low = decision[0] + gap[0];
  const high = decision[1] + gap[1];
  if (high <= 0) return 0;
  let roll;
  try {
    roll = Number(random());
  } catch {
    roll = 0.5;
  }
  if (!Number.isFinite(roll)) roll = 0.5;
  const clamped = Math.min(1, Math.max(0, roll));
  return Math.min(MAX_PAUSE_MS, Math.round(low + ((high - low) * clamped)));
}

export const COMPORTMENT_PRESETS = PRESETS;
