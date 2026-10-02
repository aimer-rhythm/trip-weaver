import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'live/comparison');
http.createServer(async(req,res)=>{
  if(req.method!=='GET'){res.writeHead(405);res.end();return;}
  try{
    const p=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const file=path.resolve(root,p==='/'?'index.html':'.'+p);
    if(!file.startsWith(root+path.sep))throw Error('path');
    const data=await fs.readFile(file);
    res.writeHead(200,{'Content-Type':({'.html':'text/html; charset=utf-8','.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp','.json':'application/json'})[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store'});
    res.end(data);
  }catch{res.writeHead(404);res.end();}
}).listen(18843,'127.0.0.1',()=>console.log('图源对比：http://127.0.0.1:18843/'));
