# AI 行程分享图

详情页选择「导出行程 → AI 分享图」，点击「生成分享图」后会绘制一张 1024×1536 的中文旅行插画海报。生成后可预览、下载；微信内可以长按保存。JSON 备份和打印/PDF继续使用原有流程。

## 配置

在服务端环境文件（本地 `apps/server/.env`，Docker 使用根目录 `.env`）填写：

```dotenv
IMAGE_API_BASE_URL=https://xjbh.lol/v1
IMAGE_MODEL=gpt-image2.5
IMAGE_API_KEY=在本地填写你的生图服务密钥
```

重启服务后生效。密钥独立于 LLM、搜索和地图凭据，不会发送到浏览器，不自动复用其他 Key。未配置时生成按钮会显示明确错误。

上述第三方地址和模型由用户指定；目前没有服务商文档，协议按 [OpenAI Images API](https://developers.openai.com/api/docs/guides/image-generation) 兼容实现，保留 `gpt-image2.5` 原样。该接口的真实模型可用性、尺寸支持和计费以服务商为准；项目验证使用模拟上游，没有消耗真实生图额度。

请求为 `POST {IMAGE_API_BASE_URL}/images/generations`，Bearer 鉴权，JSON 包含 `model`、`prompt`、`n:1`、`size:"1024x1536"`；兼容 `data[0].b64_json` 和 `data[0].url`。返回 URL 只允许安全 HTTPS 地址，服务器下载时不携带生图密钥、不跟随重定向。支持 PNG/JPEG/WebP，单张最多 10 MiB，请求超时 180 秒。反向代理超时需大于 180 秒，仓库的宿主机 Nginx 模板已设置为 1 小时。

## 提示词与体验

内置提示词位于 `apps/server/src/lib/tripSharePrompt.ts`。风格为奶白、湖蓝、暖橙的旅行手账插画，提取目的地、标题、每天最多六个非住宿活动名称；长于七天的行程绘为摘要。不发送私人备注、住宿、日期、坐标、地址、活动描述和来源链接。图片包含“AI 创作 · 织程”角标，模型可能存在文字或细节偏差，实际出行以详情页为准。

打开弹窗不触发生图；用户点击生成才调用。进行中重复请求合并，同一用户、行程和提示词的成功结果在服务进程中缓存 30 分钟（最多8张）；重新打开弹窗可复用当前图片。失败不自动重试，避免重复计费。并发上限为每用户1个、全进程2个，HTTP接口另有6次/分钟限流。缓存和并发锁随进程重启丢失，当前不支持跨实例共享或图片历史管理；离开详情页后不保证找回进行中的结果。

## 检查

- 单元测试：`node --import tsx --test apps/server/src/__tests__/tripShareImage.test.ts`（需测试用 MASTER_KEY）。
- API：`node --import tsx scripts/verify-trip-share-image.mts`，临时 PostgreSQL 18797端口，自动建立并删除独立数据库。
- 浏览器：`node apps/web/tests/trip-share-image-browser.mjs`，模拟上游，检查显式生成、加载、失败重试、关闭重开、下载和手机布局。
- 服务端日志搜索 `[trip-share-image]` 查看成功/失败及耗时；不会输出提示词、返回图片或密钥。
