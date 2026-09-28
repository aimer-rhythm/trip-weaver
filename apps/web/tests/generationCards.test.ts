import assert from 'node:assert/strict';
import test from 'node:test';
import type { ResearchPoi } from '@tripweaver/shared';
import { generationCardCaption, selectGenerationCards } from '../src/lib/generationCards';

const poi = (id: string, coverUrl?: string): ResearchPoi => ({ id, name: id, coverUrl, category: 'attraction', intro: '', reservation: 'unknown', sourceLinks: [] });

test('late candidates without photos do not evict the five usable photos', () => {
  const photos = Array.from({ length: 5 }, (_, i) => poi(`photo-${i}`, `https://images.test/${i}`));
  const incoming = Array.from({ length: 5 }, (_, i) => poi(`empty-${i}`));
  assert.deepEqual(selectGenerationCards([...photos, ...incoming], new Set()), photos);
});

test('failed cover falls back to an earlier photo and leaves source candidates untouched', () => {
  const photos = Array.from({ length: 6 }, (_, i) => poi(`photo-${i}`, `https://images.test/${i}`));
  assert.deepEqual(selectGenerationCards(photos, new Set(['https://images.test/5'])), photos.slice(0, 5));
  assert.equal(photos.length, 6);
});

test('partial and empty photo pools fill remaining positions with recent candidates in arrival order', () => {
  const pool = [poi('old'), poi('photo', 'https://images.test/ok'), poi('new'), poi('newest')];
  assert.deepEqual(selectGenerationCards(pool, new Set(), 3).map(p => p.id), ['photo', 'new', 'newest']);
  assert.deepEqual(selectGenerationCards([], new Set()), []);
  assert.deepEqual(selectGenerationCards(pool.map(p => ({ ...p, coverUrl: undefined })), new Set(), 2).map(p => p.id), ['new', 'newest']);
});

test('caption uses a real introduction phrase and does not invent one when absent', () => {
  const place = { ...poi('颐和园'), intro: '昆明湖畔散步，欣赏园林建筑。' };
  assert.equal(generationCardCaption(place), '颐和园 · 昆明湖畔散步');
  assert.equal(generationCardCaption(poi('故宫')), '故宫');
});
