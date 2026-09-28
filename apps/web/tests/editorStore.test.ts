import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeSampleTrip } from '../../../packages/shared/src/sample.ts';
import { useEditorStore } from '../src/store/editorStore.ts';

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
