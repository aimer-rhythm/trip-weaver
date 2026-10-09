// 已逐篇审阅的14条历史名称认领；只写冻结文件，数据库只读。
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { Client } from 'pg';
import { parse } from 'dotenv';
const here=new URL('./',import.meta.url),research=new URL('../',here);
const evidenceFile='retained-place-sources-1791366327590.json';
const bytes=fs.readFileSync(new URL(evidenceFile,research));
const evidence=JSON.parse(bytes),hash=createHash('sha256').update(bytes).digest('hex');
const plans=[
  [3,2065,[[1145,'TIGER➡️五十六朵花➡️DULTON'],[1147,'五十六朵花艺术空间（超赞）']],
    '两篇798步行原文在TIGER邻近的同一店铺位置分别使用简称和全名，源2065及旧行同为红石广场处；认领艺术空间全名，不包含铁匠营或整个798。'],
  [5,1060,[[1208,'[一R] 香山碧云寺'],[401,'双清别墅 ➡️ 碧云寺']],
    '原文明确为香山碧云寺及其罗汉殿院落，另一篇路线将碧云寺与香山寺、双清别墅分开；补地理限定名，仅认领寺院旧ID。'],
  [9,2140,[[402,'图7：颐和园十七孔桥'],[404,'图7️⃣ 颐和园十七孔桥']],
    '两篇摄影清单明确独立十七孔桥，旧行与桥源2140地址坐标相同；补园名限定，不并入颐和园。'],
  [14,1148,[[402,'图2：中乐六星酒店楼顶餐厅'],[404,'图2️⃣ 中乐六星酒店顶楼餐厅']],
    '相同机位清单以楼顶/顶楼两种词序描述同一酒店餐厅；两个名称源1148与旧行一致，不将酒店整体作为餐厅别名。'],
  [16,1027,[[401,'➡️玉渊潭公园'],[1128,'玉渊潭：彩叶倒映碧水']],
    '市区赏秋原文的玉渊潭指公园，与原提及及同地址源1027互证；不包含钓鱼台银杏大道。'],
  [17,989,[[1051,'去圆明园，不赏无人花海等于白玩了'],[1051,'📍地点：圆明园遗址公园']],
    '同一篇标题和地点字段交替称圆明园/圆明园遗址公园，正文另分西洋楼遗址收费区和花海；补全园正式名，不吸收子项。'],
  [18,1289,[[522,'延庆百里山水画廊是我在北京周边发现的'],[522,'✅导航：百里山水画廊游客服务中心']],
    '同篇全名和简称均指延庆山水画廊游线，乌龙峡谷、硅化木、滴水壶单列；沿用已审阅1289身份与坐标，补延庆限定名。'],
  [22,1062,[[1087,'五塔寺、慕田峪、动物园'],[1128,'慕田峪长城：长城蜿蜒红叶山脊']],
    '原提及4491景点清单的慕田峪指长城游览，与长城源1062及其他赏秋正文互证；不把慕田峪村登记为别名。'],
  [24,833,[[408,'2. 紫竹院公园'],[401,'➡️紫竹院公园 ➡️ 国图']],
    '两篇原文明确公园游览，旧行与紫竹院源833地址一致；认领公园名称，不合并独立欢乐冰雪季实体。'],
  [26,1484,[[702,'📍香山（P2,P3,P10,P11）：勤政殿拍红叶'],[1126,'检票进东门，迎面就是勤政殿'],[1125,'🍁 香山公园']],
    '香山原文说明检票入园和园内勤政殿、双清别墅、香炉峰路线，现有旧行来自公园源1484；补公园简称，寺、东门和地铁站保持独立。'],
  [27,756,[[604,'妙应寺白塔➡北京历代帝王庙➡广济寺'],[1110,'📍北京历代帝王庙，了解中国古代帝王历史和祭祀文化']],
    '两篇原文分别为阜成门周边路线和庙宇文化游览，旧行与源756同地址同点；补城市前缀全名。'],
  [28,1474,[[1096,'📍位置：北海公园西北角万佛楼遗址'],[1096,'万佛楼属于园中园']],
    '全文明确北海园中园的万佛楼遗址，独立开放时间只属于该子项；认领带北海公园前缀的旧名称，不并入北海或小西天。'],
  [38,1648,[[940,'成都东郊记忆｜citywalk一日游'],[940,'南大门👉成都大字墙👉中央大道'],[940,'3️⃣成都墙']],
    '同篇东郊记忆路线与小标题交替使用成都大字墙/成都墙，旧提及3914及旧行明确来自1648；只补已出现旧名成都墙，不并入园区或斜对面二楼机位。'],
  [45,11,[[316,'#洪崖洞民俗风貌区[poi_v2]#'],[316,'戴家巷→洪崖洞']],
    '原笔记POI全名与路线简称对应同一洪崖洞景区，金集活动描述吊脚楼建筑群且与源11坐标一致；认领金集全名旧ID，保留独立戴家巷和外围机位。'],
];
const decisions=plans.map(([index,sourceId,quotes,conclusion],i)=>{
  const group=evidence.groups[index-1];
  const entity=group.candidates.find(e=>String(e.primary_place_id)===String(sourceId));
  assert.ok(entity);assert.equal(entity.redirect_to,null);
  for(const [noteId,quote] of quotes) {
    const note=evidence.notes.find(n=>String(n.id)===String(noteId));
    assert.ok(note&&`${note.title}\n${note.desc}`.includes(quote),`引文不在冻结原文：${noteId} ${quote}`);
  }
  return {key:`all-cities-20261007-batch-27-${String(i+1).padStart(3,'0')}`,city:group.stored.city,
    entityId:entity.entity_id,mergeEntityIds:[],canonicalName:entity.canonical_name,aliases:[group.stored.name],
    expectedRevisions:{[entity.entity_id]:entity.revision},overrides:{},evidence:[
      {kind:'reviewed_full_source_and_downstream_snapshot',file:evidenceFile,sha256:hash,conclusion},
      {kind:'reviewed_legacy_alias',sourcePlaceId:sourceId,legacyId:group.stored.id,
        mentionIds:group.mentions.filter(m=>m.name===group.stored.name).map(m=>Number(m.id)),
        noteIds:quotes.map(([id])=>id),quotes:quotes.map(([noteId,quote])=>({noteId,quote})),goldset:group.goldset}
    ]};
});
const base=JSON.parse(fs.readFileSync(new URL('source-snapshot.json',here)));
const missing=decisions.filter(d=>!base.entities.some(e=>e.entity_id===d.entityId)).map(d=>d.entityId);
const config=parse(fs.readFileSync(new URL('../../../../../../xhs-travel-pipeline/.env',here)));
const client=new Client({connectionString:config.DATABASE_URL.replace('postgresql+asyncpg:','postgresql:'),connectionTimeoutMillis:10000});
try {
  await client.connect();await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const current=(await client.query(`SELECT entity_id,city,canonical_name,primary_place_id,aliases,legacy_ids,revision,status,redirect_to,overrides,evidence
    FROM place_entity WHERE entity_id=ANY($1::text[]) ORDER BY entity_id`,[decisions.map(d=>d.entityId)])).rows;
  for(const decision of decisions) assert.equal(current.find(e=>e.entity_id===decision.entityId)?.revision,decision.expectedRevisions[decision.entityId]);
  const supplement=[];
  for(const entity of current.filter(e=>missing.includes(e.entity_id))) {
    assert.equal(entity.revision,1,'补充非初始版本须另行明确隔离预演基线');
    const places=(await client.query(`SELECT p.id,p.name,p.normalized_name,p.city,p.address,p.latitude,p.longitude,p.amap_poi_id,p.place_type,p.geo_status,p.is_active,m.entity_id
      FROM canonical_place p JOIN place_entity_member m ON m.place_id=p.id WHERE m.entity_id=$1 ORDER BY p.id`,[entity.entity_id])).rows;
    supplement.push({...entity,places});
  }
  const outputs={'batch-27-decisions.json':decisions,'batch-27-prerequisites.json':['batch-06','batch-07'],
    'batch-27-supplements.json':['retained-batch27-supplement.json'],
    'retained-batch27-supplement.json':{readOnly:true,sourceAudit:evidenceFile,entities:supplement,reviews:[]}};
  for(const file of Object.keys(outputs)) assert.ok(!fs.existsSync(new URL(file,here)),`不能覆盖${file}`);
  for(const [file,value] of Object.entries(outputs)) fs.writeFileSync(new URL(file,here),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({decisions:decisions.length,merges:0,missingSources:supplement.length,
    cities:[...new Set(decisions.map(d=>d.city))],evidenceHash:hash}));
}finally{await client.query('ROLLBACK').catch(()=>{});await client.end();}
