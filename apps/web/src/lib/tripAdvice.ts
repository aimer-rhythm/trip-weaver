import { dateForDayIndex, weatherForDate, WEATHER_FORECAST_DAYS, type ResearchPoi, type Trip, type TripWeather } from '@tripweaver/shared';

export interface TripAdvice { id: string; title: string; text: string }

export function buildTripAdvice(trip: Trip, weather: TripWeather | undefined, pois: Map<string, ResearchPoi>, now = Date.now()) {
  const suggestions: TripAdvice[] = [];
  const cautions: TripAdvice[] = [];
  const daily = trip.days.map(day => ({ day, weather: weatherForDate(weather, trip.destination, dateForDayIndex(trip.startDate, day.dayIndex), now) }));
  const forecasts = daily.flatMap(item => item.weather.status === 'available' ? [{ day: item.day, cast: item.weather.cast }] : []);
  const rainy = forecasts.filter(({ cast }) => /雨|雪/.test(cast.dayWeather + cast.nightWeather));
  if (rainy.length) suggestions.push({ id: 'rain', title: '雨雪天，留一点弹性', text: `第 ${rainy.map(item => item.day.dayIndex).join('、')} 天有雨雪预报，带好雨具和防滑鞋，户外活动可预留室内备选。` });
  if (forecasts.some(({ cast }) => Math.max(cast.dayTemp, cast.nightTemp) >= 30)) suggestions.push({ id: 'heat', title: '防晒与补水随身带', text: '部分日期预报气温达到 30℃，准备饮水、防晒用品，午间安排休息。' });
  if (forecasts.some(({ cast }) => Math.min(cast.dayTemp, cast.nightTemp) <= 10 || Math.abs(cast.dayTemp - cast.nightTemp) >= 10)) suggestions.push({ id: 'layers', title: '带一件方便穿脱的外套', text: '预报有低温或较大昼夜温差，早出晚归时注意添衣。' });
  suggestions.push({ id: 'transport', title: trip.transportMode === 'drive' ? '提前留好停车时间' : '给路途留些余量', text: trip.transportMode === 'drive' ? '出发前确认景点停车位置与开放时间，热门区域预留找车位和步行时间。' : '穿舒适的鞋，出发前确认公共交通运营时间，换乘和入场额外预留 20–30 分钟。' });
  if (trip.days.some(day => day.activities.length >= 5)) suggestions.push({ id: 'pace', title: '把体力留给喜欢的地方', text: '部分日期安排较满，可先选出最想去的两三站，按当天体力调整停留时间。' });
  if (!suggestions.some(item => item.id === 'rain' || item.id === 'heat' || item.id === 'layers')) suggestions.push({ id: 'packing', title: '轻装出发，常用物品随身', text: '带好证件、充电宝和饮水，出发前再确认一次天气与随身物品。' });

  const reservations = [...new Map([...pois.values()].filter(poi => poi.reservation === 'required').map(poi => [poi.id, poi])).values()];
  if (reservations.length) cautions.push({ id: 'reservations', title: '这些地方记得提前预约', text: `${reservations.map(poi => poi.name).join('、')}。预约规则、余票及入场要求请以官方最新信息为准。` });
  else cautions.push({ id: 'opening', title: '出发前确认开放与预约', text: '景点和场馆可能有闭馆日、分时预约或临时调整，请出发前通过官方渠道确认。' });
  const severe = forecasts.filter(({ cast }) => /雷|暴雨|大雨|暴雪|大雪/.test(cast.dayWeather + cast.nightWeather)
    || [cast.dayPower, cast.nightPower].some(power => Math.max(...(power.match(/\d+/g) ?? ['0']).map(Number)) >= 5));
  if (severe.length) cautions.push({ id: 'severe', title: '关注大风与强降水', text: `第 ${severe.map(item => item.day.dayIndex).join('、')} 天预报有较强风雨雪，留意当地预警及景区通知，谨慎安排登高、临水等户外活动。` });
  if (weather?.status === 'not_configured') cautions.push({ id: 'weather-unconfigured', title: '本站未接入天气服务', text: '本行程不会显示天气预报，出行前请通过官方渠道确认目的地天气。' });
  else if (daily.some(item => item.weather.status === 'pending')) cautions.push({ id: 'forecast-window', title: '部分日期还没有天气预报', text: `和风天气预报覆盖当天及未来 ${WEATHER_FORECAST_DAYS} 天，临近出行时打开行程即可查看最新天气。` });
  else if (daily.some(item => item.weather.status === 'unavailable')) cautions.push({ id: 'weather-unavailable', title: '天气信息待补充', text: '部分日期的天气暂未获取成功，可稍后重试；出发前请再核对最新预报。' });
  else if (daily.some(item => item.weather.status === 'undated')) cautions.push({ id: 'dates', title: '先确定出行日期', text: '行程日期确定后，才能对应查看天气与安排预约。' });
  for (const [index, note] of [...new Set(trip.meta.reviewNotes)].slice(0, 3).entries()) {
    if (note.trim()) cautions.push({ id: `review-${index}`, title: '行程提醒', text: note });
  }
  return { suggestions: suggestions.slice(0, 4), cautions };
}
