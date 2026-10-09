"""审核既有图片文字中的完整警告；不读取图片、不伪造PlaceMention。"""
from __future__ import annotations

import copy
import re

from app.clean.identity import name_key
from app.clean.mention_identity import digest

FIELDS = {'noteId', 'imageIndex', 'start', 'end', 'quote', 'entityId', 'inputHash'}


def warning_text(note: dict | None, image_index: int) -> str | None:
    images = note.get('images') if note else None
    if (not isinstance(images, list) or type(image_index) is not int or image_index < 0
        or image_index >= len(images) or not isinstance(images[image_index], dict)):
        return None
    value = images[image_index].get('text_content')
    return value if isinstance(value, str) else None


def warning_input(note_id: int, image_index: int, note: dict | None) -> dict:
    state = {key: note.get(key) if note else None for key in
             ('city', 'title', 'desc', 'unavailable', 'observedAt', 'publishedAt')}
    return {'noteId': note_id, 'imageIndex': image_index,
            'inputHash': digest(['note_text_warning_v1', note_id, image_index, state, warning_text(note, image_index)])}


def warning_refs(values: list[dict]) -> list[dict]:
    if (not isinstance(values, list) or any(not isinstance(v, dict)
        or type(v.get('noteId')) is not int or v['noteId'] <= 0
        or type(v.get('imageIndex')) is not int or v['imageIndex'] < 0 for v in values)):
        raise ValueError('补充警告的笔记引用无效')
    return [{'noteId': nid, 'imageIndex': index} for nid, index in
            sorted({(v['noteId'], v['imageIndex']) for v in values})]


def validate_text_warnings(value, *, city: str, notes: dict[int, dict], entities: dict[str, dict],
                           confirmed_ids: set[str]) -> list[dict] | None:
    if value is None:
        return None
    if not isinstance(value, list):
        raise ValueError('补充警告必须为完整列表，移除时显式提供空列表')
    seen = set()
    for item in value:
        if (not isinstance(item, dict) or set(item) != FIELDS
            or type(item['noteId']) is not int or item['noteId'] <= 0
            or type(item['imageIndex']) is not int or item['imageIndex'] < 0
            or type(item['start']) is not int or item['start'] < 0
            or type(item['end']) is not int or item['end'] <= item['start']
            or not isinstance(item['quote'], str) or not 8 <= len(item['quote']) <= 500
            or not isinstance(item['entityId'], str) or item['entityId'] not in confirmed_ids
            or not isinstance(item['inputHash'], str) or not re.fullmatch(r'[a-f0-9]{64}', item['inputHash'])):
            raise ValueError('补充警告须有本scope已确认主体、完整原句位置和有效指纹')
        key = (item['noteId'], item['imageIndex'], item['start'], item['end'])
        if key in seen:
            raise ValueError('补充警告重复')
        seen.add(key)
        note = notes.get(item['noteId'])
        text = warning_text(note, item['imageIndex'])
        if not note or note['city'] != city or note['unavailable'] or text is None:
            raise ValueError('补充警告须来自本城当前可用的已有文字分析')
        if warning_input(item['noteId'], item['imageIndex'], note)['inputHash'] != item['inputHash']:
            raise ValueError('补充警告原文或日期已变化，须重新审核')
        start, end, quote = item['start'], item['end'], item['quote']
        lines = re.split(r'\r\n|[\n\r\u2028\u2029]', quote)
        if (end > len(text) or text[start:end] != quote or len(lines) not in (1, 2)
            or any(not line or line != line.strip() for line in lines)
            or (start != 0 and text[start-1] not in '\n\r\u2028\u2029')
            or (end != len(text) and text[end] not in '\n\r\u2028\u2029')):
            raise ValueError('补充警告须为完整单行或相邻两行，不能剪裁否定词、空行或跨段拼接')
        entity = entities.get(item['entityId'])
        names = [entity['canonical_name'], *entity.get('aliases', [])] if entity else []
        if (not entity or entity['city'] != city or entity['status'] != 'ACTIVE' or entity.get('redirect_to')
            or not any(name_key(name) and name_key(name) in name_key(quote) for name in names)):
            raise ValueError('补充警告原句未明确对应当前主体')
        if len(lines) == 2:
            name_keys = {name_key(name) for name in names if name_key(name)}
            if not any(name_key(line) in name_keys for line in lines):
                raise ValueError('双行补充警告须有一行是完整主体名称，不接受混合地点或拆开的名称')
    return copy.deepcopy(value)
