// 济南重点清单：依据冻结原文及地图纠正位置，不合并身份或改写原始来源。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const root = new URL('./', import.meta.url);
const read = file => JSON.parse(fs.readFileSync(new URL(file, root), 'utf8'));
const hash = file => createHash('sha256').update(fs.readFileSync(new URL(file, root))).digest('hex');
const sourceFile = 'priority-cities/济南/run-1791385235272324900/sources.json';
assert.equal(hash(sourceFile), '9aa559e894e1cfbcdf74db2214c8eeb6614739064a96967780c6b32af59a889b');
const source = read(sourceFile);
const baseline = read('all-cities/batch-30-baseline.json');
const geoFile = 'priority-cities/济南/geo-02.json';
const geo = read(geoFile);
const plans = [
  {name:'芙蓉街', note:2782, quote:'从芙蓉街32号拐进去就是起凤桥街',
    address:'山东省济南市历下区泉城路街道芙蓉街',
    conclusion:'30条提及/23篇原文所述为大明湖、曲水亭街与泉城路附近小吃街。地图同时返回章丘枣园和历下泉城路同名道路；原坐标精确等于章丘条目，应改为历下道路条目。只修正位置，街区与沿街商户不合并。'},
  {name:'经三路', note:2573, quote:'老商埠→经三路→中山公园→纬四路→万紫巷→淘子外单',
    address:'山东省济南市槐荫区五里沟街道经三路',
    conclusion:'两篇原文将经三路与老商埠、纬三路、中山公园相连。旧点精确等于济阳同名道路，改为市区经三路道路条目；不是具体红绿灯、商户或融汇老商埠实体。'},
  {name:'关帝庙', note:2841, quote:'五龙潭南门西侧的关帝庙可以顺便看看（免费，院内有西蜜脂泉）',
    address:'筐市街18-3',
    conclusion:'唯一原文明确五龙潭南门西侧、西蜜脂泉所在关帝庙。地图筐市街18-3号与蜜脂园条目互证，旧点是仲宫同名庙；芙蓉街38号的另一关帝庙也不能采用。'},
  {name:'趵突泉', note:2808, quote:'趵突泉景区比较大，里面除了趵突泉外有很多泉、纪念馆、故居等',
    conclusion:'geo-01的普利街29号趵突泉和颐酒店与旧坐标逐数相等，原文描述公园和泉池而非酒店，清空该酒店位置。源混有园区及主泉池，暂不把主泉池或公园坐标强赋给混合旧ID；审核364继续。'},
  {name:'经三路爱心红绿灯', note:2797, quote:'爱心红绿灯：经三路，爱心红绿灯和夹心胡同都在这里',
    conclusion:'唯一原文指市区经三路机位；旧点为济阳区同名道路，与同篇及2793/2566街区位置不符。无精确红绿灯地图条目，清空而不借整条道路坐标。'},
  {name:'济南文字墙', note:2817, quote:'1小时打卡济南曲水亭街！附详细路线攻略', title:true,
    conclusion:'唯一原文为大明湖南门、月下观棠、后宰门街到珍珠泉的一小时紧凑步行路线。旧点在老城数十公里外，与原路线冲突；具体墙面仍需图像或定位证据，不与其他济南墙合并。'},
  {name:'济南墙', note:2797, quote:'在百花洲西的月下观棠旁的街巷内',
    conclusion:'唯一原文明示百花洲西月下观棠旁街巷，旧点在章丘方向约48公里外，不属于该机位。清空旧点，尚未确认具体墙面位置。'},
  {name:'夹心胡同', note:2566, quote:'夹心胡同(融汇济南老商埠店)【打卡爱心天桥】',
    conclusion:'唯一原文为融汇老商埠内机位，并沿经三/经四路步行一小时。旧点在市区西南约23公里外，清空错误坐标；胡同、商户与爱心天桥边界另行核实。'},
  {name:'尚泉尚水茶馆', note:2795, quote:'第二个机位搜索“尚泉尚水茶馆”（图5位置），其前面平台即可拍摄湖面与楼阁全景',
    conclusion:'唯一原文介绍大明湖超然楼拍摄机位，实际对象为茶馆前平台，旧点落济阳约39公里外。先清空错误位置，随后逐提及纠正茶馆与平台身份；本批不把茶馆认定为已核实餐饮主体。'},
  {name:'泉源之眼', note:2839, quote:'到泉源之眼路程十多分钟',
    conclusion:'唯一原文从五龙潭旁沃德酒店骑行十多分钟，之后顺路吃烧饼再步行回酒店。旧点距该区域约23公里，与原路线冲突。清空旧点，原名与泉城之眼是否同体仍需补证，不直接更名。'},
];
const decisions = plans.map((p, i) => {
  const group = source.groups.find(g => g.entity.canonical_name === p.name);
  assert.ok(group);
  const entity = baseline.entities.find(e => e.entity_id === group.entity.entity_id);
  assert.deepEqual(Object.fromEntries(Object.keys(group.entity).map(k => [k, entity[k]])), group.entity);
  const note = source.notes.find(n => n.id === p.note);
  assert.ok((p.title ? note.note_title : note.note_desc).includes(p.quote), p.name);
  const originals = source.sources.filter(s => group.sourceIds.includes(s.id));
  for (const s of originals) {
    const old = entity.places.find(v => Number(v.id) === s.id);
    assert.ok(old);
    for (const key of ['name','normalized_name','address','latitude','longitude','geo_status','is_active']) assert.deepEqual(old[key],s[key]);
  }
  const evidence = [{kind:'reviewed_priority_original',file:sourceFile,sha256:hash(sourceFile),
    sourcePlaceIds:group.sourceIds,mentionIds:group.mentionIds,noteId:p.note,quote:p.quote,
    conclusion:p.conclusion,original:originals.map(s=>({id:s.id,lat:s.latitude,lng:s.longitude,address:s.address,sourceHash:s.sourceHash}))}];
  let overrides = {lat:null,lng:null,address:'',geoStatus:'unresolvable'};
  if (p.address) {
    const matches=geo.filter(g=>g.query===p.name&&g.name===p.name&&g.address===p.address);
    assert.equal(matches.length,1);
    const match=matches[0]; assert.ok(match.gcj02);
    overrides={lat:match.gcj02.latitude,lng:match.gcj02.longitude,address:p.address,geoStatus:'resolved'};
    evidence.push({kind:'reviewed_exact_poi',file:geoFile,sha256:hash(geoFile),query:match.keyword,
      poiName:match.name,address:match.address,rawLonLat:match.lonlat,sourceCoordinateSystem:match.coordinateSystem,
      storedCoordinateSystem:'GCJ-02',conclusion:'按原文具体街区/位置筛选同名候选，不采用第一条结果或地理编码猜测。'});
  }
  if(p.name==='趵突泉') {
    const file='priority-cities/济南/geo-01.json';
    const hotel=read(file).find(g=>g.name==='济南趵突泉和颐酒店');
    assert.equal(hotel.gcj02.latitude,originals[0].latitude);
    assert.equal(hotel.gcj02.longitude,originals[0].longitude);
    evidence.push({kind:'rejected_wrong_poi',file,sha256:hash(file),poiName:hotel.name,address:hotel.address});
  }
  return {key:`all-cities-20261007-batch-30-${String(i+1).padStart(3,'0')}`,city:'济南',
    entityId:entity.entity_id,mergeEntityIds:[],canonicalName:entity.canonical_name,aliases:[],
    expectedRevisions:{[entity.entity_id]:entity.revision},overrides,evidence};
});
fs.writeFileSync(new URL('all-cities/batch-30-decisions.json',root),JSON.stringify(decisions,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({batch:'batch-30',corrections:decisions.length,located:plans.filter(p=>p.address).length,
  cleared:plans.filter(p=>!p.address).length,merges:0,names:plans.map(p=>p.name)}));
