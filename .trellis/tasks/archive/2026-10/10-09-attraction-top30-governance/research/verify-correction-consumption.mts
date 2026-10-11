// 用户纠正的独立语义预期，避免将现有别名直接作为正确答案。
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {parse} from 'dotenv';
import {createPlaceIdentityIndex, type IdentityPlace} from '../../../../apps/server/src/lib/placeIdentity';

const root = '.trellis/tasks/10-09-attraction-top30-governance/research/';
const batch = '.trellis/tasks/10-06-place-identity-governance/research/all-cities/batch-75/sync-01/';
type Stored = IdentityPlace & {verified:boolean;lat:number;lng:number};
type Snapshot = {cities:Array<{city:string;downstream:Stored[]}>};
const before = JSON.parse(await readFile(root+'snapshot-20261009T111626632432Z/input.json','utf8')) as Snapshot;
const after = JSON.parse(await readFile(root+'snapshot-20261009T113623767243Z/input.json','utf8')) as Snapshot;
const oldRows = before.cities.find(c=>c.city==='北京')!.downstream;
const rows = after.cities.find(c=>c.city==='北京')!.downstream;
const index = createPlaceIdentityIndex(rows.filter(p=>p.verified || p.payload?.identityWithdrawal));
const target = '21152db5b05aff609cffa2bee47f16b4';
const oldId = '298e600416cbc4f85119932e8a3c966c';
const checks:Record<string,boolean> = {};
for (const name of ['天安门','天安门广场']) for (const id of [undefined,oldId,target]) {
  const r = index.resolve('北京',name,id);
  checks[`resolve:${name}:${id??'nameOnly'}`] = r.status==='resolved' && r.canonicalPlaceId===target;
}
const independent = rows.filter(p=>p.name!== '天安门' && p.name!== '天安门广场'
  && /天安门|金水桥/.test(p.name));
checks.independentRowsUnchanged = independent.length>0 && independent.every(p=>{
  const old = oldRows.find(r=>r.id===p.id);
  return old && JSON.stringify(old.payload?.identity)===JSON.stringify(p.payload?.identity)
    && old.payload?.canonicalRedirectTo===p.payload?.canonicalRedirectTo
    && p.payload?.canonicalRedirectTo!==target;
});
const exported = JSON.parse(await readFile(batch+'xhs-places-北京.json','utf8')) as {places:Stored[]};
const square = exported.places.find(p=>p.id===target)!;
checks.onlyOneExportedRoot = !exported.places.some(p=>p.id===oldId)
  && exported.places.filter(p=>p.name==='天安门'||p.name==='天安门广场').length===1;
checks.noInheritedComplexComponents = JSON.stringify(square.payload?.components)==='[]';
const hours = square.payload?.openHours as {closedWeekdays?:number[]}|undefined;
checks.noTowerStructuredMondayClosure = !hours?.closedWeekdays?.includes(1);
const relations = JSON.parse(await readFile(batch+'xhs-place-relations-北京.json','utf8')) as {
  relations:Array<{fromEntityId:string;toEntityId:string}>};
const ids = new Set(exported.places.map(p=>p.id));
checks.relationEndpointsValid = relations.relations.every(r=>ids.has(r.fromEntityId)&&ids.has(r.toEntityId));
checks.noSelfLoops = relations.relations.every(r=>r.fromEntityId!==r.toEntityId);
checks.noAbsorbedEndpoint = relations.relations.every(r=>r.fromEntityId!==oldId&&r.toEntityId!==oldId);
Object.assign(process.env,parse(await readFile('apps/server/.env')));
const {loadCityPlaceFacts} = await import('../../../../apps/server/src/generation/scheduling/placeFacts');
const {pool} = await import('../../../../apps/server/src/db/client');
let facts;
try {
  const allFacts = await loadCityPlaceFacts('北京');
  facts = allFacts.get('天安门广场');
  checks.liveFactsUnified = !!facts && facts.canonicalPlaceId===target && allFacts.get('天安门')===facts;
  checks.noTowerMondayClosure = !!facts
    && !/周一|星期一/.test(facts.closureText??'') && !/周一|星期一/.test(facts.openTime??'');
} finally {await pool.end();}
const wrong = index.resolve('北京','石景山公园');
const jingDefect = wrong.status==='resolved' && wrong.canonicalPlaceId==='981bfe8125feb36e052dcfee1e0df8b5';
assert.equal(jingDefect,true,'应按当前冻结状态复现已知错误；修复后须改成拒绝误归并的验收');
const report = {readOnly:true,tiananmen:{checks,passed:Object.values(checks).every(Boolean),
  independentNames:independent.map(p=>p.name),relationCount:relations.relations.length,
  facts:{id:facts?.canonicalPlaceId,openTime:facts?.openTime,closureText:facts?.closureText}},
  jingshan:{expected:'石景山公园不能全局解析成景山公园',
    actual:{status:wrong.status,canonicalPlaceId:wrong.status==='resolved'?wrong.canonicalPlaceId:undefined},
    defectReproduced:jingDefect,fixed:false}};
await writeFile(root+'correction-consumption-02.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report));
assert.equal(report.tiananmen.passed,true);
