from pathlib import Path
root=Path(__file__).resolve().parent
s=(root/'verify-furong-photo-preflight.test.mts').read_text(encoding='utf-8')
s=s.replace('第63批','第64批').replace('芙蓉街实际图库','四家餐馆实际图库').replace('batch-62','batch-63').replace('furong-photo','last-restaurants-photo')
s=s.replace("['747792d1b5834255f5feaa6c2dc62925']","['5781e650f27ad011986a13e12281e79f','c057999eba2876818984ed6c93375936','4486ee493729467741a9428ba67b1b80','e2740e4ad547f99f5ff9311f7d5359b8']")
s=s.replace("['芙蓉街']","['许记排骨','华祥糕点','桥下把子肉','蜗牛叔叔的食堂']").replace('queued,1','queued,4').replace('batch:63','batch:64').replace('fullCityAfterEntityBatch:62','fullCityAfterEntityBatch:63')
with (root/'verify-last-restaurants-photo-preflight.test.mts').open('x',encoding='utf-8') as f:f.write(s)
