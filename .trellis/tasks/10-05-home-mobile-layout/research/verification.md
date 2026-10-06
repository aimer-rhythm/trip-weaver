# 首页移动端重做：实现与验证（待用户验收）

## 当前结果
- 手机首屏为行程规划卡片，下方为目的地精选；顶部保留品牌、通知和登录/退出入口，首页和行程列表提供底部导航。
- 目的地使用全屏 Modal，支持搜索、地图缩放/重置、候选预览、确认、取消、浏览器返回/前进和直接查询链接。取消不改变城市；日期与账号偏好草稿保留。
- 日期、节奏/人数、偏好复用原有表单与底部弹层，保留桌面地图和横向胶囊。
- 按用户最新要求复用现有已审核图库：北京天坛、杭州雷峰塔、厦门鼓浪屿。沿用 eligibleReview、署名、用户排除与 verifiedPhotoBytes 门槛，原始文件 SHA-256 全部一致。来源与审核记录见 apps/web/src/assets/destinations/sources.json。
- 精选仅与接口返回城市取交集。图片失败依次降级为城市插画、可访问占位；未覆盖城市不能选入。

## 验证
- npm run typecheck：通过。
- npm run build -w apps/web：通过，保留既有大包体提示。
- HOME_TEST_URL=http://127.0.0.1:5175 node apps/web/tests/home-mobile-browser.mjs：最终构建 8/8 通过，320×568、375×812、390×844、430×932、768×1024、844×390、1024×768、1440×900。
- 该回归覆盖四种面板、单/双月日历、范围选择、长备注、取消/Back/Forward、直接查询链接、生成参数、访客登录、空/错误城市、真实触摸滚动、图片与插画失败、列表底部导航和草稿阶段零业务写入。
- node apps/web/tests/login-dialog-browser.mjs：通过。
- node --import tsx apps/web/tests/navigation-notifications-browser.mjs：通过，包括通知、后台生成和离页保存保护。
- BASE=http://127.0.0.1:5174 node --import tsx apps/web/tests/travel-preferences-browser.mjs：通过，包括仅成功生成后记忆、失败不保存、账号隔离和保存失败重试。已更新测试以适配跨断点关闭弹层及退出后的首页登录弹窗。
- git diff --check：通过。
- node --test apps/web/tests/styles.test.mjs：仍因既有 LoginPage.tsx 原生 button 失败；与上一版验证记录一致，该文件未改。
- 已查看手机、小屏日期弹层、全屏目的地、实景图、桌面截图；11 城预览中济南向左避开青岛，增加相邻标签不重叠断言。最终调整后类型检查、构建和 8 尺寸回归再次通过。

## 预览与证据
- 独立界面预览：http://127.0.0.1:5175/ （固定隔离数据，只读，不创建真实行程）。
- 启动命令：node .trellis/tasks/10-05-home-mobile-layout/research/preview.mjs，需要先构建 apps/web。
- 已在真实浏览器验证该预览可展示图片、选择杭州、打开目的地弹窗。
- 截图：after/mobile-preview.jpg、after/home-ready.png、after/destination.png、after/date.png、after/desktop.png。
- 8 尺寸测试结果：after/results.json；完整截图保留在 data/home-mobile-verification。
- 登录与导航回归截图移入本任务 research/regressions，其他任务原有截图保持不变。
- 原 5173 开发服务曾返回陈旧模块错误且后端 API 返回 502，因此最后的账号回归改用独立构建预览 5174（验证后已停止），交付预览使用 5175。

## 状态
实现与自测已具备交付条件，按 AGENTS.md 等待用户明确验收。任务保持 in_progress；本会话未提交、未归档、未运行自动收尾。
