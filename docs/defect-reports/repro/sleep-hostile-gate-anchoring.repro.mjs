// Repro: the pre-sleep hostile gate measures distance from the BOT, not the BED.
// Drives the real skills.goToBed via the exactPosition path (= !goToBedAt, the
// build-then-sleep campaign path bound by agenda-director structure_fixture).
const { goToBed } = await import('../../../src/agent/library/skills.js');

function position(x, y, z) {
  return { x, y, z, distanceTo: o => Math.hypot(x - o.x, y - o.y, z - o.z) };
}

// Campaign geometry: bot finishes construction 30 blocks from the outpost bed.
// A hostile stands 3 blocks from the BED (unsafe by vanilla's ~8-block rule)
// but 33 blocks from the BOT (safe by the code's bot-relative rule).
const BED = position(30, 64, 0);
const BOT = position(0, 64, 0);
const HOSTILE = position(33, 64, 0);

let sleepAttempted = false;
let hostileDistanceAtSleepTime = null;

const bot = {
  interrupt_code: false,
  isSleeping: false,
  entity: { position: BOT },
  modes: { pause() {} },
  game: { dimension: 'overworld' },
  blockAt: () => ({ name: 'red_bed', position: BED }),
  nearestEntity: () => ({ position: HOSTILE }),
  sleep() {
    sleepAttempted = true;
    // Vanilla rejects when hostiles are within ~8 blocks OF THE BED.
    hostileDistanceAtSleepTime = HOSTILE.distanceTo(BED);
    if (hostileDistanceAtSleepTime <= 8) {
      throw new Error('You may not rest now, there are monsters nearby');
    }
    this.isSleeping = true;
  },
  wake() { this.isSleeping = false; },
};

console.log('hostile -> bot :', HOSTILE.distanceTo(BOT).toFixed(1), '(code gate: must be > 12)');
console.log('hostile -> bed :', HOSTILE.distanceTo(BED).toFixed(1), '(vanilla rule: must be > ~8)');

const result = await goToBed(bot, {
  exactPosition: { x: BED.x, y: BED.y, z: BED.z },
  navigate: async () => true,   // bot successfully walks to the bed
  delay: () => {},
});

const ev = bot.lastActionEvidence || {};
console.log('\n--- result ---');
console.log('returned          :', result);
console.log('pre-nav gate      :', sleepAttempted ? 'PASSED (did not block)' : 'blocked before sleep');
console.log('sleep attempted   :', sleepAttempted);
console.log('hostile->bed then :', hostileDistanceAtSleepTime);
console.log('evidence.outcome  :', ev.outcome);
console.log('evidence.error    :', ev.error);
console.log('evidence.retryable:', ev.retryable);

console.log('\n--- verdict ---');
if (sleepAttempted && ev.outcome === 'sleep_rejected') {
  console.log('CONFIRMED: bot-relative gate cleared an unsafe bed; failure surfaced only as');
  console.log('generic "sleep_rejected" with the real cause buried in a free-text error string.');
} else {
  console.log('NOT CONFIRMED — outcome was:', ev.outcome);
}
