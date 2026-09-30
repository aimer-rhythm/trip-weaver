"""独立本地选片页：不暴露数据库、原始笔记正文或带凭据的接口响应。"""
import html
import json
import shutil
from pathlib import Path
from urllib.parse import unquote
from PIL import Image

ROOT = Path(__file__).resolve().parents[4]
BASE = ROOT / 'data/photo-pilot'
OUT = BASE / 'review'
(OUT / 'assets').mkdir(exist_ok=True, parents=True)
library = json.loads((ROOT / 'apps/server/src/data/photography/hangzhou-curated.json').read_text('utf-8'))
decisions = json.loads(Path(__file__).with_name('curated-decisions.json').read_text('utf-8'))
feedback = json.loads(Path(__file__).with_name('photo-style-feedback.json').read_text('utf-8'))
current = json.loads((BASE / 'current-covers.json').read_text('utf-8'))
samples = json.loads((BASE / 'xhs/sample.json').read_text('utf-8'))
provenance = json.loads((BASE / 'provenance.json').read_text('utf-8'))
e = html.escape

def asset(source, name):
    target = OUT / 'assets' / name
    shutil.copyfile(source, target)
    return 'assets/' + name

def picture(source, name, alt):
    src = asset(source, name)
    with Image.open(source) as img:
        width, height = img.size
    orientation = '竖版' if height > width else '横版' if width > height else '方形'
    return f'<a class="display-frame" href="{src}" target="_blank" rel="noopener noreferrer" aria-label="查看{e(alt)}完整图片"><img src="{src}" alt="{e(alt)}" width="{width}" height="{height}"></a><p class="dimensions">{orientation} · 本地副本 {width} × {height}</p>'

def approved(place):
    return [p for p in place['photos'] if p['review']['status'] == 'approved']

sections = []
for i, place in enumerate(library['places']):
    name = place['name']
    old = next(row for row in current if row['name'] == name)['current']
    if old and old.startswith('/media/'):
        file = (ROOT / 'data' / unquote(old).lstrip('/')).resolve()
        assert file.is_relative_to((ROOT / 'data/media').resolve())
        before = picture(file, f'before-{i}.webp', name + '现有本地封面') + '<p>现有小红书本地封面，首轮图库快照。</p>'
    else:
        before = '<div class="empty">暂无已确认本地封面</div><p>生成时仍可走其他图源兜底</p>'
    selected, withdrawn, references = [], [], []
    for photo in place['photos']:
        usable = photo['review']['status'] == 'approved'
        label = ('首选封面' if not selected else '备选封面') if usable else '已撤回精选'
        visual = picture(ROOT / 'data/media' / photo['key'], photo['id'] + '.webp', f'{name} · {label}')
        credit = photo['attribution']
        original = next(p for p in provenance if p['id'] == photo['id'])
        (selected if usable else withdrawn).append(f'''<article class="photo {'withdrawn' if not usable else ''}" data-photo-id="{photo['id']}"><div class="photo-heading"><b>{label}</b><span class="tag">{e(credit['source'])}</span></div>{visual}
        <div class="photo-text">
        <p>{e(photo['review']['quality'])}</p><p class="credit"><a href="{e(credit['sourceUrl'], quote=True)}" target="_blank" rel="noopener noreferrer" title="{e(original['title'], quote=True)}">{e(credit['photographer'])} · 原作品</a> / <a href="{e(credit['licenseUrl'], quote=True)}" target="_blank" rel="noopener noreferrer">{e(credit['license'])}</a> · {e(credit['changes'])}</p>
        <details><summary>地点证据与作品信息</summary><p>{e(photo['review']['evidence'])}</p><p>{e(original['title'])}</p><p>原图 {original['width']} × {original['height']} · 本地 {original['outputSize'][0]} × {original['outputSize'][1]}</p><code>{e(photo['id'])}</code></details></div></article>''')
    sample = next(row for row in samples if row['place'] == name)
    for photo in sample['photos']:
        review = feedback['references'].get(photo['id'])
        if not review:
            continue
        visual = picture(BASE / 'xhs/previews' / (photo['id'] + '.webp'), photo['id'] + '.webp', name + ' · ' + review['label'])
        references.append(f'''<article class="photo reference" data-photo-id="{photo['id']}"><div class="photo-heading"><b>{e(review['label'])}</b><span class="tag">小红书</span></div>{visual}
        <div class="photo-text"><p>{e(review['quality'])}</p><p class="crop-note">{e(review['crop'])}</p>
        <p class="credit"><a href="{e(photo['sourceUrl'], quote=True)}" target="_blank" rel="noopener noreferrer">{e(photo['author'])} · 原笔记 P{photo['index'] + 1}</a></p><p class="status">风格参考 · 展示授权待核实 · 尚未接入行程</p>
        <details><summary>地点与逐图依据</summary><p>{e(review['identity'])}</p><code>{e(photo['id'])}</code></details></div></article>''')
    groups = []
    if references:
        groups.append('<h3>保留的竖版氛围参考</h3><div class="gallery">' + ''.join(references) + '</div>')
    if selected:
        groups.append('<h3>当前精选</h3><div class="gallery">' + ''.join(selected) + '</div>')
    elif not references:
        groups.append('<div class="empty">本轮尚无入选图，保留原有封面获取路径。</div>')
    if withdrawn:
        groups.append('<h3>撤回的记录照 · 保留对照</h3><p>地点准确，但未达到这轮氛围摄影要求；不会再由精选图库返回。</p><div class="gallery">' + ''.join(withdrawn) + '</div>')
    deficit = ('按反馈重选：断桥3张记录照已撤回，下面两张竖版照片作为氛围方向参考。' if withdrawn else decisions['deficits'].get(name, '按画面表现排序，首张作为当前封面，其余保留备选。'))
    sheet = asset(BASE / 'xhs' / f'{i:02}-sheet.jpg', f'xhs-{i}.jpg')
    notes = next(row for row in samples if row['place'] == name)['notes']
    note_links = ' '.join(f'<a href="https://www.xiaohongshu.com/explore/{e(n["id"], quote=True)}" target="_blank" rel="noopener noreferrer">{e(n["author"] if isinstance(n["author"], str) else str(n["author"]))} · {e(n["title"])}</a>' for n in notes)
    sections.append(f'''<section id="place-{i}" data-place="{e(name)}"><header><h2>{i+1:02} / {e(name)}</h2><span class="tag">可用精选 {len(approved(place))} 张</span></header><p class="note">{e(deficit)}</p>
    <div class="compare"><aside><h3>现用本地图</h3>{before}<h3>摄影专项参考</h3><a href="{sheet}" target="_blank" rel="noopener noreferrer"><img src="{sheet}" alt="{e(name)}小红书摄影样本联系表" class="sheet"></a><p>样本用于比较风格，按单张核对地点与来源，不把整篇笔记视为同一景点。</p><details><summary>查看来源笔记</summary><div class="note-links">{note_links}</div></details></aside><div class="candidates">{''.join(groups)}</div></div></section>''')

page = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>杭州风景摄影 · 选片对照</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f6f5f0;color:#25332e;font:15px/1.6 system-ui,'Microsoft YaHei',sans-serif}main{max-width:1360px;margin:auto;padding:48px 32px}h1{font-family:Georgia,'SimSun',serif;font-size:42px;margin:10px 0}h2{font-family:Georgia,'SimSun',serif;font-size:27px;margin:0}h3{font-size:15px;margin:0 0 12px}p{margin:9px 0}a{color:#356953;text-underline-offset:3px}button,select{font:inherit}label{font-weight:600}select{padding:10px 14px;border:1px solid #c9d4cb;border-radius:8px;background:white;max-width:100%}.eyebrow{font-size:12px;letter-spacing:3px;color:#617666}.intro{max-width:880px;color:#59665f}.stats{display:flex;gap:28px;margin:24px 0;flex-wrap:wrap}.stats strong{display:block;font-size:27px;color:#284f3e}.stats span{font-size:13px;color:#647268}.toolbar{position:sticky;top:0;z-index:2;background:#f6f5f0ee;padding:15px 0;border-block:1px solid #dce1d8;backdrop-filter:blur(12px);display:flex;gap:15px;align-items:center}section{padding:34px 0;border-bottom:1px solid #dce1d8;scroll-margin-top:80px}section>header{display:flex;align-items:center;gap:14px}.tag{font-size:11px;padding:3px 9px;border-radius:20px;background:#e1e9dd;display:inline-block;margin-left:10px}.note{color:#647268;margin-bottom:24px}.compare{display:grid;grid-template-columns:260px 1fr;gap:28px;align-items:start}aside{font-size:13px;color:#647268}aside>img{width:100%;aspect-ratio:4/3;object-fit:contain;background:#e9eae2;border-radius:8px}aside h3:not(:first-child){margin-top:26px}.sheet{width:100%;border-radius:8px}.gallery{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.photo{background:white;border:1px solid #e0e5dc;border-radius:12px;overflow:hidden}.photo img{display:block;width:100%;aspect-ratio:3/2;object-fit:contain;background:#e8eae2}.photo-text{padding:15px}.photo p{font-size:13px;color:#59665f}.photo .credit{font-size:11px;overflow-wrap:anywhere}details{font-size:12px;margin-top:12px}summary{cursor:pointer;min-height:30px}.empty{background:#eceee6;border:1px dashed #bec9bc;border-radius:10px;padding:40px 20px;text-align:center;color:#65745f}.note-links{display:grid;gap:12px;margin-top:10px}code{overflow-wrap:anywhere}footer{padding:30px 0;font-size:13px;color:#617666}[hidden]{display:none!important}@media(max-width:760px){main{padding:25px 16px}h1{font-size:30px}.compare{grid-template-columns:1fr}.gallery{grid-template-columns:1fr}aside{order:2}.toolbar{flex-wrap:wrap}.stats{gap:18px}.photo img{aspect-ratio:3/2}section>header{align-items:start}.intro{font-size:14px}}@media(prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}}
/* 选片保持原比例；切换裁切框时才使用 cover，不拉伸图片。 */
.compare{grid-template-columns:230px minmax(0,1fr)}.gallery{align-items:start;margin-bottom:30px}.photo{min-width:0}.photo-heading{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:6px;padding:12px 15px}.display-frame{display:block;background:#e8eae2}.display-frame img{display:block;width:100%;height:auto;aspect-ratio:auto;object-fit:cover;object-position:center}.dimensions,.photo .dimensions{margin:0;padding:7px 15px;background:#f0f3ec;font-size:12px;color:#536158}.photo-text{padding:4px 15px 16px}.photo p{font-size:14px;color:#536158}.photo .credit,.photo .status{font-size:12px}.crop-note{border-left:3px solid #8ea88c;padding-left:10px}.withdrawn .tag{background:#f0e5d9}.reference{border-color:#99b69a}.tag{font-size:12px}.toolbar{flex-wrap:wrap;gap:10px 20px}.control{display:flex;gap:10px;align-items:center}select,summary{min-height:44px}.view-note{font-size:13px;color:#536158}a:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid #356953;outline-offset:4px}
body[data-view="square"] .display-frame img{aspect-ratio:1;height:auto}
body[data-view="portrait"] .display-frame img{aspect-ratio:4/5;height:auto}
body[data-view="landscape"] .display-frame img{aspect-ratio:3/2;height:auto}
@media(max-width:760px){.compare{grid-template-columns:1fr}.toolbar{position:static}.control{flex-wrap:wrap}section>header{flex-wrap:wrap}.display-frame img{aspect-ratio:auto}section{scroll-margin-top:20px}}
</style><body data-view="original"><main><div class="eyebrow">TRIPWEAVER / HANGZHOU PHOTO PILOT</div><h1>杭州，先选对，再选美。</h1><p class="intro">最新方向为横版优先、氛围感优先，优秀竖图保留备选。这里保留首轮来源与撤回记录；最新候选顺序和图文布局比较请进入下方对比页。断桥的普通游客照不因横版而恢复精选。</p><p><a href="landscape.html" style="display:inline-flex;align-items:center;min-height:44px;padding:8px 16px;margin-top:12px;background:#e0e9df;border:1px solid #a3b6a3;border-radius:8px;font-weight:600">查看最新对比：原版中图 / 当前小图 / 横版保留构图 →</a></p>
'''
usable = [photo for place in library['places'] for photo in approved(place)]
withdrawn_count = sum(p['review']['status'] != 'approved' for place in library['places'] for p in place['photos'])
page += f'<div class="stats"><div><strong>{len(usable)} 张</strong><span>当前可用精选 · Pexels {sum(p["attribution"]["source"] == "pexels" for p in usable)} / Commons {sum(p["attribution"]["source"] == "commons" for p in usable)}</span></div><div><strong>{sum(bool(approved(p)) for p in library["places"])} / 10</strong><span>景点有可用精选</span></div><div><strong>{withdrawn_count} 张撤回</strong><span>断桥重新选片，保留原因与对照</span></div></div>'
page += '<p><a href="openverse.html" style="display:inline-flex;align-items:center;min-height:44px;font-weight:600">新增来源：Openverse / Flickr · 查看新候选 →</a></p>'
page += '<div class="toolbar"><div class="control"><label for="place">浏览景点</label><select id="place"><option value="all">全部10个景点</option>' + ''.join(f'<option value="place-{i}">{e(p["name"])} · {len(approved(p))} 张精选</option>' for i,p in enumerate(library['places'])) + '</select></div><div class="control"><label for="view">展示方式</label><select id="view"><option value="original">原比例 · 完整构图</option><option value="square">1:1 方形 · 裁切对照</option><option value="portrait">4:5 竖版 · 裁切对照</option><option value="landscape">3:2 横版 · 裁切对照</option></select></div></div><p id="view-note" class="view-note" aria-live="polite">当前显示完整比例。点击图片可以单独放大。</p>'
page += ''.join(sections) + '''<footer><a href="https://www.pexels.com" target="_blank" rel="noopener noreferrer">Photos provided by Pexels</a> · Commons作品逐张保留作者及许可。小红书单图是风格参考，展示授权仍待核实。裁切仅作本地比较，不修改原图或已保存行程。2026.09.30 · 调整中</footer></main>
<script>
const place = document.querySelector('#place');
const view = document.querySelector('#view');
function filterPlace(){
  document.querySelectorAll('section').forEach(section => section.hidden = place.value !== 'all' && section.id !== place.value);
  const url = new URL(location.href);
  if(place.value === 'all') url.searchParams.delete('place'); else url.searchParams.set('place', place.value);
  history.replaceState(null, '', url);
}
const initial = new URL(location.href).searchParams.get('place');
if([...place.options].some(option => option.value === initial)) place.value = initial;
filterPlace();
place.addEventListener('change', filterPlace);
view.addEventListener('change', () => {
  document.body.dataset.view = view.value;
  document.querySelector('#view-note').textContent = view.value === 'original'
    ? '当前显示完整比例。点击图片可以单独放大。'
    : '当前为统一比例、居中裁切预览；请比较主体、前景与倒影的损失。不会修改原图或已保存行程。';
});
</script></body></html>'''
(OUT / 'index.html').write_text(page, 'utf-8')
print(str(OUT / 'index.html'))
