// 只读小样本检索，不替换行程图片；用于比较中英文地点查询，候选数不是准确命中数。
import fs from 'node:fs';
import '../../../../apps/server/src/lib/proxy.ts';
const queries = ['杭州西湖','West Lake Hangzhou','灵隐寺','Lingyin Temple Hangzhou','西溪湿地','Xixi Wetland Hangzhou','飞来峰','Feilai Feng Hangzhou'];
if (!process.env.PEXELS_API_KEY) throw new Error('PEXELS_API_KEY missing');
const report=[];
for(const query of queries) {
  const params=new URLSearchParams({query,locale:'zh-CN',orientation:'landscape',size:'large',per_page:'8'});
  const response=await fetch('https://api.pexels.com/v1/search?'+params,{headers:{Authorization:process.env.PEXELS_API_KEY},signal:AbortSignal.timeout(10000)});
  if(!response.ok) throw new Error('Pexels HTTP '+response.status);
  const body=await response.json();
  const row={query,total:body.total_results,photos:(body.photos||[]).map(p=>({id:p.id,alt:p.alt,url:p.url,photographer:p.photographer,width:p.width,height:p.height,preview:p.src?.medium,large:p.src?.large}))};
  report.push(row);
  console.log(JSON.stringify({query,total:row.total,top:row.photos.slice(0,3).map(p=>({id:p.id,alt:p.alt}))}));
  await new Promise(resolve=>setTimeout(resolve,1000));
}
fs.writeFileSync('.trellis/tasks/09-29-hangzhou-image-diagnosis/research/pexels-query-comparison.json',JSON.stringify(report,null,2));
