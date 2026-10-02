# 新行程的视觉审核图库与后台补图

## 1. Scope / Trigger

正式入口 `orchestrator.ts` 仅注入 `createGenerationPhotoLookup`。2026-10-02 起，北京先使用用户明确授权的固定选图快照，无可用选图才使用视觉审核补图库；其他城市继续视觉审核优先。旧 adapter 和旧图库仍供历史数据、采集与兼容测试使用，但不得作为正式新行程的无审核兜底。

## 2. Signatures

- `createGenerationPhotoLookup(city)(name)`：人工选图→审核补图→未命中异步入队，返回 null。
- `createSelectedPhotoLibrary(city,{library?,dataRoot?,unsplashKey?,mediaBase?,adoptUnsplash?})`：`coverFor`、`canonicalName`、`acceptSupplement`。部署清单是`apps/server/src/data/photography/beijing-selected.json`，不是运行时读取研究快照。
- `createPhotoAdopter(options)`：人工和模型目录共用署名、字节摘要、去重、三图上限及Unsplash采用规则；人工目录顺序保持稳定，不套用模型审美排序。
- `createPhotoReviewQueue({run,dataRoot,dailyLimit})`：`enqueue`、`retryNow`、`tick`、`start`、`stop`、`jobs`。
- `collectPhotoCandidates(city,name,config,{signal,supplemental})` 与 `reviewPhotoCandidates(...)`：后台采集及审图。
- `node --import tsx apps/server/scripts/review-place-photos.mts --city 北京 --places 故宫博物院,天坛公园`：预热入队；`--status`查看状态；`--run --max-jobs 3`仅在没有正式worker运行时用于独立处理。
- `--retry`只提前重试failed任务，不重置尝试数，不绕过3次上限和每日地点预算；`data/photo-store/review-reports`保存每地点审图数量与失败阶段，不记录底层凭据异常。

## 3. Contracts

- 北京选图使用明确授权的快照，记录`snapshotId`、`selectedAt`、每图`selectionKey`和单独核对的地点证据；不把人工审美选择伪装为模型评分或地点认证。原快照和实时反馈不改写。后台`reviewed`写入不能覆盖该人工清单。
- 至少一张人工选图可用就返回；不为凑满三张混入模型图。全部不可用才补图。用户明确排除的同景点作品与暂缓的身份冲突作品在审核补图排序、三图截断之前过滤；高德和小红书按具体图片URL/摘要过滤，不按POI/笔记集合链接连带排除其他图。
- 显式别名在人工读取、审核补图读取及新入队前统一，例如天坛→天坛公园、国博/中国国家博物馆→国家博物馆。不同长城段、孔庙/国子监、天安门城楼/广场、前门大街/大栅栏不以邻近为由合并。已有旧名称队列不批量删改。
- `beijing-selection-decisions.json`保存本轮例外与别名；任务内`import-selected-beijing.mts --apply`固定读取已授权快照，校验版本并复制已有图片到内容摘要命名的media文件，没有网络采集；将Commons语言版许可URL规范化为同一许可的主地址。修改决策后应重新导入、验证清单与文件；部署必须保留media。新照片授权仍来自原平台。
- 生成只等待新版目录读取及必要的Unsplash采用上报，不等待采集、图片下载或视觉模型。缺图显示既有默认图标/文字卡；后台结果供后续生成使用，不回写已返回候选或旧行程。
- 视觉模型独立配置 `PHOTO_REVIEW_BASE_URL`、`PHOTO_REVIEW_API_KEY`、`PHOTO_REVIEW_MODEL`，不自动把普通行程模型当作视觉模型。`PHOTO_REVIEW_ENABLED=false`暂停worker；已审核图库仍可读。后台仅用站点凭据，队列不保存用户ID、行程、备注或个人密钥。
- 使用 `PHOTO_REVIEW_VERSION` 分隔结果与任务；修改审核规则必须更新版本。审核缓存键包括版本、提示词摘要、模型及端点、城市、具体地点、图片摘要/官方URL、来源证据。旧版目录不能绕过新版审核；不删除旧媒体。
- 地点身份、单张实拍、清晰度及主体可读性为门槛；其后按代表性→构图→光线的分档顺序比较，不采用加权总分或来源权重。unknown/mismatch均不采用。人物仅在无关主角或明显遮挡时排除；街区正常人流、局部、竖幅、夕阳均不自动决定胜负。
- 每景点各源有界采集，跨Pexels/Pixabay/Unsplash/Commons及已有图库/高德补充，轮转最多18张进入审核。搜索排名只限制本轮候选范围，不证明地点身份或摄影质量。
- 查询缓存24h；审核成功和明确拒绝均缓存，调用/格式失败不作为审核结论缓存。图片副本复用photoStore的限大小、固定主机、内容摘要与原子写入；Unsplash保持官方hotlink，不自托管，也不在采集时上报采用。
- 新行程最终采用Unsplash时才上报对应download_location；同任务重复读取合并，上报失败则补位。每张图片保留自身署名。XHS保留原导入署名/授权状态，不因模型审核变更权利声明；高德继续使用原外链、不伪造作者。
- 本地文件验证字节摘要和图片magic；精确城市、名称/显式别名，允许移除一次尾部展示括注，禁止借用邻近景点。最多三图；首图与cover一致，排除同字节摘要或相同视角标签。视角标签并非完整的感知去重算法。
- 单实例队列持久化在 `data/photo-store/review-jobs`，同地点去重，积压最多200，串行worker，默认每24h最多10个地点（配置上限50），失败最多3次，30/60/90分钟退避。进程中断的running任务15分钟后可恢复。目录在 `data/photo-store/reviewed`，审图缓存在 `visual-reviews`。部署时这些目录与media一起保留。
- 这是现有单实例服务的队列，不支持两个worker/CLI或多副本同时消费同一目录。不会自动以后台补图耗时增加用户生成配额。

## 4. Validation / Errors

| 输入/故障 | 行为 |
| --- | --- |
| 有可用人工选图 | 原顺序最多三张，不读模型图库、不入队 |
| 人工选图缺文件/哈希不符/Unsplash采用失败 | 同一人工目录补位；全不可用时走审核补图 |
| 用户排除/身份暂缓 | 自动补图也不能重新采用该景点的同作品 |
| 缺图库、旧版本、错城、名称歧义 | null；后台补图，禁止旧来源兜底 |
| 地点未知/错配、泛风景、遮挡主体 | 保留拒绝依据，不入展示 |
| 文件缺失/字节变化/无效署名 | 跳过并尝试下一张 |
| 模型失败或畸形响应 | 不缓存为拒绝；后台重试，不影响行程 |
| 部分成功 | 保存有效审核结果，失败部分保留重试 |
| 缺视觉配置/关闭worker | 保留队列；不谎称已审核 |
| 入队写入失败 | 安全日志；不让图片错误终止行程 |

## 5. Cases

- Good：圆明园跨源选择遗址照片，拒绝漂亮的颐和园/故宫错配及泛荷花图。
- Good：北京圆明园已有用户选中的两张遗址图，即使模型图库有三张高评分图片，也只返回这两张；天坛别名共享同一选择。
- Base：新地点无已审核图，本次文字卡，后台成功后下一次生成得到照片。
- Bad：调用方使用 `reviewed ?? legacyCover`，或在 `add_candidate` 等待 `reviewPhotoCandidates`。

## 6. Tests

`selectedPhotos.test.ts`、`reviewedPhotos.test.ts`、`photoCollection.test.ts`、`photoReviewQueue.test.ts`、`placeLookup.test.ts`；覆盖人工优先/一图不混补/别名/损坏补位/拒绝记录作用域/先过滤再截断/同小红书笔记不同照片不连带排除/Unsplash采用失败与同任务去重，以及既有分层门槛、缓存隔离、非阻塞与队列恢复。运行根目录typecheck；真实试跑记录所选图、失败/覆盖边界与浏览器解码，不能把单景点成功称作全城覆盖。

任务内 `verify-selected-replay.mts` 校验真实人工目录、所有本地图片字节及HTTP响应，调用正式 `add_candidate` 验证人工优先和显式别名；Unsplash采用回执模拟成功，入队使用隔离记录，不能称为新一轮真实行程生成。`verify-selected-browser.mjs` 在隔离API夹具中用真实前端与真实图片验证桌面/手机相册及逐图署名，所有非GET请求均计数并要求为零。原始快照和旧行程保持不变。

## 7. Wrong / Correct

```ts
// Wrong: 重用旧来源短路，并阻塞本次生成。
return await oldPexelsCache(name) ?? await collectAndReview(name);

// Correct: 授权人工选图优先，缺图工作与本次返回分离。
const selected = await userSelection(name);
if (selected) return selected;
const cover = await reviewed(name);
if (!cover) void enqueue(name).catch(logSafeFailure);
return cover;
```
