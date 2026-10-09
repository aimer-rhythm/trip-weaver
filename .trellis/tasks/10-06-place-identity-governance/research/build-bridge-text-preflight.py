from pathlib import Path
root=Path(__file__).resolve().parent
s=(root/'verify-last-restaurants-photo-preflight.test.mts').read_text(encoding='utf-8')
s=s.replace('第64批','第65批').replace('四家餐馆实际图库','起凤桥及八号实际图库').replace('batch-63','batch-64').replace('last-restaurants-photo','bridge-text-photo')
s=s.replace("['5781e650f27ad011986a13e12281e79f','c057999eba2876818984ed6c93375936','4486ee493729467741a9428ba67b1b80','e2740e4ad547f99f5ff9311f7d5359b8']","['908b0aec5ee27f58554a8442f8eef1de','fd7c5d9a0af5a1ec9515743d6f05bce5']")
s=s.replace("['许记排骨','华祥糕点','桥下把子肉','蜗牛叔叔的食堂']","['起凤桥','起凤桥八号']").replace('queued,4','queued,2').replace('batch:64','batch:65').replace('fullCityAfterEntityBatch:63','fullCityAfterEntityBatch:64')
with (root/'verify-bridge-text-photo-preflight.test.mts').open('x',encoding='utf-8') as f:f.write(s)
