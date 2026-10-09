// 独立坐标纠错及已证实的线路包含关系；不合并实体、不连接业务库。
import fs from 'node:fs';
import assert from 'node:assert/strict';
const base=new URL('./',import.meta.url);
const read=file=>JSON.parse(fs.readFileSync(new URL(file,base),'utf8'));
const files=['batch-16-selections.json','batch-16-review-selections.json','batch-16-supplements.json','batch-16-prerequisites.json'];
for(const file of [...files,'batch-16-applied.json']) assert.ok(!fs.existsSync(new URL(file,base)),`不可覆盖${file}`);
const entities=[...read('source-snapshot.json').entities,...read('xiamen-batch15-transit-supplement.json').entities];
const contexts=['xiamen-batch15-context.json','xiamen-batch15-variant-context.json','xiamen-batch16-transit-context.json'].map(file=>({file,rows:read(file)}));
const items=[
  ['曾厝垵站','厦门市思明区曾厝垵公交站，精确站位待核','交通','5744原文说别在曾厝垵站下车、曾山站到海边；旧点118.063212/24.447955落在鼓浪屿，显然不是思明环岛路公交站。保持站点ID，与曾厝垵街区独立。'],
  ['阿吉仔饼铺','厦门市思明区阿吉仔饼铺，原提及中山路店，分店归属待核','美食','1421原文明确中山路店，1267亦为中山路小吃路线；旧定位后江埭路店不能绑定到这组提及。清空精确点，不以改名或合并解决混合分店。'],
  ['八市阿杰五香','厦门市思明区八市阿杰五香，分店归属待核','美食','1421明确大元路分店，旧点却是开禾路111号；1398为品牌泛称，尚未全部定位。清空混合分店记录的固定坐标，保留167/168待审。'],
  ['郑有财海鲜砂锅粥','厦门市郑有财海鲜砂锅粥，具体分店门牌待核','美食','1398是郑有财海鲜粥推荐，旧地图实际为海沧漳浦海鲜新阳居住区店，品牌不符。保留实体，不把另一餐厅坐标给郑有财。'],
  ['郑有财海鲜粥','厦门市郑有财海鲜粥，具体分店门牌待核','美食','1401是八市中山路美食清单，旧点24.479627/118.088910为反复出现的城市中心默认点，不是门店证据。清空待核，保留与砂锅粥名的待审关系。'],
  ['大社沙茶面','厦门市集美区大社沙茶面，具体门牌待核','美食','1402明确集美大社，1453亦在集美美食分区；旧地图湖里荟盈星街店与原始地域相冲突。仅撤销错误分店坐标，不合并大中沙茶面。'],
  ['林氏海蛎煎','厦门市林氏海蛎煎，龙阳品牌及具体分店待核','美食','1506说认准龙阳，1453泛名列于鼓浪屿；旧点是曾厝垵台湾印象美食城的海蛎煎泛店，与明确品牌/区域均缺乏匹配。清空，保留237分店待审。'],
  ['龙阳林氏海蛎煎','厦门市龙阳林氏海蛎煎，具体分店待核','美食','1505明确龙阳品牌；旧点只匹配台湾印象美食城海蛎煎泛店，没有龙阳门店证据。成对清空，不能和泛林氏记录凭同一错点判等。'],
  ['offwork海边营地','厦门市环岛路海边营地，具体范围待核','景点','1260正文是黄厝不在书店旁奶黄色巴士/营地摄影场景，旧点却匹配集美营地。撤销跨区点并将摄影场景从咖啡店类别纠回景点，不合并椰风寨环岛路OFF WORK门店。'],
  ['山海步道林海线','厦门市山海健康步道林海线，路线入口待核','景点','1464明确D18入口，1454为林海线轻徒步；旧点只匹配湖里林海地名，不能当南段路线入口。清空，保持与云海线独立。'],
  ['厦门山海健康步道','厦门市山海健康步道，具体线路与段落待核','景点','1365定位D18至上李水库，1467推荐林海线，1370为海岸观景台；旧地图邮轮码头不是这些源的共同游览点。撤销单一精确定位，不在母步道/线段待审结束前指定入口。'],
  ['山海健康步道','厦门市山海健康步道，具体线路与段落待核','景点','1244东芳山庄、1347林海线7号入口、1288 D18路线并存；邮轮码头旧点无法代表原始提及。清空坐标，保留不同线路粒度待审。'],
  ['山海步道','厦门市山海步道，具体线路与段落待核','景点','1342特指天泉段，1571为D18至天泉广场，旧点为城市中心默认值。撤销虚假精确点，保持ID，不强并母步道与线路。'],
  ['厦门山海步道','厦门市山海步道，具体线路与段落待核','景点','1378仅海边长廊夜景，1505泛旅游清单；旧点为城市中心默认值，没有精确路段证据。清空，待机位和线路范围核实。'],
  ['天泉步道广场','厦门市思明区天泉步道广场，精确广场点位待核','景点','1562、1571和1568将天泉步道广场列为海岸路线终点，1263又混入广场上方步道机位；旧点是城市中心默认值。仅清空无效点，广场/上方步道关系仍待核。'],
  ['天泉步道','厦门市思明区天泉步道，精确路段待核','景点','1271图片路线在盼归塔与音乐广场之间列天泉步道；旧城市中心点不在该沿海段。清空，保留与天泉广场的独立待审身份。'],
  ['厦门地铁1号线','厦门市地铁1号线，线路不能用城市中心单点定位','交通','1467原文地铁1号线是交通线路，旧点24.479627/118.088910为城市中心默认点。保持全线ID与交通类别，清空单点，海上观光段另以组成关系表达。'],
];
const selections=items.map(([primary,address,category,reason])=>{
  const entity=entities.find(e=>e.city==='厦门'&&e.canonical_name===primary);assert.ok(entity,primary);
  const names=new Set(entity.places.map(p=>p.name));const used=new Set();
  return {reviews:[],city:'厦门',entityIds:[entity.entity_id],primary,reason,
    overrides:{lat:null,lng:null,address,category,geoStatus:'unresolvable'},
    contexts:contexts.map(({file,rows})=>({file,mentionIds:rows.filter(r=>names.has(r.name)&&!used.has(r.mention_id))
      .map(r=>{used.add(r.mention_id);return Number(r.mention_id);})})).filter(c=>c.mentionIds.length)};
});
const review=[{review:996,verdict:'part_of',childEntityId:'3344c8d21cebbb866f03ee4b23363386',
  explanation:'5320及1514明确海上体验为高崎至集美学村段；5900主体名为厦门地铁1号线。厦门日报2024-12-17报道正文明确该约2.8公里海上区间位于地铁1号线中，支持跨海段属于全线而非同义。两ID独立，交通全线不能替代观光段排程。',
  sources:['xiamen-metro-scope-fetch.json'],contexts:[{file:'xiamen-batch15-context.json',mentionIds:[5320,6312]},{file:'xiamen-batch16-transit-context.json',mentionIds:[5900]}]}];
const supplements=['xiamen-batch15-supplement.json','xiamen-batch15-transit-supplement.json','xiamen-batch16-review-supplement.json'];
for(const[file,data]of [[files[0],selections],[files[1],review],[files[2],supplements],[files[3],['batch-15']]])
  fs.writeFileSync(new URL(file,base),JSON.stringify(data,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({coordinateCorrections:selections.length,merges:0,partOf:1}));
