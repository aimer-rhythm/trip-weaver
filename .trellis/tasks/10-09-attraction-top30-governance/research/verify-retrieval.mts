// 两城最终候选主名及别名的实际SQL和启用真实向量的混合召回；业务库只读。
import {readFile,writeFile} from 'node:fs/promises';
import {Client} from 'pg';
import {parse} from 'dotenv';
import {createPlaceRetriever,type RetrievalDiagnostics} from '../../../../apps/server/src/generation/placeRetrieval';
import {createQueryEmbedder} from '../../../../apps/server/src/integrations/queryEmbedding';
const [rankingFile,outputFile]=process.argv.slice(2);
if(!rankingFile||!outputFile)throw new Error('需要排名文件与输出文件');
const ranking=JSON.parse(await readFile(rankingFile,'utf8')) as {snapshotSha256:string;cities:Array<{city:string;top30:Array<{entityId:string;name:string;aliases:string[];revision:number;score:number}>}>};
const config={...parse(await readFile('apps/server/.env')),...process.env};
const client=new Client({connectionString:config.DATABASE_URL,connectionTimeoutMillis:10000});
const embed=createQueryEmbedder({baseUrl:config.EMBEDDING_BASE_URL||config.SITE_LLM_BASE_URL||'',
  apiKey:config.EMBEDDING_API_KEY||config.SITE_LLM_API_KEY||'',model:config.EMBEDDING_MODEL||'cf/bge-m3',dims:Number(config.EMBEDDING_DIMS||1024)});
const rows=[];
await client.connect();
try{
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await client.query("SET LOCAL statement_timeout='15s'");
  const retrieve=createPlaceRetriever({query:(sql,args)=>client.query(sql,args),embed});
  for(const city of ranking.cities)for(const place of city.top30){
    const failures:string[]=[];
    const current=(await client.query('SELECT payload FROM canonical_places WHERE id=$1 AND city=$2',[place.entityId,city.city])).rows[0];
    if(current?.payload?.identity?.revision!==place.revision)throw new Error(`版本变化：${city.city}/${place.name}`);
    if(current?.payload?.recommendScore!==place.score)failures.push('实际推荐分与排名快照不一致');
    for(const name of [place.name,...place.aliases]){
      const found=await retrieve([name],{city:city.city,vector:'off',limit:48});
      if(!found.some(p=>p.canonicalPlaceId===place.entityId))failures.push(`SQL未命中：${name}`);
    }
    let diagnostics:RetrievalDiagnostics|undefined;
    const found=await retrieve([place.name],{city:city.city,vector:'force',limit:48,onDiagnostics:d=>{diagnostics=d;}});
    if(diagnostics?.vector!=='used')failures.push('实际向量请求未成功参与召回');
    if(!found.some(p=>p.canonicalPlaceId===place.entityId))failures.push('混合召回未命中主实体');
    rows.push({city:city.city,name:place.name,entityId:place.entityId,sqlNames:1+place.aliases.length,diagnostics,passed:failures.length===0,failures});
    if(rows.length%10===0)console.log(JSON.stringify({checked:rows.length,failed:rows.filter(r=>!r.passed).length}));
  }
}finally{await client.query('ROLLBACK').catch(()=>{});await client.end();}
const report={readOnly:true,snapshotSha256:ranking.snapshotSha256,rows,passed:rows.every(r=>r.passed),
  limits:'真实SQL及启用向量的混合召回，不声称纯向量单独命中、原始来源语义已审完或外部模型/地图端到端验证。'};
await writeFile(outputFile,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
if(!report.passed)process.exitCode=1;
