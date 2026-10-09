// 将人工原图核实记录连到冻结笔记、刷新响应和图片字节，供现有决策转换器引用。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export function reviewedImageContexts(base, selections) {
  const read=file=>JSON.parse(fs.readFileSync(new URL(file,base),'utf8'));
  const hash=file=>createHash('sha256').update(fs.readFileSync(new URL(file,base))).digest('hex');
  const seen=new Set();
  return selections.map(({contextFile,mentionId,manifestFile,index,observations})=>{
    assert.match(contextFile,/^[a-z0-9-]+\.json$/);
    assert.match(manifestFile,/^[a-z0-9-]+\/manifest\.json$/);
    assert.ok(Number.isInteger(index)&&index>=0&&observations);
    assert.ok(!seen.has(mentionId),'同提及多图应显式合为一次审查');seen.add(mentionId);
    const old=read(contextFile).find(r=>Number(r.mention_id)===mentionId);assert.ok(old);
    const manifest=read(manifestFile);assert.equal(manifest.indexBase,0);
    assert.equal(manifest.upstreamReadOnly,true);
    const source=manifest.sourceSnapshot;assert.ok(source,'原图须来自已冻结刷新证据');
    assert.match(source.file,/^[a-z0-9-]+\.json$/);assert.equal(hash(source.file),source.sha256);
    const note=read(source.file).notes.find(n=>String(n.id)===String(old.note_id));
    assert.ok(note.ok&&note.textUnchanged,'正文变化须另行核查，不能沿用旧页码');
    assert.equal(note.title,old.title);assert.equal(note.desc,old.desc);
    const img=manifest.images.find(i=>String(i.noteId)===String(old.note_id)&&i.index===index);assert.ok(img?.ok);
    assert.match(img.file,/^note-\d+-p\d+\.(webp|jpg|png)$/);
    const file=manifestFile.replace('manifest.json',img.file);assert.equal(hash(file),img.sha256);
    return {...old,identity_image_review:{method:'assistant_visual_review',observations,
      sourceContext:contextFile,sourceContextSha256:hash(contextFile),
      manifest:manifestFile,manifestSha256:hash(manifestFile),
      imageFile:file,imageSha256:img.sha256,indexBase:0,index,page:index+1,
      sourceUrl:img.sourceUrl,refreshedTextUnchanged:true}};
  });
}
