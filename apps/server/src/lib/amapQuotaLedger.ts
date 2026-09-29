import type { Pool } from 'pg';
import { AMAP_SERVICES, amapDay, type AmapService } from '../integrations/amap/services';

export interface AmapQuotaDecision {
  allowed: boolean;
  service: AmapService;
  day: string;
  used: number;
  limit: number;
  resetAt: number;
}

/** Atomic, durable admission; every admitted outbound attempt is charged, even on failure. */
export function createAmapQuotaLedger(pool: Pick<Pool, 'query'>, limits: Record<AmapService, number>, now = Date.now) {
  return {
    async acquire(service: AmapService): Promise<AmapQuotaDecision> {
      const { day, resetAt } = amapDay(now());
      const limit = limits[service];
      const result = await pool.query<{ calls: number }>(`
        INSERT INTO amap_service_usage (day, service, calls)
        SELECT $1, $2, 1 WHERE $3::integer > 0
        ON CONFLICT (day, service) DO UPDATE SET calls = amap_service_usage.calls + 1
        WHERE amap_service_usage.calls < $3
        RETURNING calls`, [day, service, limit]);
      const row = result.rows[0];
      const used = row?.calls ?? (await pool.query<{ calls: number }>('SELECT calls FROM amap_service_usage WHERE day = $1 AND service = $2', [day, service])).rows[0]?.calls ?? 0;
      return { allowed: Boolean(row), service, day, used, limit, resetAt };
    },
    async remaining(): Promise<number> {
      const result = await pool.query<{ service: AmapService; calls: number }>('SELECT service, calls FROM amap_service_usage WHERE day = $1', [amapDay(now()).day]);
      const used = new Map(result.rows.map(row => [row.service, row.calls]));
      return AMAP_SERVICES.reduce((sum, service) => sum + Math.max(0, limits[service] - (used.get(service) ?? 0)), 0);
    },
  };
}
