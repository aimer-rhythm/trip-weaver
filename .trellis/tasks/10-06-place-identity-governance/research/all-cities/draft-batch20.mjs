// 用原图核实上海高空观景台；道路范围未定时只清错坐标。
// 新请求的根与revision取自冻结实库审计，并由历史依赖隔离重建校验。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {reviewedImageContexts} from './image-review-context.mjs';
const base=new URL('./',import.meta.url);
const read=file=>JSON.parse(fs.readFileSync(new URL(file,base),'utf8'));
const hash=file=>createHash('sha256').update(fs.readFileSync(new URL(file,base))).digest('hex');
const batch='batch-20';
for(const suffix of ['image-context','selections','review-selections','prerequisites','supplements','decisions','review-decisions','applied'])
  assert.ok(!fs.existsSync(new URL(`${batch}-${suffix}.json`,base)),`不能覆盖${suffix}`);
const imageFile=`${batch}-image-context.json`;
const observations=[
  {contextFile:'shanghai-batch02-context.json',mentionId:10982,manifestFile:'shanghai-chongqing-images-01/manifest.json',index:12,
    observations:'2497 P13俯拍外滩，海关钟楼、左侧穹顶、后方威斯汀楼冠和更远楼群的相对遮挡、岸线倾斜与2495 P4及2498 P6吻合。是高空观景视角，不是白玉兰广场低层平台。结合原文SMP白玉兰观景台与另两篇The Stage同视角，确认同一高空观景台；正文笼统免费不能据此成为门票事实。'},
  {contextFile:'shanghai-batch02-context.json',mentionId:10934,manifestFile:'shanghai-stage-images-01/manifest.json',index:3,
    observations:'2495正文明确The Stage，P4俯拍海关大楼与威斯汀楼冠；钟楼、穹顶、后方带灯檐矮塔与高楼的排列、遮挡和屋顶可见程度与2497 P13一致。已查看整篇联系表，另有The Stage现场招牌及平台设施，正文与图片共同支持高空场所。'},
  {contextFile:'shanghai-batch02-context.json',mentionId:11025,manifestFile:'shanghai-stage-images-01/manifest.json',index:5,
    observations:'2498 P6为海关大楼更近景，钟楼与穹顶、后方高楼的位置和俯视屋顶角度与2497 P13一致。整篇联系表的蓝色The Stage楼梯、玻璃栏杆及红色旋梯与2495对应，作为独立笔记互证。'},
  {contextFile:'shanghai-full-context.json',mentionId:9921,manifestFile:'shanghai-chongqing-images-01/manifest.json',index:1,
    observations:'2309 P2为苏州河边露天座位，画面桥名乍浦路桥、远处东方明珠与上海中心可见，支持市中心河畔；不支持旧31.557167/121.214662远端点。图片未提供可直接转录的GCJ-02坐标。'},
  {contextFile:'shanghai-full-context.json',mentionId:9923,manifestFile:'shanghai-chongqing-images-01/manifest.json',index:3,
    observations:'2309 P4有OLD SIX CAFE店招、沿街秋千和旧建筑，未见完整可读路牌门牌；旧经度120.402989不在原文上海中心苏州河路线。图片本身不足以确定道路泛名边界，不能借店面为整条路造精确点。'},
  {contextFile:'shanghai-full-context.json',mentionId:9924,manifestFile:'shanghai-chongqing-images-01/manifest.json',index:4,
    observations:'2309 P5是The Riverside招牌、粉橙外墙与白色圆柱的门面，没有可读门牌路牌。原文苏州路只有本页一条提及；公开检索尚未确定这家门店地址。旧兆丰路18号亚太广场5号楼20层办公楼与本页河畔门面不符，清坐标但不猜北岸或南岸。'},
];
const stage='d4a291993f56fc8f715afc31b2a85633';
const roadRows=[
  ['10d3fb61125f3b83e496360c9ef7824e','苏州路',9924,'原文P5位于苏州河漫步线路，原图为The Riverside沿街门面；旧兆丰路18号办公楼地址与图文冲突，具体河岸仍缺证据。','上海市苏州河沿岸，原文苏州路具体路段待核'],
  ['2db9dd317f84c8e10dcd4f576cbe8f3a','北苏州路',9921,'原文及P2乍浦路桥、陆家嘴天际线支持中心城区苏州河畔；旧31.557167/121.214662远端点没有地址或POI支持。','上海市苏州河北岸，原文北苏州路漫步路段'],
  ['ffa308a26ffdce1b639b8104b005b5ca','南苏州路',9923,'原文P4列南苏州路、原图沿街咖啡店，旧经度120.402989显然不支持上海中心苏州河路线；不据未核门店推造坐标。','上海市苏州河沿岸，原文南苏州路具体机位待核'],
];
const selections=[{
  reviews:[40],entityIds:[stage],primary:'上海白玉兰观景台',canonicalName:'The Stage上海白玉兰观景台',
  reason:'2497 P13补足此前未看的原图：海关钟楼、穹顶与威斯汀楼冠、后方楼群排列遮挡和屋顶可见程度，与明确写The Stage的2495 P4及2498 P6吻合。结合SMP白玉兰名称及官方高空视角，确认同一The Stage观景台，撤销仅凭免费文案猜测低层平台的疑虑。保留现有稳定主ID和历史成员，不将广场3层露台或楼宇本体并入；免费文案不采信为门票事实。',
  geometryReason:'继续使用batch-02已核实的主源建筑GCJ-02点31.249151/121.498046，精度仍为建筑参考点；SMP旧北郊坐标不参与平均。',
  overrides:{lat:31.249151,lng:121.498046,address:'上海市虹口区北外滩街道东长治路588号',geoStatus:'reviewed_source'},
  sources:['shanghai-magnolia-official-fetch.json','shanghai-stage-kkday-fetch.json'],
  contexts:[{file:imageFile,mentionIds:[10982,10934,11025]}],
},...roadRows.map(([id,name,mention,reason,address])=>({reviews:[],city:'上海',entityIds:[id],primary:name,reason,
  geometryReason:'旧点与原文中心城区苏州河范围矛盾，未取得可靠精确点，经纬度成对清空；ID不变。',
  overrides:{lat:null,lng:null,address,geoStatus:'unresolvable'},contexts:[{file:imageFile,mentionIds:[mention]}]}))];
const reviewSelections=[7,8].map(review=>({review,verdict:'uncertain',
  explanation:'2309原图已补看：P2是乍浦路桥旁河畔座位，P4有OLD SIX CAFE，P5苏州路是The Riverside门面。P5无可读路牌门牌，检索尚未取得该店址互证，不能把苏州路指定为北岸或南岸。三条独立记录本批清理不成立的旧远端点；待具体机位/道路归属证据后再决定是否同体。',
  contexts:[{file:imageFile,mentionIds:[9921,9923,9924]}]}));
for(const [suffix,data] of [['image-context',reviewedImageContexts(base,observations)],['selections',selections],
  ['review-selections',reviewSelections],['prerequisites',['batch-02','batch-11']],['supplements',['shanghai-batch11-supplement.json']]])
  fs.writeFileSync(new URL(`${batch}-${suffix}.json`,base),JSON.stringify(data,null,2)+'\n',{flag:'wx'});
const build=spawnSync(process.execPath,[fileURLToPath(new URL('build-batch.mjs',base)),batch],{windowsHide:true,encoding:'utf8'});
assert.equal(build.status,0,build.stderr);process.stdout.write(build.stdout);
// 通用旧快照转换器不能直接重放已合并成员；按冻结实库的当前根归并请求ID。
const auditFile='audit/run-14/snapshot.json';
const audit=read(auditFile);assert.equal(audit.readOnly,true);
const current=new Map(audit.entities.map(e=>[e.entity_id,e]));
const root=id=>{const seen=new Set();while(current.get(id)?.redirect_to){assert.ok(!seen.has(id));seen.add(id);id=current.get(id).redirect_to;}return current.get(id);};
const used=new Set();
const decisions=read(`${batch}-decisions.json`).map(d=>{
  const primary=root(d.entityId);assert.ok(primary&&primary.status==='ACTIVE');
  const ids=[...new Set([d.entityId,...d.mergeEntityIds].map(id=>root(id).entity_id))];
  for(const id of ids){assert.equal(current.get(id).city,d.city);assert.ok(!used.has(id));used.add(id);}
  return {...d,entityId:primary.entity_id,mergeEntityIds:ids.filter(id=>id!==primary.entity_id),
    expectedRevisions:Object.fromEntries(ids.map(id=>[id,current.get(id).revision])),
    evidence:[...d.evidence,{kind:'reviewed_current_identity_snapshot',file:`all-cities/${auditFile}`,sha256:hash(auditFile),
      conclusion:'请求根与revision来自冻结实库审计，不重放已合并旧成员；前序batch-02、11在隔离库重建后验证相同版本。'}]};
});
assert.deepEqual(decisions[0].mergeEntityIds,['28ba3f2a3ed5b7dc4c1619bc91223c65']);
assert.equal(decisions[0].entityId,stage);
fs.writeFileSync(new URL(`${batch}-decisions.json`,base),JSON.stringify(decisions,null,2)+'\n');
console.log(JSON.stringify({merges:1,coordinateCorrections:3,reassessments:2,currentIdentitySnapshot:auditFile}));
