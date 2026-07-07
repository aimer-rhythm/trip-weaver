import { timingSafeEqual } from 'node:crypto';
import { env } from '../env';

export function isRegistrationOpen(): boolean {
  return env.inviteCode.length > 0;
}

export function checkInviteCode(code: string): boolean {
  if (!isRegistrationOpen()) return false;
  const expected = Buffer.from(env.inviteCode, 'utf8');
  const actual = Buffer.from(code, 'utf8');
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
