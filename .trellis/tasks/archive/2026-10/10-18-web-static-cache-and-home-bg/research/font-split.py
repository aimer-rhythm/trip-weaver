import re, os, glob
css = open("apps/web/src/styles/tailwind.css", encoding="utf-8").read()
blocks = re.findall(r"@font-face\s*\{[^}]*'Youran Handwriting'[^}]*\}", css)
faces = []
for b in blocks:
    src = re.search(r"youran-[^')]+\.woff2", b).group(0)
    rng = re.search(r"unicode-range:\s*([^;]+);", b).group(1)
    cps = set()
    for token in rng.split(","):
        token = token.strip().replace("U+", "")
        if "-" in token:
            a, z = token.split("-")
            cps.update(range(int(a, 16), int(z, 16) + 1))
        else:
            cps.add(int(token, 16))
    path = "apps/web/public/fonts/handwriting/" + src
    faces.append((src, cps, os.path.getsize(path)))
print("youran 分片:", len(faces), " 总字节:", round(sum(f[2] for f in faces)/1024/1024, 2), "MB")
print("单片大小: min=%dKB max=%dKB 中位=%dKB" % (min(f[2] for f in faces)//1024, max(f[2] for f in faces)//1024, sorted(f[2] for f in faces)[len(faces)//2]//1024))
print()
samples = ["杭州", "北京", "成都", "南京", "西湖漫步", "故宫", "胡同寻味", "待安排的旅程", "三天两夜江南行", "上海 · 外滩夜景"]
for s in samples:
    hit = [f for f in faces if any(ord(c) in f[1] for c in s)]
    print("%-14s 命中 %d 片  %5dKB  %s" % (s, len(hit), sum(h[2] for h in hit)//1024, ",".join(h[0] for h in hit)))
print()
cover = set("京津冀晋蒙辽吉黑沪苏浙皖闽赣鲁豫鄂湘粤桂琼渝川贵云藏陕甘青宁新港澳台")
cities = ["北京","上海","广州","深圳","杭州","南京","苏州","成都","重庆","西安","武汉","长沙","厦门","青岛","大连","昆明","丽江","三亚","桂林","哈尔滨","济南","郑州","合肥","福州","南昌","贵阳","兰州","西宁","银川","乌鲁木齐","拉萨","呼和浩特","太原","石家庄","天津","沈阳","长春","南宁","海口","宁波","无锡","扬州","绍兴","嘉兴","泉州","洛阳","开封","敦煌","张家界"]
hit = [f for f in faces if any(ord(c) in f[1] for c in "".join(cities))]
print("50 个热门城市名合计命中: %d 片 / %dKB" % (len(hit), sum(h[2] for h in hit)//1024))
