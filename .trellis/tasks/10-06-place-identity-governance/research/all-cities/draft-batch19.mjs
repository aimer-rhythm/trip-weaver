// 西安餐馆原图互证；杭州多分店品牌只撤销不成立的单点，不按错字强并。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {reviewedImageContexts} from './image-review-context.mjs';
const base=new URL('./',import.meta.url);
const files=['batch-19-image-context.json','batch-19-selections.json','batch-19-review-selections.json','batch-19-prerequisites.json','batch-19-supplements.json'];
for(const file of [...files,'batch-19-applied.json']) assert.ok(!fs.existsSync(new URL(file,base)),`不可覆盖${file}`);
const observations=[
  {contextFile:'xian-batch13-context.json',mentionId:12279,manifestFile:'xian-food-images-01/manifest.json',index:3,
    observations:'图片P4直接写“老金家蛋菜夹馍，位置在洒金桥5号，回坊第一家就是这家”，拍到“洒金桥老金家”“特色蛋菜夹馍”实体招牌。纠正正文省掉“家”字后的歧义；地址与主源5915的洒金桥5号一致，旧源5869南郊点无效。'},
  {contextFile:'xian-batch13-context.json',mentionId:12398,manifestFile:'xian-food-images-02/manifest.json',index:2,
    observations:'P3表格在洒金桥分组中列“老金家蛋菜夹馍”，配图蛋菜夹馍，说明咸鸭蛋、玫瑰咸菜、煎蛋，与2744 P4文字和招牌所指同品牌同洒金桥门店相合；主源已有洒金桥5号地址。'},
  {contextFile:'hangzhou-batch10-context.json',mentionId:8413,manifestFile:'hangzhou-food-images-01/manifest.json',index:1,
    observations:'P2图片写“泮芳春煎饺”，正文“泮春芳”是字序错误；只有菜品和“杭州米其林煎饺”称呼，没有分店地址。不能因此把其归到另一条含多分店提及的记录。'},
  {contextFile:'hangzhou-batch10-context.json',mentionId:8786,manifestFile:'hangzhou-food-images-01/manifest.json',index:0,
    observations:'P1表格中泮芳春煎饺的地址栏明写“西湖区多家门店”，并未指定某店；同实体9356又是河坊街游览背景。此记录混合多分店，不能用一个旧经纬度代表全部提及。'},
];
const context=reviewedImageContexts(base,observations);
const selections=[
  {reviews:[429],primary:'老金家蛋菜夹馍',canonicalName:'老金家蛋菜夹馍（洒金桥店）',
    reason:'2744 P4原图明确写老金家、洒金桥5号，且拍到实体招牌，补足原来缺的门牌证据。2748正文和P3表格均指洒金桥老金家蛋菜夹馍，主源5915地址亦为洒金桥5号。确认这两条是同店，归一到稳定主ID，保留原名与旧ID。',
    geometryReason:'保留洒金桥5号主源GCJ-02坐标；原图与该地址互证，旧省略名南郊点不参与平均。',
    overrides:{category:'美食',address:'西安市莲湖区洒金桥5号'},contexts:[{file:files[0],mentionIds:[12279,12398]}]},
  {reviews:[],city:'杭州',entityIds:['691f80ff32adeb2f607382ddcfc8fe04'],primary:'泮春芳煎饺',
    reason:'2029 P2证实正文泮春芳是泮芳春的字序错误，但未指具体分店；旧点经度120.607028远离原文杭州主城美食路线，且无地址或POI互证。撤销错误精确点，保持稳定ID及待审边界，不擅给另一分店坐标或永久冲突别名。',
    geometryReason:'无地址错字记录的远端点未获原图支持，成对清空。',
    overrides:{lat:null,lng:null,address:'杭州市泮芳春煎饺，原抽取名有字序错误，具体分店待核',category:'美食',geoStatus:'unresolvable'},
    contexts:[{file:files[0],mentionIds:[8413]}]},
  {reviews:[],city:'杭州',entityIds:['8c3420c51d088f391802af3b7bef3357'],primary:'泮芳春煎饺',
    reason:'2074 P1明确地址为西湖区多家门店，而2036源位于河坊街背景，原记录混入不同分店范围。现有无地址单点30.209668/120.164615不能代表多门店源；撤销固定坐标，保留品牌泛指与具体分店待拆清的事实。',
    geometryReason:'多门店源不绑定单一未经核实门店点。',
    overrides:{lat:null,lng:null,address:'杭州市泮芳春煎饺，原来源涉及多家门店，具体分店待核',category:'美食',geoStatus:'unresolvable'},
    contexts:[{file:files[0],mentionIds:[8786]},{file:'hangzhou-batch10-context.json',mentionIds:[9356]}]},
];
const review=[{review:331,verdict:'uncertain',explanation:'新原图2029 P2已确认泮春芳是泮芳春的字序误写；2074 P1同时明写“西湖区多家门店”，9356又有河坊街语境。错字已核实，物理门店身份仍混合，不把品牌相同当同一分店。两记录本批撤销不能代表源范围的旧单点，保持独立ID待拆清提及归属。',
  contexts:[{file:files[0],mentionIds:[8413,8786]},{file:'hangzhou-batch10-context.json',mentionIds:[9356]}]}];
for(const[file,data]of [[files[0],context],[files[1],selections],[files[2],review],[files[3],['batch-01-v2','batch-10','batch-13']],[files[4],['xian-batch13-supplement.json']]])
  fs.writeFileSync(new URL(file,base),JSON.stringify(data,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({merges:1,coordinateCorrections:2,reassessments:1,images:context.length}));
