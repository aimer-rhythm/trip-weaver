// 原delta按JSON键顺序比较会误报全部变化；保留旧文件，另存语义差异及版本变化。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
const root=new URL('./batch-27/sync-01/',import.meta.url);
const reports=[];
const key=e=>[e.fromEntityId,e.toEntityId].sort().join('|');
const withoutRevisions=edge=>({...edge,fromRevision:undefined,toRevision:undefined,
  evidence:edge.evidence.map(e=>({...e,from:{...e.from,revision:undefined},to:{...e.to,revision:undefined}}))});
for(const city of ['北京','成都','重庆']) {
  const folder=new URL(`preview-${city}/`,root);
  const old=JSON.parse(fs.readFileSync(new URL('library-before.json',folder))).tables.place_relation_snapshots[0].relations;
  const next=JSON.parse(fs.readFileSync(new URL(`xhs-place-relations-${city}.json`,folder))).relations;
  const changed=[],versions=[],added=[],removed=old.filter(e=>!next.some(n=>key(e)===key(n)));
  for(const edge of next) {
    const before=old.find(e=>key(e)===key(edge));
    if(!before) added.push(edge);
    else if(!isDeepStrictEqual(withoutRevisions(before),withoutRevisions(edge))) changed.push({before,after:edge});
    else if(!isDeepStrictEqual(before,edge)) versions.push({from:edge.from,to:edge.to,fromRevision:edge.fromRevision,toRevision:edge.toRevision});
  }
  const report={city,added,removed,changedEvidence:changed,versionOnly:versions};
  fs.writeFileSync(new URL('relation-semantic-delta-01.json',folder),JSON.stringify(report,null,2),{flag:'wx'});
  reports.push(report);
}
console.log(JSON.stringify(reports,null,2));
