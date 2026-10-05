# 导航、后台生成与站内通知

## 1. 适用范围

2026-10-05：登录后的全局导航、独立生成页、账号通知持久化。仅站内提醒；不调用 Notification API，不请求系统推送权限。现有生成仍为单实例内存任务，服务器重启不承诺继续计算。

## 2. 接口与存储

- `GET /api/generations/current` → 当前账号正在执行的 `GenerationJobView | null`。
- `GET /api/generations/:jobId` → 优先内存任务；过期后从账号通知恢复终态。
- `GET /api/notifications?before=<sequence>&limit=20` → `NotificationPage`。
- `POST /api/notifications/:id/read` → `{ok:true}`。
- `POST /api/notifications/read-all`，body `{through:number}` → `{ok:true}`。
- `generation_notifications`：bigserial sequence、id 主键、user_id、job_id、kind、trip_id、destination、days、title、message、job_created_at、created_at、read_at；唯一键 `(user_id,job_id)`，索引 `(user_id,sequence)`。schema 与启动 migration 同步。

## 3. 数据与状态契约

共享 `notifications.ts` 导出 TypeBox schemas 与派生类型。页面响应包含 `items,hasUnread,readThrough,nextCursor`；通知包含 `id,sequence,jobId,kind,tripId,title,message,createdAt,readAt`。时间为毫秒，未读为 `readAt:null`；sequence 仅用于游标，不显示计数。limit 为 1～50，before/through 为非负安全整数。

列表、全局未读和 readThrough 在同一个 repeatable-read 只读事务中查询。全部已读只更新当前账号且 `sequence <= through` 的行；晚到消息保持未读。分页按 sequence 降序，nextCursor 取本页末项。

成功通知必须与行程、成功审计在同一事务内写入，提交后才发布 job_done。同一账号/任务去重。失败与超时在释放运行锁后尽力写错误通知，失败日志不含敏感详情；主动取消不额外通知。通知故障不得让运行锁永久占用，成功事务失败不得扣成功配额。

`GenerationProvider` 挂在登录后的 AppLayout，切页不关闭任务生命周期；`/generations/:jobId` 只恢复已有任务，不重新 POST。sessionStorage 的 `tw.activeJobId` 仅为刷新线索，重新打开网站由 current 接口发现任务。SSE 负责实时阶段，通知和 current 以 15 秒可见页面轮询及焦点恢复补查。

完成时仅当前生成页在可见状态下自动进入详情；其他页面保留位置，聚焦标签弹最近一条提醒。首次读取只建立通知序列基线，不重放历史 Toast。通知保存于账号，关闭网站仍可写入。成功打开详情后才标记该消息已读，关闭 Toast 不标记已读。

纯 Logo、首页、我的行程、按需出现的生成入口；铃铛与退出仅图标，铃铛右上角仅未读红点。桌面 details 通知面板，手机原生 Modal sheet。通知查询与写入以 userId 隔离缓存；退出清理缓存、连接与 sessionStorage。

`NavigationProvider.perform(action)` 在 navbar、通知、退出前执行编辑器 guard：拒绝未完成行程操作和路线规划，等待 `save.flush()`，保存失败留在原页面与草稿。发起任务使用实际表单构造偏好快照；成功后只保存本任务快照，不覆盖新草稿。409 接管其他任务不保存当前表单偏好；退出后迟到的启动回调须校验 mounted 与账号。

## 4. 校验与错误矩阵

| 情况 | 行为 |
| --- | --- |
| 未登录 | 401，统一会话失效流程 |
| 非本账号通知或任务 | 404，不泄露归属 |
| 非法游标、limit 越界、缺少 through | 400 |
| 无通知 / 无进行中任务 | 空 items / null，不能把网络失败视为空 |
| 通知加载失败 / 已读保存失败 | 面板展示失败，可重试 |
| 成功通知指向已删除行程 | 保持当前位置，提示行程已不可用 |
| 暂时断网 | 保留恢复线索，由重连/快照补齐 |
| 内存终态过期 | 从通知恢复完成 tripId 或错误信息 |
| 服务器重启丢失运行任务，且没有持久结果 | 不假装仍运行，提示恢复失败和重试入口 |

## 5. 正常、基线与反例

- 正常：生成杭州行程 → 查看北京详情 → 杭州完成，仅弹提醒 → 保存北京草稿后打开杭州。
- 基线：关闭网站后任务完成，下次打开显示未读点与通知，不自动跳页。
- 反例：卸载生成页即取消；收到任意 job_done 全局跳转；全部已读更新无游标边界；success 通知先于行程事务提交。

## 6. 必要验证

- `node --import tsx scripts/verify-generation-flow.mts`：事务回滚、幂等、401/404、分页、已读边界、current 归属与持久结果恢复。
- `node --import tsx apps/web/tests/navigation-notifications-browser.mjs`：图标/红点、桌面与手机、Escape 焦点、返回同一任务、后台完成不导航、重开未读、编辑保存失败、空态/重试。
- `node scripts/verify-generation-browser.mjs`：生产包 + 隔离数据库/模型 fixture，首页到生成/详情、刷新、取消、后台通知与新偏好草稿保留。
- `node apps/web/tests/generation-recovery-browser.mjs`：原生 EventSource 增量恢复与游标重置（Vite 18811）。
- `node --import tsx apps/web/tests/travel-preferences-browser.mjs`：首页偏好成功保存、失败重试、账号隔离与图标退出。
- typecheck、web build、styles gate、trip-collection-browser 回归。模拟生成验证应用链路，不代表真实模型质量或速度。

## 7. 错误与正确示例

```ts
// 错误：无论用户在看哪个页面，完成就打断当前工作。
onDone: (tripId) => navigate(`/trips/${tripId}`);

// 正确：全局只更新结果和缓存，由对应生成页决定可见时跳转。
onDone: (_tripId, jobId) => {
  persistSubmittedPreferences(jobId);
  invalidateNotifications();
};
// 全部已读使用已返回给客户端的边界，保留后续消息。
where(and(eq(userIdColumn, userId), lte(sequenceColumn, through)));
```
