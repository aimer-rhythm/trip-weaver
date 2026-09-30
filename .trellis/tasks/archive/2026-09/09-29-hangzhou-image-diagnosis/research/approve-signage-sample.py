"""记录 Codex 实际查看原图后的明确招牌样本复核，不批量批准视觉建议。"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
bundle = json.loads((HERE / 'hangzhou-proposed-v2.json').read_text(encoding='utf-8'))
item = next(item for item in bundle['images'] if item['image_id'] == 385)
place = next(place for place in item['candidates'] if place['name'] == '香积寺')
item.update(
    place_id=place['id'], place_name=place['name'], status='APPROVED',
    reviewer='Codex（原图视觉复核）', review_kind='agent', image_kind='single_photo', cover_usable=True,
    evidence='已打开原始图片核对：建筑正面金色匾额从右至左清晰写有“香积寺”，画面为单张建筑实拍，无拼接与攻略文字覆盖；同笔记杭州有效候选包含香积寺。',
)
bundle['images'] = [item]
(HERE / 'hangzhou-reviewed-signage.json').write_text(json.dumps(bundle, ensure_ascii=False, indent=2), encoding='utf-8')
print('仅批准原图已复核的香积寺样本 385')
