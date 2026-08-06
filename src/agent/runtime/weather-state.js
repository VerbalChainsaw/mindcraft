/**
 * Mineflayer exposes both a boolean weather edge (`isRaining`) and fading
 * intensity values. The intensity values may remain above zero after the
 * server has sent stop_raining, so they cannot independently prove weather.
 */
export function minecraftWeather(bot) {
  const rainEdgeKnown = typeof bot?.isRaining === 'boolean';
  const raining = rainEdgeKnown
    ? bot.isRaining
    : Number(bot?.rainState) > 0;
  if (!raining) return 'Clear';
  return Number(bot?.thunderState) > 0 ? 'Thunderstorm' : 'Rain';
}
