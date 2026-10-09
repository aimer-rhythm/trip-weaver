from pathlib import Path
import json,hashlib,math
root=Path(__file__).resolve().parent
def read(p):return json.loads((root/p).read_text(encoding='utf-8'))
def sha(p):return hashlib.sha256((root/p).read_bytes()).hexdigest()
prefix='priority-cities/济南/last-restaurants-'
references=[]
for number,quotes in [(4,['泉城路店','龙泉商城西南角']),(5,['华祥','经五路东首']),(6,['山大南路店','山大南路蜀易火锅隔壁']),(7,['经五路店','24']),(8,['许记排骨','县东巷71号'])]:
    file=prefix+f'reference-{number:02}.json';v=read(file)
    assert v['ok'] and all(q in v['content'] for q in quotes),(number,quotes)
    references.append({'file':file,'sha256':sha(file),'url':v['url'],'checkedText':quotes})
packet=read(prefix+'source-packet-01.json')
xu=next(g for g in packet['groups'] if g['entity']['primary_place_id']==5331)['sources'][0]['source']
def km(a,b):
    lat1,lat2=map(math.radians,[a[0],b[0]]);dlat=lat2-lat1;dlng=math.radians(b[1]-a[1])
    return round(6371*2*math.asin(math.sqrt(math.sin(dlat/2)**2+math.cos(lat1)*math.cos(lat2)*math.sin(dlng/2)**2)),3)
before='all-cities/batch-63/sync-01/xhs-places-济南.json';places=read(before)['places']
anchors=[]
for name in ['大明湖','泉城路','芙蓉街']:
    p=next(p for p in places if p['name']==name)
    anchors.append({'name':name,'id':p['id'],'lat':p['lat'],'lng':p['lng'],'distanceKm':km((xu['latitude'],xu['longitude']),(p['lat'],p['lng']))})
report={'batch':64,'fetchedEvidenceChecked':True,'references':references,
    'adopted':{'许记排骨':'原文和Trip正文均县东巷71号；只用地址限定展示名，不宣称官方县东巷店或已证实多分店。',
        '桥下把子肉':'2026-04-15济南文旅正文明确山大南路店/山大南路蜀易火锅隔壁，与两篇原文一致；不继承其他店地址营业信息。',
        '蜗牛叔叔的食堂':'Trip泉城路店/狮子口街参照支持门店限定；原源地址保持，旧评论不证明2026营业。'},
    'huaXiang':{'action':'no_mutation','original':'大观园南门西行100米路北','oldSourceAddress':'永长街23号正东方向200米',
        'publicCandidates':['华祥清真糕点/经五路东首（历史文章）','清真华祥糕点(经五路店)/饮虎池街回民小区24号楼'],
        'conclusion':'缺同店连续性或明确分店对应，不能把它们合并或认定迁址；搜狐永长街25是另一个穆香斋商号。'},
    'xuWrongPointEvidence':{'basis':'原文明确县东巷71号（近大明湖/泉城路），抓取商户正文同门牌；旧点在所述老城参照西侧约4–5公里且源地址为空，缺同门牌位置证据。清除不适用于已限定门店的旧点，精确点仍待核。',
        'beforeExportFile':before,'beforeExportSha256':sha(before),'oldPoint':{'lat':xu['latitude'],'lng':xu['longitude']},'referenceDistances':anchors,
        'distanceLimitation':'参照点距离仅说明与原文近邻范围明显偏离，不证明县东巷精确边界；未据此生成或采用新点。',
        'newPreciseLocationResolved':False},
    'rejected':['搜索主回答中的虚构分店/电话/门牌/坐标全部弃用','高德和知乎空正文抓取的摘要不作定位证据','历史评论日期不当作当前营业确认','近邻与同路线不认领裸名分店'],
    'retrievalLimits':{'searchTimeouts':[4,5,10,11],'exaSearch12':'未配置，未获取证据','emptyFetches':[1,2,3,9]},
    'mapCredentialStatus':'rotation_required','mapRequests':0,'newCoordinates':0,'imageComparison':'deferred_by_user','userAcceptance':False}
assert all(a['distanceKm']>3 for a in anchors)
with (root/(prefix+'web-review-01.json')).open('x',encoding='utf-8') as f:json.dump(report,f,ensure_ascii=False,indent=2)
print(json.dumps({'references':len(references),'referenceDistances':anchors,'businessMutations':False},ensure_ascii=True))
