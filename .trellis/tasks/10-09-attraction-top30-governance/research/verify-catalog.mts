import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createPlaceIdentityIndex, type IdentityPlace} from '../../../../apps/server/src/lib/placeIdentity.js';

interface FrozenPlace extends IdentityPlace {verified:boolean}
interface Ranked {entityId:string;name:string;aliases:string[];legacyIds:string[]}
interface RankCity {city:string;top30:Ranked[]}
const [snapshotPath, rankingPath, outputPath] = process.argv.slice(2);
if (!snapshotPath || !rankingPath || !outputPath) throw new Error('需要快照、排名和输出路径');
const bytes = await readFile(snapshotPath);
const snapshot = JSON.parse(bytes.toString('utf8')) as {cities:Array<{city:string;downstream:FrozenPlace[]}>};
const ranking = JSON.parse(await readFile(rankingPath, 'utf8')) as {snapshotSha256:string;cities:RankCity[]};
if (ranking.snapshotSha256 !== createHash('sha256').update(bytes).digest('hex')) throw new Error('排名输入指纹不一致');
const rows = [];
for (const city of ranking.cities) {
  const frozen = snapshot.cities.find(c => c.city === city.city);
  if (!frozen) throw new Error('缺少全城目录');
  const index = createPlaceIdentityIndex(frozen.downstream.filter(p => p.verified || p.payload?.identityWithdrawal));
  for (const selected of city.top30) {
    const failures:string[] = [];
    let nameChecks = 0, legacyChecks = 0;
    for (const name of [selected.name, ...selected.aliases]) {
      const found = index.resolve(city.city, name);
      nameChecks++;
      if (found.status !== 'resolved' || found.canonicalPlaceId !== selected.entityId) failures.push(`名称解析失败：${name}`);
    }
    for (const oldId of selected.legacyIds) {
      const found = index.resolve(city.city, selected.name, oldId);
      legacyChecks++;
      if (found.status !== 'resolved' || found.canonicalPlaceId !== selected.entityId) failures.push(`旧ID解析失败：${oldId}`);
    }
    const wrongCity = index.resolve(city.city === '北京' ? '济南' : '北京', selected.name, selected.entityId);
    if (wrongCity.status === 'resolved') failures.push('跨城ID被错误接受');
    // 名称独立检查，不能用同一个合法实体 ID 掩盖其它景点名称。
    for (const other of city.top30.filter(p => p.entityId !== selected.entityId)) {
      const wrongName = index.resolve(city.city, other.name, selected.entityId);
      if (wrongName.status === 'resolved') failures.push(`错误名称绑定被接受：${other.name}`);
    }
    rows.push({city:city.city,name:selected.name,entityId:selected.entityId,nameChecks,legacyChecks,
      crossCityChecks:1,wrongNameChecks:city.top30.length-1,passed:failures.length===0,failures});
  }
}
const report = {kind:'frozen_live_catalog_production_resolver',snapshotSha256:ranking.snapshotSha256,
  limits:'仅完整实库目录快照上的生产解析器；不代替来源语义、实际向量或候选排程链路验收。',
  rows,passed:rows.every(r=>r.passed),totalChecks:rows.reduce((n,r)=>n+r.nameChecks+r.legacyChecks+r.crossCityChecks+r.wrongNameChecks,0)};
await writeFile(outputPath,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({passed:report.passed,entities:rows.length,totalChecks:report.totalChecks,failures:rows.filter(r=>!r.passed)}));
if (!report.passed) process.exitCode=1;
