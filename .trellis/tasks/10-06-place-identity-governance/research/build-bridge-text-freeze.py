from pathlib import Path
root=Path(__file__).resolve().parent
s=(root/'freeze-last-restaurants.py').read_text(encoding='utf-8')
s=s.replace('四个剩余餐饮主体','起凤桥与八号两个主体').replace('last-restaurants-source-packet-01','bridge-text-source-packet-01').replace('==63','==64').replace("'entityBatch':63","'entityBatch':64")
a=s.index('ids=[');b=s.index('\nasync def main',a)
s=s[:a]+"ids=['908b0aec5ee27f58554a8442f8eef1de','fd7c5d9a0af5a1ec9515743d6f05bce5']"+s[b:]
with (root/'freeze-bridge-text.py').open('x',encoding='utf-8') as f:f.write(s)
