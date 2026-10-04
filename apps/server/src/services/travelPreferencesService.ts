import { eq } from 'drizzle-orm';
import { Value } from '@sinclair/typebox/value';
import { TravelPreferencesSchema, type TravelPreferences } from '@tripweaver/shared';
import { db } from '../db/client';
import { userTravelPreferences } from '../db/schema';

export async function getTravelPreferences(userId: string): Promise<TravelPreferences> {
  const [row] = await db.select().from(userTravelPreferences).where(eq(userTravelPreferences.userId, userId));
  if (!row) return { preferences: [], transportMode: 'transit', extraNotes: '' };
  if (!Value.Check(TravelPreferencesSchema, row.data)) throw new Error('Invalid stored travel preferences');
  return row.data;
}

export async function saveTravelPreferences(userId: string, data: TravelPreferences): Promise<TravelPreferences> {
  const updatedAt = new Date();
  await db.insert(userTravelPreferences).values({ userId, data, updatedAt }).onConflictDoUpdate({
    target: userTravelPreferences.userId,
    set: { data, updatedAt },
  });
  return data;
}
