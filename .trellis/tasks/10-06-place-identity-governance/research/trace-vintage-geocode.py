"""只读复现旧地理编码猜测值，不将结果当作命名POI或写入数据库。"""
import asyncio,json,logging,sys
from pathlib import Path
sys.dont_write_bytecode=True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0,'D:/Project/xhs-travel-pipeline')
logging.getLogger('httpx').setLevel(logging.WARNING)
from app.resolve.amap import _geocode_wgs,_to_result
root=Path(__file__).resolve().parent
async def main():
    target=root/'priority-cities/济南/vintage-geocode-provenance-01.json';assert not target.exists()
    packet=json.loads((root/'priority-cities/济南/vintage-source-packet-01.json').read_text(encoding='utf-8'))
    rows=[]
    for name in ['济南','济南VILLASHAKA','济南BLUEDUCK骨董屋']:
        point=await _geocode_wgs(name)
        result=_to_result(*point,'') if point else None
        matched=[]
        if result:
            matched=[g['entity']['canonical_name'] for g in packet['groups'] if
                (g['sources'][0]['source']['longitude'],g['sources'][0]['source']['latitude'])==(result['longitude'],result['latitude'])]
        rows.append({'query':name,'rawPoint':point,'converted':result,'equalsFrozenSources':matched})
    report={'readOnly':True,'kind':'current_geocoder_reproduction_not_historical_write_log','rows':rows,
        'namedPoiEvidence':False,'businessMutations':False,'imageComparison':'deferred_by_user'}
    with target.open('x',encoding='utf-8') as f:json.dump(report,f,ensure_ascii=False,indent=2)
    print(json.dumps(report,ensure_ascii=False))
asyncio.run(main())
