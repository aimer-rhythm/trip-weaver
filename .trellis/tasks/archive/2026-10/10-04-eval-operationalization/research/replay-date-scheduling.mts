// 原候选 + 同版冻结知识的排程回归；仅访问随机专用 PostgreSQL，绝不调用模型/地图。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { hash, hashSources, writeJson } from '../../../../../../eval/artifacts';
import { readFrozen, seedFrozen } from '../../../../../../eval/frozenKnowledge';
import { createEvaluationDatabase } from '../../../../../../eval/isolation';
import { parseSnapshot } from '../../../../../../eval/contracts';
import { dateForDayIndex, isClosedOnDate } from '@tripweaver/shared';
import { routeDistanceMeters } from '../../../../../../apps/server/src/generation/scheduling/routeOrder';
import { repairScheduleDates } from '../../../../../../apps/server/src/generation/scheduling/dateRepair';
import { ScheduleDateConflictError, PACE_SCHEDULE_LIMITS } from '../../../../../../apps/server/src/generation/scheduling/schedule';

const campaign = 'eval/runs/campaign-2026-10-05-live-matrix';
const plan = JSON.parse(fs.readFileSync(`${campaign}/plan.json`, 'utf8'));
const out = `eval/runs/date-replay-${Date.now()}`;
fs.mkdirSync(out);
const frozen = readFrozen(plan.knowledgeDirectory);
assert.equal(frozen.contentHash, plan.knowledgeHash);
const database = await createEvaluationDatabase(process.env.EVAL_PG_ADMIN_URL);
Object.assign(process.env, { DATABASE_URL: database.url, MASTER_KEY: randomBytes(32).toString('hex'),
  DOTENV_CONFIG_PATH: './data/absent-replay.env', EMBEDDING_API_KEY: '', EMBEDDING_BASE_URL: '' });
const { pool } = await import('../../../../../../apps/server/src/db/client');
const { loadPlaceFacts } = await import('../../../../../../apps/server/src/generation/scheduling/placeFacts');
const { loadPlaceRelations } = await import('../../../../../../apps/server/src/generation/scheduling/placeRelations');
const { applyDeterministicSchedule } = await import('../../../../../../apps/server/src/generation/scheduling/buildDraft');
const { classifyLongHaulPois } = await import('../../../../../../apps/server/src/generation/longHaul');
const { isFoodFocused } = await import('../../../../../../apps/server/src/generation/mealPlanning');
const { visitWeight } = await import('../../../../../../apps/server/src/generation/scheduling/visitWeight');
const { routeOrderConstraints } = await import('../../../../../../apps/server/src/data/routeOrderSeeds');
const { DraftTrip } = await import('../../../../../../apps/server/src/generation/draft');
const rows: object[] = [], focused: object[] = [];
try {
  await seedFrozen(pool, frozen, false);
  for (const stage of plan.stages) {
    const stageRoot = `${campaign}/${stage.id}`;
    const runs = fs.readdirSync(stageRoot).filter((name) => fs.existsSync(`${stageRoot}/${name}/snapshots`));
    assert.equal(runs.length, 1, '只使用原批次，不能选重跑结果');
    for (const file of fs.readdirSync(`${stageRoot}/${runs[0]}/snapshots`).sort()) {
      const source = `${stageRoot}/${runs[0]}/snapshots/${file}`;
      const bytes = fs.readFileSync(source);
      const snapshot = parseSnapshot(JSON.parse(bytes.toString('utf8')));
      const candidates = snapshot.research!.candidates;
      const facts = await loadPlaceFacts(candidates.map((p) => p.name), snapshot.form.destination);
      const relations = await loadPlaceRelations(snapshot.form.destination);
      const kbCoords = new Map([...facts].flatMap(([name, f]) => f.lat !== undefined && f.lng !== undefined ? [[name, { lat: f.lat, lng: f.lng }] as const] : []));
      const longHaul = classifyLongHaulPois(candidates, new Map(), snapshot.form.transportMode ?? 'transit', kbCoords);
      const draft = new DraftTrip(snapshot.form);
      const before = snapshot.trip.days.map((d) => d.activities.filter((a) => !/^(午餐|晚餐)｜/.test(a.name)));
      const shape = (days: typeof before) => days.map((day, i) => ({ date: dateForDayIndex(snapshot.form.startDate, i + 1), names: day.map((p) => p.name), distanceMeters: routeDistanceMeters(day) }));
      try {
        const outcome = applyDeterministicSchedule({ draft, form: snapshot.form, pool: candidates, locations: new Map(), longHaul,
          foodFocused: isFoodFocused(snapshot.form.preferences), facts, relations });
        assert.deepEqual(draft.validate(), []);
        const after = outcome.schedule.days.map((day) => day.stops.filter((s) => !s.meal).map((s) => s.poi));
        const ids = outcome.schedule.days.flatMap((d) => d.stops.filter((s) => s.poi.category === 'attraction').map((s) => s.poi.id));
        assert.equal(new Set(ids).size, ids.length);
        for (const day of outcome.schedule.days) for (const stop of day.stops) assert.ok(!isClosedOnDate(stop.poi.openTime, dateForDayIndex(snapshot.form.startDate, day.dayIndex)));
        rows.push({ caseId: snapshot.caseId, source, sourceHash: hash(bytes.toString()), status: 'PASS', before: shape(before), after: shape(after),
          dateRepair: outcome.schedule.dateRepair, droppedCount: outcome.schedule.droppedCount,
          candidatesWithoutKnowledge: candidates.filter((p) => !facts.has(p.name)).map((p) => p.name),
          omittedCandidates: candidates.filter((p) => p.category === 'attraction' && !ids.includes(p.id)).map((p) => p.name) });
      } catch (error) {
        if (!(error instanceof ScheduleDateConflictError)) throw error;
        rows.push({ caseId: snapshot.caseId, source, status: 'CONFLICT', conflicts: error.conflicts, reason: error.reason });
      }
      if (['beijing-notes-avoid-remote', 'beijing-notes-food-no-spicy'].includes(snapshot.caseId)) {
        // 原最终景点集合与坐标的独立修复证明；和「候选重跑当前排程」分开，不能相互冒充。
        const points = before.map((day) => day.map((a) => ({ id: a.id, name: a.name, category: 'attraction' as const,
          lat: a.lat, lng: a.lng, openTime: a.openTime, score: 0, weight: visitWeight(facts.get(a.name)) })));
        const repair = repairScheduleDates(points, { days: snapshot.form.days, foodFocused: isFoodFocused(snapshot.form.preferences),
          startDate: snapshot.form.startDate, orderConstraints: routeOrderConstraints(snapshot.form.destination, candidates.map((p) => p.name)),
          exclusiveNames: longHaul.filter((p) => p.tier === 'exclusive').map((p) => p.name) }, PACE_SCHEDULE_LIMITS[snapshot.form.pace ?? 'moderate']);
        assert.deepEqual(repair.conflicts, [], snapshot.caseId);
        assert.deepEqual(repair.days.flat().map((p) => p.id).sort(), points.flat().map((p) => p.id).sort());
        focused.push({ caseId: snapshot.caseId, source, before: shape(points), after: shape(repair.days), attempts: repair.attempts,
          retained: points.flat().length, conflicts: repair.conflicts });
      }
      assert.equal(hash(fs.readFileSync(source).toString()), hash(bytes.toString()));
    }
  }
  assert.equal(rows.length, 96);
  writeJson(`${out}/report.json`, { knowledgeHash: frozen.contentHash, runtime: hashSources(['apps/server/src/generation/scheduling', 'apps/server/src/generation/orchestrator.ts']),
    method: '复用原96例候选与表单，冻结库导入随机专用库后重新运行当前排程。原research.locations未保存，本回放只使用知识库坐标，不能声称完整重现原调研坐标条件。另两例保留原最终景点/坐标仅验证跨日修复。无新模型/实际路网、无写回原行程。', rows, focused });
  console.log(JSON.stringify({ out, cases: rows.length, conflicts: rows.filter((r: any) => r.status === 'CONFLICT'), focused }, null, 2));
} finally { await pool.end(); await database.close(); }
