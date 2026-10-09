"""通过现有已登录采集客户端重取指定公开笔记；源库只读，仅保存任务证据。"""
import asyncio
import contextlib
from datetime import datetime, timezone
import hashlib
import json
import logging
from pathlib import Path
import re
import sys

sys.dont_write_bytecode = True
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, 'D:/Project/xhs-travel-pipeline')
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from app.config import settings
from app.crawl.client import XhsClient, hit_from_source_url

base = Path(__file__).resolve().parent
filename, *values = sys.argv[1:]
assert re.fullmatch(r'[a-z0-9-]+\.json', filename)
assert values and all(re.fullmatch(r'\d+', value) for value in values)
assert len(set(values)) == len(values) and len(values) <= 4
target = base / filename
assert not target.exists(), '冻结证据不能覆盖'
assert settings.xhs_cookie, '需要现有已登录采集会话'
logging.disable(logging.CRITICAL)  # 第三方错误可能带访问参数，仅输出本脚本摘要。

async def main():
    engine = create_async_engine(settings.database_url)
    try:
        async with engine.connect() as conn:
            await conn.execute(text('BEGIN READ ONLY'))
            await conn.execute(text("SET LOCAL statement_timeout='15s'"))
            rows = (await conn.execute(text('SELECT n.id,n.note_id,n.title,n.desc,n.source_url FROM raw_note n WHERE n.id=ANY(:ids)'), {'ids':[int(v) for v in values]})).mappings().all()
            assert len(rows) == len(values)
            await conn.rollback()
    finally:
        await engine.dispose()
    results = []
    # 不输出客户端原始响应、作者、Cookie或带xsec_token的链接。
    with open('NUL', 'w', encoding='utf-8') as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
        async with XhsClient() as client:
            for row in rows:
                record = {'id':str(row['id']), 'source_url':f"https://www.xiaohongshu.com/explore/{row['note_id']}"}
                try:
                    detail = await client.detail(hit_from_source_url(row['note_id'], row['source_url']))
                    if detail is None:
                        results.append({**record, 'ok':False, 'error':'detail_unavailable'})
                        continue
                    assert detail.note_id == row['note_id'], '返回笔记ID不一致'
                    results.append({**record, 'ok':True, 'title':detail.title, 'desc':detail.desc,
                        'img_urls':detail.image_urls, 'textUnchanged':detail.title==row['title'] and detail.desc==row['desc'],
                        'previousTextSha256':hashlib.sha256(json.dumps([row['title'],row['desc']],ensure_ascii=False).encode()).hexdigest()})
                except Exception as error:
                    results.append({**record, 'ok':False, 'error':type(error).__name__})
    report = {'capturedAt':datetime.now(timezone.utc).isoformat(), 'upstreamReadOnly':True, 'detailRequestLimit':len(values), 'notes':results}
    with target.open('x', encoding='utf-8') as out:
        json.dump(report,out,ensure_ascii=False,indent=2)
        out.write('\n')
    print(json.dumps({'file':filename,'notes':[{k:v for k,v in r.items() if k in ('id','ok','error','textUnchanged')} for r in results]},ensure_ascii=False))
    if any(not r['ok'] for r in results):
        raise SystemExit(1)

asyncio.run(main())
