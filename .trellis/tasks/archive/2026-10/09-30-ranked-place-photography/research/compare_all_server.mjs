import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSelectionStore} from './compare_selection.mjs';
const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'live/all-pools');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp'};
export async function createComparisonServer({webRoot=root,feedbackDirectory=path.join(root,'../all-pools-feedback')}={}){
 const data=JSON.parse(await fs.readFile(path.join(webRoot,'comparison.json'),'utf8'));
 const store=createSelectionStore(data,feedbackDirectory);
 const json=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));};
 return http.createServer({requestTimeout:10000},async(req,res)=>{
 const host=req.headers.host??'',port=req.socket.localPort;
 if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(host)){json(res,403,{error:'只允许本机访问。'});return;}
 try{
  const p=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(p==='/api/selections'){
   if(req.method==='GET'){json(res,200,await store.read());return;}
   if(req.method!=='POST'){json(res,405,{error:'方法不支持。'});return;}
   if(req.headers.origin!==`http://${host}`||req.headers['x-photo-review']!=='1'){json(res,403,{error:'仅接受对比页面发起的选择。'});return;}
   if(req.headers['content-type']?.split(';')[0]!=='application/json'){json(res,415,{error:'需要JSON请求。'});return;}
   let size=0;const chunks=[];
   for await(const chunk of req){size+=chunk.length;if(size<=16384)chunks.push(chunk);}
   if(size>16384){json(res,413,{error:'请求过大。'});return;}
   let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{json(res,400,{error:'JSON格式无效。'});return;}
   json(res,200,await store.mutate(input));return;
  }
  if(req.method!=='GET'){json(res,405,{error:'方法不支持。'});return;}
  const file=path.resolve(webRoot,p==='/'?'index.html':'.'+p);
  if(!file.startsWith(webRoot+path.sep)||!mime[path.extname(file)]){res.writeHead(404);res.end();return;}
  const data=await fs.readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(data);
 }catch(error){json(res,error.status??(error.code==='ENOENT'?404:500),{error:error.status?error.message:'保存或读取失败，请重试；已有选择文件保留。'});}
 });
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
 const server=await createComparisonServer();server.listen(18845,'127.0.0.1',()=>console.log('全部候选池对比（可保存选择）：http://127.0.0.1:18845/'));
}
