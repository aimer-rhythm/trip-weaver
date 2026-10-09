// 西安：寺院与景区保留包含边界，三个错误地图点独立撤销。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const base=new URL('./',import.meta.url),batch='batch-23';
const read=file=>JSON.parse(fs.readFileSync(new URL(file,base),'utf8'));
for(const suffix of ['selections','review-selections','prerequisites','supplements','decisions','review-decisions','applied'])
  assert.ok(!fs.existsSync(new URL(`${batch}-${suffix}.json`,base)),`不能覆盖${suffix}`);
const context='xian-batch13-context.json';
const sources=['xian-qianlong-tourgroup-fetch.json','xian-qianlong-cri-fetch.json','xian-qianlong-baike-fetch.json'];
const temple='4a4505a1baed0f14c8a4fe6386bc5798',area='cac7b5d4f244dad808626ba1590c38f2';
const geometryReason='成对撤销与原文明示地点冲突的旧坐标，保持稳定ID；公开资料只证明行政位置与实体范围，没有核实GCJ-02精确点，不据网页地名猜坐标。';
const selections=[
  {reviews:[],city:'西安',entityIds:[temple],primary:'潜龙寺',
    reason:'12551及note2760明确乘缆车到少华山山顶潜龙寺拍红墙，2641路线也分列索道、潜龙寺和玻璃栈道。陕旅集团及国际在线正文确认少华山在渭南华州，旧34.241770/108.902733在西安高新市区，不能作为该寺定位。寺院保留独立身份，不能因两名同一错误点归并。',
    geometryReason,overrides:{lat:null,lng:null,address:'陕西省渭南市华州区少华山国家森林公园潜龙寺，具体定位待核',geoStatus:'unresolvable'},
    sources,contexts:[{file:context,mentionIds:[12551,12026]}]},
  {reviews:[],city:'西安',entityIds:[area],primary:'潜龙寺景区',
    reason:'12455及note2775在少华山攻略中明确使用潜龙寺景区名称。陕旅集团把它列为公园五大景区之一；公开词条区分景区与寺院并列出其范围、其他景点和游览轴。原34.241770/108.902733误在西安高新，清空后不把整个分区绑定寺门或索道口。',
    geometryReason,overrides:{lat:null,lng:null,address:'陕西省渭南市华州区少华山国家森林公园潜龙寺景区，范围定位待核',geoStatus:'unresolvable'},
    sources,contexts:[{file:context,mentionIds:[12455,12026]}]},
  {reviews:[],city:'西安',entityIds:['202788eb4f60cff0ca71ae79e5709fa1'],primary:'开元商城6楼观景平台',
    reason:'2725 P6明确开元商城6楼可拍钟楼与鼓楼同框；2721完整路线通过钟楼站E口进入商城北门，分列5楼两处平台和6至7楼步梯。旧经度108.912271偏离钟楼开元商城约3公里，不能用于该六楼机位。仍需原图确定具体平台，不借5楼或7楼机位的点。',
    geometryReason,overrides:{lat:null,lng:null,address:'西安市钟楼旁开元商城6楼观景平台，具体机位待核',geoStatus:'unresolvable'},
    contexts:[{file:context,mentionIds:[12224,12099]},{file:'xian-batch13-variant-context.json',mentionIds:[12354]}]},
];
const reviewSelections=[
  {review:425,verdict:'part_of',childEntityId:temple,
    explanation:'原12551明确山顶潜龙寺红墙，是寺院本体；12455明确潜龙寺景区。现已抓取陕旅集团官网（来源少华山）与国际在线（来源渭南市委宣传部）正文，均列其为少华山五大景区之一。公开词条进一步明确景区因寺得名、范围约360公顷、内部以寺为中心含多处景点和游览轴，寺院不是整个分区的同义词。登记潜龙寺part_of潜龙寺景区，保留各自ID；两条西安高新错点同步清除。范围与行政区证据不用于生成精确坐标、开放时间或门票事实。',
    sources,contexts:[{file:context,mentionIds:[12551,12455,12026]}]},
  {review:383,verdict:'uncertain',
    explanation:'12099的开元商城观景台覆盖5至7楼，12224专指6楼。2721完整图文分列5楼两个平台、通往6至7楼的步梯及7楼平台，仍不能把泛称与六楼具体机位合并。本批已成对清空六楼旧108.912271远端点并保持ID，坐标纠错不等于实体边界已确认；继续待原图对应。',
    contexts:[{file:context,mentionIds:[12099,12224]},{file:'xian-batch13-variant-context.json',mentionIds:[12354]}]},
];
for(const [suffix,data] of [['selections',selections],['review-selections',reviewSelections],['prerequisites',['batch-13']],
  ['supplements',['xian-batch13-supplement.json']]])
  fs.writeFileSync(new URL(`${batch}-${suffix}.json`,base),JSON.stringify(data,null,2)+'\n',{flag:'wx'});
for(const script of ['build-batch.mjs','build-reviews.mjs']) {
  const result=spawnSync(process.execPath,[fileURLToPath(new URL(script,base)),batch],{windowsHide:true,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);process.stdout.write(result.stdout);
}
const current=new Map(read('audit/run-18/snapshot.json').entities.map(e=>[e.entity_id,e]));
for(const d of read(`${batch}-decisions.json`)) for(const [id,revision] of Object.entries(d.expectedRevisions)) {
  assert.equal(current.get(id)?.revision,revision);assert.ok(!current.get(id).redirect_to);
}
console.log(JSON.stringify({merges:0,coordinateCorrections:3,partOf:1,uncertainUpdated:1}));
