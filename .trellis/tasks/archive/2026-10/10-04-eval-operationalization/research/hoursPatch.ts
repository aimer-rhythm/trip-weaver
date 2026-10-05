// 只修改已批准地点的 openHours；调用方负责凭据、预览身份和备份落盘。
import type { Client } from 'pg';
import { hash } from '../../../../../../eval/artifacts';

export interface HoursChange {
  id: string;
  name: string;
  city: string;
  source: string;
  before: unknown;
  after: unknown;
}
interface CurrentRow {
  id: string;
  name: string;
  city: string;
  source: string;
  hours: unknown;
  hadHours: boolean;
  protectedHash: string;
}
export interface HoursBackup {
  changes: HoursChange[];
  rows: CurrentRow[];
}
export class HoursPatchConflict extends Error {
  constructor(readonly conflicts: { id: string; name: string; reason: string }[]) {
    super(`营业字段预检发现 ${conflicts.length} 处不匹配，未应用任何变更`);
    this.name = 'HoursPatchConflict';
  }
}

function classify(changes: readonly HoursChange[], rows: readonly CurrentRow[]) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const pending: HoursChange[] = [];
  const already: string[] = [];
  const conflicts: { id: string; name: string; reason: string }[] = [];
  for (const change of changes) {
    const row = byId.get(change.id);
    const fail = (reason: string) => conflicts.push({ id: change.id, name: change.name, reason });
    if (!row) { fail('missing_row'); continue; }
    if (row.city !== change.city || row.name !== change.name || row.source !== change.source) { fail('identity_changed'); continue; }
    if (hash(row.hours) === hash(change.after)) already.push(change.id);
    else if (hash(row.hours) === hash(change.before)) pending.push(change);
    else fail('hours_changed_since_preview');
  }
  return { pending, already, conflicts };
}

export async function patchHours(
  client: Client, changes: readonly HoursChange[], mode: 'dry-run' | 'apply',
  saveBackup: (backup: HoursBackup) => Promise<void>,
) {
  if (!changes.length || new Set(changes.map((c) => c.id)).size !== changes.length) throw new Error('变更集合为空或 ID 重复');
  if (changes.some((c) => !c.id || !c.name || !c.city || !['xhs', 'goldset'].includes(c.source) || c.before === undefined || c.after === undefined)) {
    throw new Error('变更记录缺少身份或原值');
  }
  await client.query(mode === 'apply' ? 'BEGIN ISOLATION LEVEL SERIALIZABLE' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  let commitAttempted = false;
  try {
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '30s'");
    const read = async (lock: boolean) => (await client.query<CurrentRow>(`
      SELECT p.id,p.name,p.city,p.source,COALESCE(p.payload->'openHours','null'::jsonb) AS hours,
        COALESCE(p.payload ? 'openHours',false) AS "hadHours",
        md5(jsonb_build_array(to_jsonb(p)-'payload',COALESCE(p.payload,'{}'::jsonb)-'openHours')::text) AS "protectedHash"
      FROM canonical_places p WHERE p.id=ANY($1::text[]) ORDER BY p.id ${lock ? 'FOR UPDATE' : ''}`, [changes.map((c) => c.id)])).rows;
    const before = await read(mode === 'apply');
    const status = classify(changes, before);
    if (status.conflicts.length) throw new HoursPatchConflict(status.conflicts);
    if (mode === 'apply' && status.pending.length) {
      // 必须先持久化原字段（含原先不存在的状态），任何备份错误都阻止 UPDATE。
      await saveBackup({ changes: status.pending, rows: before });
      const result = await client.query(`UPDATE canonical_places p SET payload = CASE
          WHEN c.after IS NULL OR c.after = 'null'::jsonb THEN COALESCE(p.payload,'{}'::jsonb)-'openHours'
          ELSE jsonb_set(COALESCE(p.payload,'{}'::jsonb),'{openHours}',c.after,true) END
        FROM jsonb_to_recordset($1::jsonb) AS c(id text,name text,city text,source text,before jsonb,after jsonb)
        WHERE p.id=c.id AND p.name=c.name AND p.city=c.city AND p.source=c.source
          AND COALESCE(p.payload->'openHours','null'::jsonb)=COALESCE(c.before,'null'::jsonb)
        RETURNING p.id`, [JSON.stringify(status.pending)]);
      if (result.rowCount !== status.pending.length) throw new Error('实际更新行数与预检不一致');
      const after = await read(false);
      const final = classify(changes, after);
      if (final.conflicts.length || final.pending.length) throw new Error('更新后营业字段读回不一致');
      if (hash(before.map((r) => [r.id, r.protectedHash])) !== hash(after.map((r) => [r.id, r.protectedHash]))) {
        throw new Error('检测到营业字段以外的变更，事务回滚');
      }
    }
    commitAttempted = true;
    await client.query('COMMIT');
    return { mode, rows: changes.length, updated: mode === 'apply' ? status.pending.length : 0,
      pending: mode === 'dry-run' ? status.pending.length : 0, alreadyApplied: status.already.length,
      protectedFieldsVerified: true, previewHash: hash(changes) };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (commitAttempted) throw new Error('提交结果未知，必须只读核对字段后再决定是否重试');
    throw error;
  }
}
