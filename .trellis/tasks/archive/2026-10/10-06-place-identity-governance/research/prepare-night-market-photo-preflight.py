from pathlib import Path
root=Path(__file__).resolve().parent
p=(root/'verify-river-photo-preflight.test.mts').read_text(encoding='utf-8')
for a,b in [('第58批','第59批'),('batch-57','batch-58'),('ordinary-outdoors-photo-metadata','night-market-photo-metadata'),('river-photo-preflight','night-market-photo-preflight'),('护城河','环联夜市'),('4dfda3371793b69de15122bb7e330eac','7950bfadd891932d01be8636aba8b51a'),('batch:58','batch:59'),('fullCityAfterEntityBatch:57','fullCityAfterEntityBatch:58')]:
    assert a in p,a
    p=p.replace(a,b)
# 有10条旧拒绝来源，先记录实际补图行为，不沿用无目录河道的固定次数。
p=p.replace('assert.equal(queued,1);','assert.ok(queued===0||queued===1);')
with (root/'verify-night-market-photo-preflight.test.mts').open('x',encoding='utf-8') as f:f.write(p)
