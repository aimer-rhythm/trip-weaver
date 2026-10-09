// 重庆原文定位纠错：保留稳定ID及待审边界，不以同名或街名推断合并。
import fs from 'node:fs';
import assert from 'node:assert/strict';
const base=new URL('./',import.meta.url);
const read=file=>JSON.parse(fs.readFileSync(new URL(file,base),'utf8'));
const files=['batch-17-selections.json','batch-17-review-selections.json','batch-17-supplements.json','batch-17-prerequisites.json'];
for(const file of [...files,'batch-17-applied.json']) assert.ok(!fs.existsSync(new URL(file,base)),`不可覆盖${file}`);
const entities=read('source-snapshot.json').entities;
const items=[
  ['呼归石花阶花园八角亭','重庆市南岸区呼归石花阶花园八角亭，精确亭址待核','景点',[1758],
    'note182明确呼归石花阶花园往上几十米的八角亭；旧点却匹配崇文路南山景区。撤销错点，保持已审核的公园/亭子包含边界，不借用公园中心坐标。'],
  ['重庆爱乐之城','重庆市江北区大剧院地铁站4号口附近摄影点，精确机位待核','景点',[1255],
    'note281明确大剧院站4号口看洪崖洞全貌，旧定位大足区爱乐之城与江岸景观冲突。清空错点，不与下浩里后步行场景的爱乐之城强并。'],
  ['爱乐之城','重庆市爱乐之城摄影场景，原路线位于下浩里步行范围，精确机位待核','景点',[705],
    'note249路线图明确下浩里后步行8分钟到爱乐之城；旧点在沙坪坝金沙天街4栋房间，与路线不符。清空错误商业门店点，继续保留摄影昵称的边界待审。'],
  ['范嬢嬋糯米团','重庆市范嬢嬢糯米团，原提及春森路路线，门店归属待核','美食',[746],
    'note75原文为范嬢嬢糯米团，抽取名错一字；旧点30.3129539/107.3701436反复用于无地址记录，远离原文渝中春森路路线。清空错误远郊点，原来源可确认是美食门店，批准无坐标导出；分店归属未确认，不先增添与另一实体冲突的永久别名。'],
  ['范嬢嬢糯米团','重庆市范嬢嬢糯米团，具体门店归属待核','美食',[410,816,839,1337],
    'note254早餐后步行三峡博物馆，note28只列早餐品牌；旧点30.3129539/107.3701436显然不能代表该早餐门店。清空远郊点并将景点纠回美食，批准无坐标导出；泛名来源仍未全部绑定具体摊位。'],
  ['第一户农家','重庆市北碚区胜天湖徒步线第一户农家摄影点，精确位置待核','景点',[1457],
    'note345明示北碚偏岩街135号水上公路起点，胜天湖水库大坝、竹林、第一户及第二户农家依次游览。两户不能使用旧地图巴南区同一个泛农家点；清空坐标并保留两个独立ID。'],
  ['第二户农家','重庆市北碚区胜天湖徒步线第二户农家摄影点，精确位置待核','景点',[1458],
    'note345在第一户后另列第二户农家，描述开阔视野、土墙房子和地坝；旧点却与第一户同落巴南区泛农家。清空错点，不平均、不相互借用坐标。'],
  ['长嘉汇购物广场','重庆市南岸区长嘉汇观景场景，购物公园与广场边界待核','景点',[535,1118,1614],
    'note7为南滨路长嘉汇观看无人机的机位，旧地址仅重庆市，点29.562680/106.551787是城市中心默认值。清空不相干中心点，购物公园/广场/平台粒度继续待核。'],
  ['呼归石公交站对面','重庆市南岸区南滨路呼归石公交站对面摄影点，精确机位待核','景点',[1119],
    'note7的P4明确呼归石公交站对面，旧地图地址373路、坐标为公交站本身。撤销借用站体的精确点，保持站外机位独立；未把对面定义为车站永久别名。'],
];
const selections=items.map(([primary,address,category,mentionIds,reason])=>{
  const entity=entities.find(e=>e.city==='重庆'&&e.canonical_name===primary);assert.ok(entity,primary);
  const inactive=entity.places.every(p=>!p.is_active);
  return {reviews:[],city:'重庆',entityIds:[entity.entity_id],primary,reason,
    overrides:{lat:null,lng:null,address,category,geoStatus:'unresolvable',...(inactive?{exportApproved:true}:{})},
    geometryReason:reason,contexts:[{file:'chongqing-batch14-context.json',mentionIds}]};
});
const branch=entities.find(e=>e.canonical_name==='范嬢嬢春森路糯米团'&&e.city==='重庆');assert.ok(branch);
selections.push({reviews:[],city:'重庆',entityIds:[branch.entity_id],primary:branch.canonical_name,
  reason:'note34将其列为美食；新抓取Trip门店正文明确学田湾正街59号、春森路社区入口，与旧地图地址一致。春森路是门店名及社区名的一部分，不能仅凭两个街名不同清空该坐标。仅纠正类别，保留已有定位。',
  overrides:{category:'美食'},geometryReason:'门店正文支持现有地址，保留旧GCJ-02定位；未从搜索摘要提取或新造坐标。',
  sources:['chongqing-fan-trip-fetch.json'],contexts:[{file:'chongqing-batch14-context.json',mentionIds:[507,1065]}]});
const review=[
  {review:453,verdict:'uncertain',explanation:'补充门店正文确认范嬢嬢春森路糯米团位于学田湾正街59号春森路社区入口，原先将春森路与学田湾视作不同分店的推断没有依据。746原文确有抽取错字；839早餐后步行三峡博物馆与该店相容，但note28泛品牌推荐仍缺具体门店，尚不据此把全部源合并。本批仅撤销两泛名远郊错点，保留边界待核。',mentionIds:[746,410,816,839,1337]},
  {review:454,verdict:'uncertain',explanation:'新抓取Trip门店正文直接写明学田湾正街59号春森路社区入口，507/1065只提供店名，未写所在街道。旧评估所称春森路店与学田湾地址冲突不成立，现保留该店坐标并纠正美食类别。839行程与该店相容，但410/816/1337泛名源仍未明确分店，暂不把所有范嬢嬢提及归为一个门店。',mentionIds:[507,1065,410,816,839,1337]},
].map(({mentionIds,...item})=>({...item,sources:['chongqing-fan-trip-fetch.json'],contexts:[{file:'chongqing-batch14-context.json',mentionIds}]}));
for(const[file,data]of [[files[0],selections],[files[1],review],[files[2],['chongqing-batch14-supplement.json']],[files[3],['batch-14']]])
  fs.writeFileSync(new URL(file,base),JSON.stringify(data,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({coordinateCorrections:items.length,categoryOnly:1,merges:0,reassessments:review.length}));
