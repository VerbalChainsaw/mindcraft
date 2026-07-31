import { node } from './utils.js';

// The runtime has been publishing the bot's reasoning for a while — which lane
// owns the tick, what it is planning, where it has been, what it is working
// toward — and nothing in the dashboard ever read it. This module renders that
// state and nothing else, so it stays cheap to move when the layout changes.

const LANE_LABEL = Object.freeze({
  emergency_self_preservation: 'Emergency — saving itself',
  attributed_protection: 'Defending',
  bounded_recovery: 'Getting unstuck',
  basic_survival: 'Survival upkeep',
  comportment_pause: 'Pausing (persona)',
  player_directive: 'Following your directive',
  player_goal: 'Working your goal',
  player_job: 'Working your job order',
  role_work: 'Doing its role work',
  self_progression: 'Advancing itself',
  opportunity: 'Noticing something nearby',
  factual_reaction: 'Reacting',
  idle_embodiment: 'Idling',
  self_prompt: 'Self-directed',
  operator_hold: 'Held by Stop',
  degraded: 'Degraded',
  idle: 'Idle',
  initializing: 'Starting up',
  stopped: 'Stopped',
});

const URGENCY_TONE = Object.freeze({ critical: 'error-copy', elevated: 'warning-copy', calm: '' });

function readable(value) {
  return String(value || '').replace(/_/g, ' ').trim();
}

function statRow(label, value, tone = '') {
  const row = node('div', 'telemetry-row');
  row.append(node('div', 'telemetry-label', label), node('div', `telemetry-value ${tone}`.trim(), value));
  return row;
}

function panel(title, subtitle = '') {
  const section = node('section', 'panel bot-brain-panel');
  section.append(node('h3', 'panel-title', title));
  if (subtitle) section.append(node('div', 'summary-detail', subtitle));
  return section;
}

/** What the bot is thinking right now: which lane won, and how urgent it is. */
export function renderThinking(state) {
  const arbiter = state?.action?.behaviorArbiter;
  if (!arbiter) return null;
  const section = panel('Thinking', 'Which behavior lane owns this moment.');
  const lane = LANE_LABEL[arbiter.selectedLane] || readable(arbiter.selectedLane) || 'Unknown';
  section.append(statRow('Now', lane));
  section.append(statRow('Because', arbiter.reason || arbiter.code || 'No reason reported.'));
  if (arbiter.urgency) {
    section.append(statRow('Urgency', readable(arbiter.urgency), URGENCY_TONE[arbiter.urgency] || ''));
  }
  if (Number.isFinite(arbiter.nextTickDelayMs)) {
    section.append(statRow('Re-checking in', `${arbiter.nextTickDelayMs} ms`));
  }
  if (arbiter.comportment) section.append(statRow('Persona', readable(arbiter.comportment)));
  if (arbiter.perceptionFreshness) {
    section.append(statRow(
      'Perception',
      arbiter.perceptionAge === null ? readable(arbiter.perceptionFreshness) : `${readable(arbiter.perceptionFreshness)} · ${arbiter.perceptionAge} ms old`,
      arbiter.perceptionFreshness === 'stale' ? 'warning-copy' : '',
    ));
  }
  if (arbiter.perceptionError) section.append(statRow('Perception problem', arbiter.perceptionError, 'error-copy'));
  return section;
}

/** The queued plan, so a multi-step request is visible instead of implied. */
export function renderAgenda(state, { onSkip = null, onClear = null } = {}) {
  const agenda = state?.agenda;
  if (!agenda) return null;
  const section = panel('Plan', 'Steps queued from plain-language requests.');

  if (agenda.active) {
    section.append(statRow('Running', agenda.active.description));
  }
  if (Array.isArray(agenda.queue) && agenda.queue.length) {
    const list = node('ol', 'bot-brain-queue');
    for (const entry of agenda.queue) list.append(node('li', '', entry.description));
    section.append(node('div', 'telemetry-label', 'Next'), list);
  }
  if (!agenda.active && !agenda.remaining) {
    section.append(node('div', 'empty-state compact', 'No plan queued. Ask for several things at once and they will stack up here.'));
  }
  if (Array.isArray(agenda.recent) && agenda.recent.length) {
    const done = node('ul', 'bot-brain-recent');
    for (const entry of agenda.recent) {
      done.append(node('li', entry.state === 'complete' ? 'ok-copy' : 'warning-copy', `${entry.description} — ${entry.state}`));
    }
    section.append(node('div', 'telemetry-label', 'Recently finished'), done);
  }
  if (agenda.error) section.append(statRow('Plan storage', agenda.error, 'error-copy'));

  if (onSkip || onClear) {
    const controls = node('div', 'panel-actions');
    if (onSkip) controls.append(onSkip);
    if (onClear) controls.append(onClear);
    section.append(controls);
  }
  return section;
}

/** Long-term progression: what it is working toward on its own. */
export function renderProgression(state) {
  const progression = state?.action?.progressionDirector || state?.progression;
  if (!progression) return null;
  const section = panel('Progress', 'What it is working toward without being asked.');
  const stage = progression.stage || progression.currentStage;
  const next = progression.nextMilestone;
  if (stage) section.append(statRow('Stage', readable(stage)));
  if (next) section.append(statRow('Next milestone', next));
  const done = progression.completedMilestones ?? progression.completed;
  const total = progression.totalMilestones ?? progression.total;
  if (Number.isFinite(done) && Number.isFinite(total)) {
    section.append(statRow('Milestones', `${done} of ${total}`));
  }
  if (progression.detail) section.append(statRow('Detail', progression.detail));
  if (Number.isFinite(progression.consecutiveFailures) && progression.consecutiveFailures > 0) {
    section.append(statRow('Stuck attempts', String(progression.consecutiveFailures), 'warning-copy'));
  }
  return section;
}

/** Spatial recall: the places it can actually return to. */
export function renderMemory(state) {
  const landmarks = state?.landmarks;
  const experienceLevel = state?.gameplay?.experienceLevel;
  if (!landmarks && !Number.isFinite(experienceLevel)) return null;
  const section = panel('Memory', 'Places it can return to, and what it has banked.');

  if (Number.isFinite(experienceLevel)) {
    section.append(statRow('Experience', `Level ${experienceLevel}`));
  }
  if (landmarks) {
    section.append(statRow('Places remembered', String(landmarks.tracked ?? 0)));
    const byCategory = landmarks.byCategory && typeof landmarks.byCategory === 'object'
      ? Object.entries(landmarks.byCategory)
      : [];
    if (byCategory.length) {
      section.append(statRow('By kind', byCategory.map(([kind, count]) => `${readable(kind)} ${count}`).join(' · ')));
    }
    if (Array.isArray(landmarks.recent) && landmarks.recent.length) {
      const list = node('ul', 'bot-brain-recent');
      for (const entry of landmarks.recent.slice(0, 6)) {
        list.append(node('li', '', `${readable(entry.name)} at ${entry.x}, ${entry.y}, ${entry.z}`));
      }
      section.append(node('div', 'telemetry-label', 'Last seen'), list);
    }
    if (!landmarks.tracked) {
      section.append(node('div', 'empty-state compact', 'Nothing remembered yet. It records ore, workstations, beds, and portals as it sees them.'));
    }
    if (landmarks.error) section.append(statRow('Memory storage', landmarks.error, 'error-copy'));
  }
  return section;
}

/**
 * Everything above, in the order a person asks it: what are you doing, what is
 * the plan, where are you headed, what do you know.
 */
export function renderBotBrain(state, controls = {}) {
  const sections = [
    renderThinking(state),
    renderAgenda(state, controls),
    renderProgression(state),
    renderMemory(state),
  ].filter(Boolean);
  if (!sections.length) return null;
  const wrapper = node('div', 'bot-brain');
  for (const section of sections) wrapper.append(section);
  return wrapper;
}
