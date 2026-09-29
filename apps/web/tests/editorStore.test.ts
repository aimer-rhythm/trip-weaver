import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeSampleTrip } from '../../../packages/shared/src/sample.ts';
import { useEditorStore } from '../src/store/editorStore.ts';
import { routePairKey } from '../src/lib/routePair.ts';
import { collectDayLines } from '../src/lib/mapData.ts';

test('route selection updates one pair and map, rejects stale endpoints and coordinates', () => {
  const trip = makeSampleTrip();
  const day = trip.days[0]!;
  const from = day.activities[0]!;
  const to = day.activities[1]!;
  const route = { fromActivityId: from.id, toActivityId: to.id, mode: 'drive' as const, source: 'amap' as const, durationMin: 5, distanceM: 1000, polyline: '116,39;116.1,39.1' };
  const key = routePairKey(trip, day.id, from.id)!;
  const store = () => useEditorStore.getState();
  store().load(trip);
  assert.equal(store().selectRoute(day.id, key, route), true);
  assert.equal(store().revision, 1);
  assert.deepEqual(store().trip!.days.slice(1), trip.days.slice(1));
  assert.deepEqual(collectDayLines(store().trip!.days)[0]!.segments[0]!.positions, [{ lng: 116, lat: 39 }, { lng: 116.1, lat: 39.1 }]);
  store().moveActivity(day.id, from.id, 'down');
  const rev = store().revision;
  assert.equal(store().selectRoute(day.id, key, route), false);
  assert.equal(store().revision, rev);
  store().load(trip);
  store().selectRoute(day.id, key, route);
  store().updateActivity(day.id, from.id, { lat: from.lat + 0.1 });
  assert.equal(store().selectRoute(day.id, key, route), false);
  assert.equal(store().trip!.days[0]!.legs?.length, 0);
  store().clear();
  assert.equal(store().selectRoute(day.id, key, route), false);
});

test('day navigation never increments revision, deletion preserves selected day identity', () => {
  const trip = makeSampleTrip();
  useEditorStore.getState().load(trip);
  assert.equal(useEditorStore.getState().dayFilter, 1);
  useEditorStore.getState().setDayFilter(3);
  assert.equal(useEditorStore.getState().revision, 0);
  useEditorStore.getState().deleteDay(trip.days[0]!.id);
  assert.equal(useEditorStore.getState().dayFilter, 2);
  assert.equal(useEditorStore.getState().trip?.days[1]?.id, trip.days[2]!.id);
  assert.equal(useEditorStore.getState().revision, 1);
  assert.equal(trip.days.length, 3);
  useEditorStore.getState().deleteDay(trip.days[2]!.id);
  assert.equal(useEditorStore.getState().dayFilter, 1);
  useEditorStore.getState().deleteDay(trip.days[1]!.id);
  assert.equal(useEditorStore.getState().dayFilter, null);
  assert.equal(useEditorStore.getState().trip?.days.length, 0);
});

test('overview remains selected after mutations and empty trips load safely', () => {
  const trip = makeSampleTrip();
  useEditorStore.getState().load(trip);
  useEditorStore.getState().setDayFilter(null);
  useEditorStore.getState().deleteDay(trip.days[0]!.id);
  assert.equal(useEditorStore.getState().dayFilter, null);
  useEditorStore.getState().addDay();
  assert.equal(useEditorStore.getState().dayFilter, null);
  useEditorStore.getState().load({ ...trip, days: [] });
  assert.equal(useEditorStore.getState().dayFilter, null);
  assert.equal(useEditorStore.getState().revision, 0);
  useEditorStore.getState().clear();
});
