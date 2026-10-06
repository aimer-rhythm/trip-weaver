# 实现与自测记录（待用户验收）

## 实现
- HomePage：缩小移动地图，压缩标题与间距；纵向规划卡片使用独立 1px 缩放标尺和底部安全区。
- HomeCapsule：手机以 Modal sheet 展示同一份表单；原生关闭、Escape、焦点返回；日历单月与 44px 行高；人数按钮至少 44px；备注字号 16px；开始规划显示文字。
- ChinaMap：移动端居中和正常文档流，允许页面纵向触摸/滚轮滚动；横向拖动、点选、缩放和重置保留；减少动态效果时关闭光圈动画。
- 所有业务逻辑与账号草稿语义保持；未改动进入本任务前已有的专属建议等工作。

## 验证
- `npm run typecheck`：通过。
- `npm run build -w apps/web`：通过；保留既有大包体提示。
- `node apps/web/tests/home-mobile-browser.mjs`：8 个尺寸全部通过：320×568、375×812、390×844、430×932、768×1024、844×390、1024×768、1440×900。
- 浏览器检查涵盖横向溢出、导航边界、四种面板、单/双月、日期范围、节奏与人数、偏好和长备注、Escape 焦点返回、访客登录弹窗、城市空/错误状态、地图点选/缩放/重置、真实触摸纵向滚动以及零业务写入。
- 已人工查看手机首页、日期/偏好弹层、小屏、横屏与桌面截图。
- `git diff --check`：通过。
- `node --test apps/web/tests/styles.test.mjs`：未通过。既有 `apps/web/src/pages/LoginPage.tsx` 原生 `<button>` 违反全局共享控件规则，该文件不在本任务改动范围，未扩大范围修改。

## 交付
- 本地预览：http://127.0.0.1:5173/
- 最终手机截图：`after/home.png`、`after/date.png`、`after/preferences.png`。
- 全部截图与机器结果：`data/home-mobile-verification/`（通过 HOME_TEST_OUTPUT 可改变输出目录）。
- 按 AGENTS.md，本次仅实现与自测，任务保持 in_progress；未提交、未归档，等待用户明确验收。
