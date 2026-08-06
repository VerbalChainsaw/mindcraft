/**
 * Mineflayer exposes both a boolean weather edge (`isRaining`) and fading
 * intensity values. The intensity values may remain above zero after the
 * server has sent stop_raining, so they cannot independently prove weather.
 */
export function minecraftWeather(bot) {
  const raining = bot?.isRaining === true;
  if (!raining) return 'Clear';
  return Number(bot?.thunderState) > 0 ? 'Thunderstorm' : 'Rain';
}
