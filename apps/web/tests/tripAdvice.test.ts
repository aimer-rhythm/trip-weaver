import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeSampleTrip, type TripWeather, type ResearchPoi } from '@tripweaver/shared';
import { buildTripAdvice } from '../src/lib/tripAdvice';

test('advice uses only matching current weather and booked itinerary places', () => {
  const now = Date.parse('2026-10-04T04:00:00Z');
  const trip = { ...makeSampleTrip(), destination: '北京', startDate: '2026-10-04' };
  const weather: TripWeather = { destination: '北京', checkedAt: now, status: 'available', forecast: {
    city: '北京市', locationId: '101010100', reportTime: '2026-10-04 11:00:00', casts: [{ date: trip.startDate, dayWeather: '雷阵雨', nightWeather: '多云', dayTemp: 31, nightTemp: 19, dayWind: '北风', nightWind: '北风', dayPower: '4-5', nightPower: '≤3' }],
  } };
  const poi: ResearchPoi = { id: 'p1', name: '故宫', category: 'attraction', intro: '', reservation: 'required', sourceLinks: [] };
  const result = buildTripAdvice(trip, weather, new Map([['a', poi], ['b', poi]]), now);
  assert.ok(result.suggestions.some(item => item.id === 'rain' && item.text.includes('第 1 天')));
  assert.ok(result.suggestions.some(item => item.id === 'heat'));
  assert.ok(result.cautions.some(item => item.id === 'severe'));
  assert.equal(result.cautions.find(item => item.id === 'reservations')!.text.match(/故宫/g)?.length, 1);
  const far = buildTripAdvice({ ...trip, startDate: '2026-11-04' }, weather, new Map(), now);
  assert.ok(far.cautions.some(item => item.id === 'forecast-window'));
  assert.ok(far.suggestions.every(item => !['rain', 'heat', 'layers'].includes(item.id)));
  const unconfigured = buildTripAdvice(trip, { destination: '北京', checkedAt: now, status: 'not_configured' }, new Map(), now);
  assert.ok(unconfigured.cautions.some(item => item.id === 'weather-unconfigured'), 'no data source is told apart from a failed lookup');
  assert.equal(JSON.stringify(unconfigured).includes('稍后重试'), false, 'a missing data source must not be sold as retryable');
  assert.ok(!JSON.stringify(buildTripAdvice(trip, { ...weather, destination: '上海' }, new Map(), now)).includes('有雨雪预报'));
});
