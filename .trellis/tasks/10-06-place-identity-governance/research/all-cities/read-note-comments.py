"""有限读取指定笔记的公开门店问答；不发评论、不更新源库、不保存作者身份。"""
import asyncio
import argparse
import contextlib
from datetime import datetime, timezone
import hashlib
import json
import logging
import os
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
parser = argparse.ArgumentParser()
parser.add_argument('filename')
parser.add_argument('notes', nargs='+')
parser.add_argument('--pages', type=int, choices=(1, 2, 3), default=1)
parser.add_argument('--target-replies', action='store_true')
parser.add_argument('--start-page', type=int, choices=range(1, 8), default=1,
                    help='旧报告未保存cursor时有限前进；前面的页只用于取得分页游标')
parser.add_argument('--resume-report', help='从本目录既有证据的nextCursor继续，不重复拉取旧页')
args = parser.parse_args()
filename, values = args.filename, args.notes
assert re.fullmatch(r'[a-z0-9-]+\.json', filename)
assert values and len(values) <= 4 and all(re.fullmatch(r'\d+', v) for v in values)
assert len(set(values)) == len(values)
target = base / filename
assert not target.exists(), '只读证据不能覆盖'
resume = {}
if args.resume_report:
    assert re.fullmatch(r'[a-z0-9-]+\.json', args.resume_report)
    assert args.start_page == 1, 'resume和start-page不可混用'
    resume = {row['id']: row for row in json.loads((base/args.resume_report).read_text(encoding='utf-8'))['notes']}
    assert all(value in resume and resume[value].get('hasMore') and resume[value].get('nextCursor') for value in values)
assert settings.xhs_cookie, '须有现有登录采集会话'
logging.disable(logging.CRITICAL)
target_name = re.compile(r'mondoli|cuida|riverside|old six|苏州|金海湾|佛图关', re.I)
relevant = re.compile(r'mondoli|cuida|riverside|old six|苏州|金海湾|佛图关|地址|哪家|哪儿|哪里|在哪|分店|天仙|合江|源野|第?[九十]|图[一二三四五六七八九十\d]+|\bp?\d{1,2}\b', re.I)

def clean_comment(comment, owner):
    content = str(comment.get('content') or '')
    # 用户标识只用于判断是否原作者回复，结果仅保存布尔值。
    author = str((comment.get('user_info') or {}).get('user_id') or '')
    reply_target = comment.get('target_comment') or {}
    reply_target_id = str(reply_target.get('id') or '') if isinstance(reply_target, dict) else ''
    return {'commentIdSha256': hashlib.sha256(str(comment.get('id') or '').encode()).hexdigest(),
            'targetCommentIdSha256': hashlib.sha256(reply_target_id.encode()).hexdigest() if reply_target_id else None,
            'text': content[:2000], 'textTruncated': len(content) > 2000,
            'isNoteAuthor': bool(owner and author == owner),
            'createdAt': comment.get('create_time')}

async def main():
    engine = create_async_engine(settings.database_url)
    try:
        async with engine.connect() as conn:
            await conn.execute(text('BEGIN READ ONLY'))
            await conn.execute(text("SET LOCAL statement_timeout='15s'"))
            rows = (await conn.execute(text('SELECT id,note_id,source_url,author_id FROM raw_note WHERE id=ANY(:ids) ORDER BY id'),
                {'ids': [int(v) for v in values]})).mappings().all()
            assert len(rows) == len(values)
            await conn.rollback()
    finally:
        await engine.dispose()
    results = []
    # 每篇最多3页新内容；start-page可额外遍历最多6页旧内容取得游标。
    # 只有显式目标名线程可再取1页回复，每篇最多2线程。
    # 不调用任何get_note_all接口，不自动重试失败。
    with open(os.devnull, 'w', encoding='utf-8') as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
        async with XhsClient() as client:
            for row in rows:
                item = {'id': str(row['id']), 'sourceUrl': f"https://www.xiaohongshu.com/explore/{row['note_id']}"}
                try:
                    hit = hit_from_source_url(row['note_id'], row['source_url'])
                    prior = resume.get(str(row['id']))
                    comments, page_results, cursor = [], [], prior['nextCursor'] if prior else ''
                    start_page = prior['lastPage'] + 1 if prior else args.start_page
                    first_page = start_page if prior else 1
                    for page_number in range(first_page, start_page + args.pages):
                        await client._throttle()
                        client._count_request()
                        ok, _, response = await asyncio.to_thread(client._api.get_note_out_comment, hit.note_id, cursor, hit.xsec_token)
                        if not ok:
                            page_results.append({'page': page_number, 'ok': False})
                            break
                        data = (response or {}).get('data') or {}
                        entries = data.get('comments') or []
                        assert isinstance(entries, list)
                        if page_number >= start_page:
                            comments.extend(entries)
                        page_results.append({'page': page_number, 'ok': True, 'count': len(entries), 'hasMore': bool(data.get('has_more')),
                            'cursorTraversalOnly': page_number < start_page})
                        next_cursor = str(data.get('cursor') or '')
                        if not data.get('has_more') or not next_cursor or next_cursor == cursor:
                            break
                        cursor = next_cursor
                    selected = []
                    reply_requests = 0
                    seen = set()
                    for comment in comments:
                        if comment.get('id') in seen:
                            continue
                        seen.add(comment.get('id'))
                        replies = comment.get('sub_comments') or []
                        reply_page = None
                        if args.target_replies and reply_requests < 2 and comment.get('sub_comment_has_more') and any(
                            target_name.search(str(c.get('content') or '')) for c in [comment, *replies]
                        ):
                            await client._throttle()
                            client._count_request()
                            reply_requests += 1
                            reply_ok, _, reply_response = await asyncio.to_thread(client._api.get_note_inner_comment, comment, '', hit.xsec_token)
                            reply_data = (reply_response or {}).get('data') or {}
                            reply_page = {'ok': bool(reply_ok), 'hasMore': bool(reply_data.get('has_more'))}
                            if reply_ok:
                                by_id = {c.get('id'):c for c in replies}
                                by_id.update({c.get('id'):c for c in reply_data.get('comments') or []})
                                replies = list(by_id.values())
                        if not any(relevant.search(str(c.get('content') or '')) for c in [comment, *replies]):
                            continue
                        selected.append({**clean_comment(comment, row['author_id']),
                            'replies': [clean_comment(c, row['author_id']) for c in replies],
                            'initialMoreRepliesAvailable': bool(comment.get('sub_comment_has_more')),
                            'moreRepliesAvailable': reply_page['hasMore'] if reply_page and reply_page['ok'] else bool(comment.get('sub_comment_has_more')),
                            'replyPage': reply_page})
                    results.append({**item, 'ok': all(p['ok'] for p in page_results), 'pagesRead': len(page_results),
                        'pages': page_results, 'hasMore': page_results[-1].get('hasMore'),
                        'nextCursor': cursor if page_results[-1].get('hasMore') else None,
                        'lastPage': page_results[-1]['page'], 'requestedStartPage': start_page,
                        'commentsScanned': len(comments), 'selection': 'address_or_target_name_or_page_number', 'threads': selected})
                except Exception as error:
                    results.append({**item, 'ok': False, 'error': type(error).__name__})
    report = {'capturedAt': datetime.now(timezone.utc).isoformat(), 'upstreamReadOnly': True,
        'publicCommentRequestLimit': len(values) * (args.pages + (0 if resume else args.start_page - 1) + (2 if args.target_replies else 0)),
        'resumeReport': args.resume_report,
        'maxNewPagesPerNote': args.pages,
        'maxTraversalPagesPerNote': 0 if resume else args.start_page - 1,
        'completeCommentHistory': False, 'notes': results}
    with target.open('x', encoding='utf-8') as out:
        json.dump(report, out, ensure_ascii=False, indent=2)
        out.write('\n')
    print(json.dumps({'file': filename, 'notes': [{k:v for k,v in r.items() if k in ('id','ok','error','commentsScanned','hasMore')}
        | {'selectedThreads': len(r.get('threads', []))} for r in results]}, ensure_ascii=False))
    if any(not r['ok'] for r in results):
        raise SystemExit(1)

asyncio.run(main())
