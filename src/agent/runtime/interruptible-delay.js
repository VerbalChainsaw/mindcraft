// A skill that waits on a plain timer cannot notice an interrupt until that
// timer expires, so the *interrupted* skill sets the handoff latency rather
// than the interrupting event. ActionManager re-tests for release within a few
// milliseconds and re-issues the interrupt every 120ms, but a follow loop
// sampling every 200ms simply could not answer sooner than its own period.
//
// bot.interrupt_code is a plain boolean with no change notification, so the
// signal is carried on the bot's own emitter. Both writers of that flag live in
// Agent, which keeps the emit next to the assignment.
export const INTERRUPT_EVENT = 'mindcraft:interrupt';

export function signalInterrupt(bot) {
  try {
    bot?.emit?.(INTERRUPT_EVENT);
  } catch {
    // A detached or torn-down bot has nothing left to interrupt.
  }
}

/**
 * Wait for `milliseconds`, or until the bot is interrupted, whichever is first.
 * Resolves with 'elapsed' or 'interrupted'; it never rejects, so it is a
 * drop-in replacement for a bare setTimeout wait inside a skill loop.
 */
export function interruptibleDelay(bot, milliseconds) {
  const bounded = Math.max(0, Number(milliseconds) || 0);
  if (!bot || typeof bot.once !== 'function' || typeof bot.removeListener !== 'function') {
    return new Promise(resolve => setTimeout(() => resolve('elapsed'), bounded));
  }
  if (bot.interrupt_code) return Promise.resolve('interrupted');
  if (bounded <= 0) return Promise.resolve('elapsed');
  return new Promise(resolve => {
    let timer = null;
    const onInterrupt = () => finish('interrupted');
    function finish(reason) {
      if (timer) clearTimeout(timer);
      timer = null;
      try {
        bot.removeListener(INTERRUPT_EVENT, onInterrupt);
      } catch {
        // The emitter went away with the bot; nothing to detach.
      }
      resolve(reason);
    }
    bot.once(INTERRUPT_EVENT, onInterrupt);
    timer = setTimeout(() => finish('elapsed'), bounded);
  });
}

/**
 * Wait for a bot event, giving up after `timeoutMs`. Resolves with the event
 * name or 'timeout'; it never rejects. Used where a loop would otherwise poll
 * for a condition that already has an edge behind it.
 */
export function waitForBotEvent(bot, event, timeoutMs) {
  const bounded = Math.max(0, Number(timeoutMs) || 0);
  if (!bot || typeof bot.once !== 'function' || typeof bot.removeListener !== 'function') {
    return new Promise(resolve => setTimeout(() => resolve('timeout'), bounded));
  }
  return new Promise(resolve => {
    let timer = null;
    const onEvent = () => finish(event);
    function finish(reason) {
      if (timer) clearTimeout(timer);
      timer = null;
      try {
        bot.removeListener(event, onEvent);
      } catch {
        // The emitter went away with the bot; nothing to detach.
      }
      resolve(reason);
    }
    bot.once(event, onEvent);
    timer = setTimeout(() => finish('timeout'), bounded);
  });
}
