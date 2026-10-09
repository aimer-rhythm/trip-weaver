// 两篇原笔记的指定门店原图互证后，归一HANDBELL大小写变体。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const base=new URL('./',import.meta.url);
const read=file=>JSON.parse(fs.readFileSync(new URL(file,base),'utf8'));
const hash=file=>createHash('sha256').update(fs.readFileSync(new URL(file,base))).digest('hex');
const files=['chengdu-handbell-image-context.json','batch-18-selections.json','batch-18-review-selections.json','batch-18-prerequisites.json'];
for(const file of [...files,'batch-18-applied.json']) assert.ok(!fs.existsSync(new URL(file,base)),`不可覆盖${file}`);
const folder='chengdu-case-images-02';
const manifest=read(`${folder}/manifest.json`);
const fresh=read(manifest.sourceSnapshot.file);
assert.equal(hash(manifest.sourceSnapshot.file),manifest.sourceSnapshot.sha256);
const previous=read('case-collision-context.json');
const reviews=[
  [3532,'1001',8,'原文P9对应handbell。图中HANDBELL黑字招牌、左侧半圆拱窗和开放咖啡吧台、右侧拱形双木门、剥落浅黄色外墙、横向线脚及两盏黑色灯具清晰。楼上小方砖墙、防盗窗的分格、空调和植物位置与note1005 P14一致。'],
  [3722,'1005',13,'原文P14对应HANDBELL。较宽视角完整显示同一左拱窗吧台与右拱形木门，招牌两侧立柱线脚、墙面缺损纹理、灯具以及楼上防盗窗结构与note1001 P9一一相符。两图为不同拍摄时刻的同一门面，不是凭品牌装修风格或同一地图落点推断。'],
];
const context=reviews.map(([mentionId,noteId,index,observations])=>{
  const old=previous.find(r=>Number(r.mention_id)===mentionId);assert.equal(String(old.note_id),noteId);
  const note=fresh.notes.find(n=>n.id===noteId);assert.ok(note.ok&&note.textUnchanged);
  assert.equal(note.title,old.title);assert.equal(note.desc,old.desc);
  const img=manifest.images.find(i=>i.noteId===noteId&&i.index===index);assert.ok(img.ok);
  const file=`${folder}/${img.file}`;assert.equal(hash(file),img.sha256);
  return {...old,identity_image_review:{method:'assistant_visual_review',observations,
    manifest:`${folder}/manifest.json`,manifestSha256:hash(`${folder}/manifest.json`),
    imageFile:file,imageSha256:img.sha256,indexBase:0,index,page:index+1,
    sourceUrl:img.sourceUrl,refreshedTextUnchanged:true}};
});
const selections=[{reviews:[304],primary:'HANDBELL',canonicalName:'HANDBELL（玉林店）',
  reason:'两篇原文分别明确handbell P9和HANDBELL P14；刷新后标题正文未变，已逐图核实是同一栋楼同一门面：品牌招牌、左拱窗吧台、右拱门、外墙损纹/线脚/灯具、楼上防盗窗均对应。现有地图同落芳华街，主体1824保存明确POI B0KGOCIJZD及芳华街9号/附1号地址。以独立原图互证归一两条大小写变体，保留玉林分店边界和稳定主ID。',
  geometryReason:'原图证明两源为同一实体，保留已有明确POI主源的GCJ-02坐标；不平均坐标，也不从照片自行推算经纬度。',
  overrides:{category:'咖啡'},contexts:[{file:files[0],mentionIds:[3532,3722]}]}];
for(const[file,data]of [[files[0],context],[files[1],selections],[files[2],[]],[files[3],['batch-03']]])
  fs.writeFileSync(new URL(file,base),JSON.stringify(data,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({groups:1,entities:2,review:304,originalImagesReviewed:context.length}));
