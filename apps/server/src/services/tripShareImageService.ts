import { createHash } from 'node:crypto';
import type { Trip, TripShareImageResponse } from '@tripweaver/shared';
import { env } from '../env';
import { generateShareImage, imageError } from '../integrations/imageGeneration';
import { buildTripSharePrompt } from '../lib/tripSharePrompt';
import { TtlCache } from '../lib/ttlCache';

/** Bounded process-local cache and admission, matching the app's single-instance jobs. */
export function createTripShareImageService(generate = (prompt: string) => generateShareImage(env.imageGeneration, prompt)) {
  const cache = new TtlCache<TripShareImageResponse>(30 * 60_000, 8);
  const pending = new Map<string, Promise<TripShareImageResponse>>();
  const activeUsers = new Set<string>();
  return async (userId: string, trip: Trip): Promise<TripShareImageResponse> => {
    const prompt = buildTripSharePrompt(trip);
    const key = `${userId}:${trip.id}:${createHash('sha256').update(prompt).digest('hex')}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const existing = pending.get(key);
    if (existing) return existing;
    if (activeUsers.has(userId) || pending.size >= 2) throw imageError('正在生成分享图，请稍后再试', 429);
    activeUsers.add(userId);
    const job = Promise.resolve().then(() => generate(prompt)).then(image => { cache.set(key, image); return image; })
      .finally(() => { pending.delete(key); activeUsers.delete(userId); });
    pending.set(key, job);
    return job;
  };
}

export const getTripShareImage = createTripShareImageService();
