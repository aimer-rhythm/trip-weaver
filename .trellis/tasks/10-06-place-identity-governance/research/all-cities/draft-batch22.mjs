// 济南：恢复原始分店限定和图片地址证据；连锁泛称只清理错误地理绑定。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {reviewedImageContexts} from './image-review-context.mjs';
const base=new URL('./',import.meta.url),batch='batch-22';
const read=file=>JSON.parse(fs.readFileSync(new URL(file,base),'utf8'));
for(const suffix of ['image-context','selections','review-selections','prerequisites','decisions','review-decisions','applied'])
  assert.ok(!fs.existsSync(new URL(`${batch}-${suffix}.json`,base)),`不能覆盖${suffix}`);
const context='jinan-food-variants-01.json', imageFile=`${batch}-image-context.json`;
const imageContexts=reviewedImageContexts(base,[
  {contextFile:context,mentionId:12843,manifestFile:'jinan-food-images-01/manifest.json',index:11,
    observations:'2849正文明确芙蓉楼百年鲁菜馆(芙蓉街店)，原始提及括号曾被normalized_name去掉。P12为橙色座垫、黑色靠背、木框花纹隔板的卡座，与2850餐桌场景相符；该室内风格只作辅助，不凭菜品或同款装修单独证明同店。'},
  {contextFile:context,mentionId:12854,manifestFile:'jinan-food-images-01/manifest.json',index:10,
    observations:'2850 P11直接拍到芙蓉楼鲁菜馆沿街门面，红色侧招明确百年鲁菜、地道济南菜。正文和标题限定芙蓉街老街，与2849明确芙蓉街店的正式名称互证；不是另一家只因菜品相似的餐厅。'},
  {contextFile:context,mentionId:12894,manifestFile:'jinan-food-images-01/manifest.json',index:6,
    observations:'2856 P7直接写洪家楼教堂旁边、只卖麻花老婆饼蛋挞3种，左上门面为石质尖顶小门、奶香脆皮麻花红字招牌。与2602原文台湾奶香脆皮麻花（洪家楼北路）及公开视频洪楼教堂旁台湾奶香脆皮麻花标题共同定位；补足原来只看正文未找到分店的缺口。'},
]);
const clearRows=[
  ['326cd34165dd905d31af6cd929a0deda','杨家牛肉烧饼',11629,
    '2602明确杨家在回民小区清真南大寺，且特别排除远郊党家庄门店；旧36.204366/117.688582远离中心回民小区，不能用于这家店。',
    '济南市回民小区清真南大寺附近，具体门牌待核'],
  ['665e9903d644a1b41ce76e27467fb353','牛肉烧饼',11484,
    '2560明确回民小区排队王，旧福泰路623号附近、经度117.533862在远东侧，与中心回民小区冲突；泛称尚不能指定杨家或其他店。',
    '济南市回民小区，原笔记未明确店名'],
  ['bb53ff904464fb67e2ddf46d7ed0d2b8','穆德老周家牛肉烧饼',12961,
    '2839明确看完泉源之眼后吃饭、饭后步行回五龙潭旁沃德酒店，旧纬度36.463688在远南侧，与原文夜间骑行/饭后步行范围冲突；不据路线猜具体分店。',
    '济南市五龙潭周边原文夜游路线，老周家具体分店待核'],
  ['d025994fc1b1449de922fa97abdd96f8','老周家牛肉烧饼',11510,
    '2607明确老周家为连锁、各店差不多、趵突泉周边就近即可，未将此条品牌泛称限定到普利街77号；撤销单一分店精确点，待拆分实际门店归属。',
    '济南市趵突泉周边老周家连锁门店，具体分店待核'],
];
const selections=[
  {reviews:[380],primary:'芙蓉楼百年鲁菜馆',canonicalName:'芙蓉楼百年鲁菜馆（芙蓉街店）',
    reason:'已恢复12843原始名称芙蓉楼百年鲁菜馆(芙蓉街店)，原记录缺提及仅因括号被规范化去掉。2850正文同样明确芙蓉街老街，P11直接展示芙蓉楼鲁菜馆与百年鲁菜门头，餐厅环境互相吻合；确认同一芙蓉街门店，保持主ID并恢复分店限定。不是仅凭同地图点或同菜品合并。',
    geometryReason:'保留主源5983已有GCJ-02参考点36.665964/117.023158，范围与原文明示芙蓉街一致；不采用广告同时距三景点100m的夸张距离，也不从其他餐厅地址推造新点。',
    contexts:[{file:imageFile,mentionIds:[12843,12854]}]},
  {reviews:[374],primary:'台湾奶香脆皮麻花',
    reason:'2602原文明确台湾奶香脆皮麻花在洪家楼北路；此前2856只读正文未明确分店，现原图P7明确洪家楼教堂旁边并展示该处奶香脆皮麻花小门面。已抓取2023公开视频标题独立称洪楼教堂旁台湾奶香脆皮麻花，连接两种叫法，确认此两条来源是同一教堂旁门店。',
    geometryReason:'沿用主源5471已有GCJ-02点36.685957/117.065448、洪家楼1正北方向20米，与洪家楼北路教堂旁原图文相合。360抓取实际是另一家紫菜包饭，不借其坐标或地址替代本店。',
    sources:['jinan-mahua-video-fetch.json'],contexts:[{file:imageFile,mentionIds:[12894]},{file:context,mentionIds:[11675]}]},
  ...clearRows.map(([id,name,mention,reason,address])=>({reviews:[],city:'济南',entityIds:[id],primary:name,reason,
    geometryReason:'经纬度成对清空并同步unresolvable，保留稳定ID；没有可靠门店定位时不借附近景点或同品牌分店的坐标。',
    overrides:{lat:null,lng:null,address,geoStatus:'unresolvable'},contexts:[{file:context,mentionIds:[mention]}]})),
];
const reviewSelections=[
  {review:376,verdict:'uncertain',explanation:'已恢复11527原名穆得·老周家牛肉烧饼，之前精确同名查不到是中间点被规范化去掉，不再称无原始来源。2563仅列品牌，无分店地址；2607明确连锁各店就近选择，不能确定同一门店。品牌泛称本批撤销单一分店点，继续待分店证据。',contexts:[{file:context,mentionIds:[11527,11510]}]},
  {review:377,verdict:'uncertain',explanation:'2607明确老周家连锁就近选店；2839只说明夜游泉源之眼后吃饭再步行回五龙潭旁酒店，不能唯一确定分店。两条本批分别清除品牌泛称绑定点和远南侧错点，不把地理清理当成身份合并。',contexts:[{file:context,mentionIds:[11510,12961]}]},
  {review:378,verdict:'uncertain',explanation:'已找回11527穆得·老周家原始提及，撤销缺原始生成来源的旧理由。但2563是沿线美食品牌名单，2839仅有老城区夜游与酒店相对位置；两者仍无对应门牌，不能仅凭穆得/穆德字形相近跨连锁分店合并。',contexts:[{file:context,mentionIds:[11527,12961]}]},
];
for(const [suffix,data] of [['image-context',imageContexts],['selections',selections],['review-selections',reviewSelections],['prerequisites',['batch-09']]])
  fs.writeFileSync(new URL(`${batch}-${suffix}.json`,base),JSON.stringify(data,null,2)+'\n',{flag:'wx'});
for(const script of ['build-batch.mjs','build-reviews.mjs']) {
  const result=spawnSync(process.execPath,[fileURLToPath(new URL(script,base)),batch],{windowsHide:true,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);process.stdout.write(result.stdout);
}
const current=new Map(read('audit/run-16/snapshot.json').entities.map(e=>[e.entity_id,e]));
for(const d of read(`${batch}-decisions.json`)) for(const [id,revision] of Object.entries(d.expectedRevisions)) {
  assert.equal(current.get(id)?.revision,revision);assert.ok(!current.get(id).redirect_to);
}
console.log(JSON.stringify({merges:2,coordinateCorrections:4,reassessments:3}));
