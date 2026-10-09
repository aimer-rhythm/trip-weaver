import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {buildCleaningScope,type ScopeInput,type BucketCorrection} from './cleaning-scope.mjs';
const directory=process.argv[2],label=process.argv[3];
assert.ok(directory&&/^scope-\d{2}$/.test(label??''),'提供冻结目录和不覆盖的scope-NN标签');
const folder=pathToFileURL(directory!.replace(/[\\/]?$/,'/'));
const bytes=await readFile(new URL('input.json',folder));
const hash=JSON.parse(await readFile(new URL('input-hash.json',folder),'utf8')) as {sha256:string};
assert.equal(createHash('sha256').update(bytes).digest('hex'),hash.sha256,'冻结输入被修改');
let corrections:BucketCorrection[]=[];
if(process.argv[4])corrections=JSON.parse(await readFile(process.argv[4],'utf8')) as BucketCorrection[];
const extra=process.argv.slice(5);
assert.ok(extra.length===0||(extra.length===2&&extra[0]==='--exclude-cities'),'未知参数');
const options={excludedCities:extra.length?extra[1]!.split(','):[]};
const result=buildCleaningScope(JSON.parse(bytes.toString('utf8')) as ScopeInput,corrections,options);
const output={...result,inputSha256:hash.sha256,corrections,generatedAt:new Date().toISOString()};
await writeFile(new URL(`${label}.json`,folder),JSON.stringify(output,null,2)+'\n',{flag:'wx'});
const cities=[...new Set(result.selected.map(s=>s.place.city))].sort().map(city=>({city,
  primary:result.selected.filter(s=>s.place.city===city).length,
  dependencies:result.dependencies.filter(s=>s.city===city).length,pending:result.scopedReviews.filter(s=>s.city===city).length}));
console.log(JSON.stringify({label,...result.summary,cities},null,2));
