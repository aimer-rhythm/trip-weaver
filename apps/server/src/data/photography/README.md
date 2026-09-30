# 城市摄影图库试点

## 自动补图来源（2026-09-30追加）

用户已确认按图源规则分别存储，Unsplash API现已接入。精选和已有选片优先；无图时依次尝试Pexels、Unsplash、Pixabay、高德、维基。每个图源最多提供含封面的3张，不为凑满候选重复查询其他来源。横版、氛围关键词优先属于元数据排序，不能代替本目录的逐图审美审核。

- Unsplash：官方外链展示，保存选片元数据；在新行程选用时上报下载事件，打开已有行程只加载图片、不重新搜索。摄影师主页、作品和许可链接保留referral参数。未使用本地图片缓存，网络可达性仍影响显示。
- Pixabay：查询缓存24小时（含空结果），入选图片保存至本地，后续复用不访问图片源。最多尝试6张下载得到3张有效图。
- 在`apps/server/.env`配置`UNSPLASH_ACCESS_KEY`与`PIXABAY_API_KEY`。单地点实测：`node --import tsx apps/server/scripts/verify-stock-photos.mts`；默认故宫/北京，结果写入`data/photo-pilot/stock-api/latest.json`，不创建收费行程。
- 两项密钥配置后已实测故宫/北京：Unsplash与Pixabay各取得3张，6张真实图片桌面/手机解码通过。Unsplash保留外链且采用上报成功；Pixabay均已本地化，去掉密钥/零预算仍可复用。真实候选对比见`http://127.0.0.1:18799/stock-api.html`，尚未替换既有精选。单地点成功不代表所有城市覆盖。

## 北京试片（2026-09-30）

`beijing-curated.json` / `beijing-provenance.json` 按同一协议保存北京19张照片，覆盖固定三日行程中的8个景点，每处2–3张（含封面）。中国国家博物馆本轮未选：Pexels混入其他建筑，Commons候选主要是普通记录照。精确名称和显式别名匹配，不把泛称长城的图片自动绑定八达岭，不把八达岭复用给慕田峪。

默认运行时按城市选对应清单，杭州数据保持独立。校验北京媒体：`python apps/server/scripts/install-curated-photos.py --city beijing`；恢复时可增加`--download`，限制与杭州相同。

北京首轮取得207条候选记录、73张预览，另复看6张既有Pexels封面（当前共213条/79张）。Openverse仅故宫查询成功，天坛/八达岭两次请求失败，未声称全来源成功。最终19张选自Pexels13张、Commons6张，原图均本地保存。天坛封面与颐和园一张备选沿用既有1300px高的Pexels竖图版本，其余使用1600px及以上来源；统一只等比缩小，不插值放大和裁切。

选片与来源身份说明：任务`research/beijing-selections.json`。`collect-beijing-photos.mts`→`cache-beijing-current.mts`→`build-beijing-curated.py`重建候选/既有来源/清单；不自动批准新检索结果。指定行程`32c3abae-eb1e-4587-8832-5531b2169385`已备份并仅更新这8处配图，活动和对话保留；其他历史行程未批量更新。用户审美验收尚未完成。

## 杭州试点

`hangzhou-curated.json` 是按地点维护的稳定排序，首张仍获批准且可用的图作为封面。当前10个目标中7个有精选图，共19张；另保留3张断桥撤回记录（`rejected`），供审计，不参与精选返回。每处返回最多3张有效照片（含封面），备选在放大后切换。雷峰塔清单中保留4张历史合格记录，运行时仅取前3张。数量不足的地点不借用相邻景点。

- `hangzhou-targets.json`：固定目标、确定别名和检索词。
- `hangzhou-curated.json`：审核人、地点证据、选片理由、输出哈希、作者与许可。
- `hangzhou-provenance.json`：作品标题、原作品/下载地址、下载源及输出哈希，供恢复和审计。
- 本地文件：`data/media/photography/*.webp`，与其他媒体一起部署到媒体卷；媒体不随 Git 自动发布。

校验本地文件：`python apps/server/scripts/install-curated-photos.py`。恢复缺失文件：增加 `--download`，需要 Pillow；仅下载固定 HTTPS 图源，禁止重定向，超时20秒、单图8MiB，核对原图与转换后哈希。若图源变更或 Pillow/libwebp 导致结果不同，停止恢复并重新审核，不自动改哈希。转换：等比最长边1600、WebP quality=88/method=6。

运行时先验证清单、身份、许可与本地哈希，首图缺失/损坏则按清单尝试备选；全部不可用继续已有图源。`pending` / `rejected` 不返回，媒体恢复脚本跳过这些条目，不删除既有文件。精确主名和显式别名可复用，组合地名与近邻不推断匹配。图库自身不在运行时调用外部服务。

摄影质量单独判断：地点准确、许可完整不能代替光线、构图层次、氛围和主体表现。用户反馈断桥记录照游客过多、画面普通后撤回3张；反馈与逐图理由保存在任务的 `research/photo-style-feedback.json`，生成清单时同步应用，避免重建恢复旧排序。最新选片偏好为横版、氛围优先，出众竖图保留；尺寸按长边≥1400/短边≥800判断。详情页采用C布局中等侧图，按原比例缩放，点击后查看最多3张完整照片及各自署名。

Pexels 首次入选后保存至 `data/media/remote-photos`，图源索引与地点选择在 `data/photo-store`；维基保留本地媒体并写入独立地点选择。正向选择无TTL，所有持久选择先于任何新搜索，重启与Pexels密钥缺失也可复用。媒体及索引须一同部署；高德仍按原接口返回外链。历史行程不会自动迁移，本轮只对指定杭州验收行程备份后更新图片字段，8张封面已全部本地化。

新增来源脚本 `apps/server/scripts/collect-openverse-pilot.mts` 通过 Openverse 索引补充 Flickr 作品：本轮43条记录、15张本地预览，均为待审候选，不计入19张精选。每地点最多20条记录/6张预览，复跑复用缓存。对比页 `data/photo-pilot/review/openverse.html` 保留来源与许可；只有逐图地点和摄影质量核实后才可纳入精选。

小红书摄影专项样本仅在本地对照页展示，不进入这份许可清单。既有小红书封面链路不受这份清单是否有图影响。

当前图库为 `agent-reviewed:codex` 选片，尚待用户审美验收，不等同摄影师授权审核。作品使用条件来自各原作品页/图库元数据，前端保留作者、原作品、许可及裁切说明。
