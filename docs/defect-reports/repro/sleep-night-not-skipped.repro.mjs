// Repro: night does not advance because another player is online and awake
// (playersSleepingPercentage=100, the confirmed default of the live acceptance world).
// The bot is legitimately in bed; Minecraft keeps it there until morning.
const { goToBed } = await import('../../../src/agent/library/skills.js');

function position(x, y, z) {
  return { x, y, z, distanceTo: o => Math.hypot(x - o.x, y - o.y, z - o.z) };
}

const BED = position(30, 64, 0);
const bot = {
  interrupt_code: false,
  isSleeping: false,
  entity: { position: position(0, 64, 0) },
  modes: { pause() {} },
  game: { dimension: 'overworld' },
  blockAt: () => ({ name: 'red_bed', position: BED }),
  nearestEntity: () => null,          // no hostiles — this is the clean case
  sleep() { this.isSleeping = true; }, // server accepts: bot IS in the bed
  wake() { this.isSleeping = false; },
};

// Night never advances: nothing ever clears isSleeping on its own.
let clock = 0;
const result = await goToBed(bot, {
  exactPosition: { x: BED.x, y: BED.y, z: BED.z },
  navigate: async () => true,
  now: () => clock,
  delay: () => { clock += 250; },     // each poll advances 250ms, as in the real loop
});

const ev = bot.lastActionEvidence || {};
console.log('default sleepTimeoutMs :', 20_000);
console.log('virtual ms spent in bed:', clock);
console.log('\nreturned           :', result);
console.log('evidence.outcome   :', ev.outcome);
console.log('evidence.enteredSleep:', ev.enteredSleep);
console.log('evidence.woke      :', ev.woke);
console.log('evidence.retryable :', ev.retryable);

console.log('\n--- verdict ---');
if (result === false && ev.outcome === 'sleep_timeout' && ev.enteredSleep === true) {
  console.log('CONFIRMED: the bot successfully got into the bed and was FORCIBLY WOKEN after 20s,');
  console.log('then reported failure. Correct Minecraft behaviour is misreported as a bot failure.');
  console.log('It also cancels its own sleep, so it can never be in bed when dawn arrives.');
} else {
  console.log('NOT CONFIRMED — outcome was:', ev.outcome);
}
