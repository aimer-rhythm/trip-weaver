# Error Handling

> How errors are handled in this project.

---

## Overview

<!--
Document your project's error handling conventions here.

Questions to answer:
- What error types do you define?
- How are errors propagated?
- How are errors logged?
- How are errors returned to clients?
-->

(To be filled by the team)

---

## Error Types

<!-- Custom error classes/types -->

(To be filled by the team)

---

## Error Handling Patterns

### Scenario: 外部数据源适配器（计量 API：高德 POI / Web 搜索）

#### 1. Scope / Trigger
- 接入任何**计量型外部 API**（有免费配额或按次计费，如高德 5,000 次/月、LangSearch/博查按次）时，必须套用本合同。参考实现：`apps/server/src/integrations/amap/poiSource.ts`、`integrations/websearch/searchSource.ts`（源自已移除的 XHS ContentSource 骨架，2026-07-09）。

#### 2. Signatures
```ts
interface XxxSource {
  readonly kind: 'xxx' | 'null';
  searchYyy(...): Promise<Item[]>;        // 失败一律回空数组
  selfCheck(): Promise<SourceStatus>;      // integrations/sourceStatus.ts 共用形状
}
// Null 降级实现 + createTaskXxxSource(inner) 任务级包装（上限计数 + stats.gotResults）
```

#### 3. Contracts
- env：`XXX_KEY` 缺失 → 单例返回 Null 源（服务照常启动）；`XXX_DAILY_BUDGET` 全站日额度
- 日额度核算：`quotaService` 聚合 `generations` 表用量列（真实外呼才计数，缓存命中不计）+ 60s 结果缓存
- 适配器内建：TTL 缓存（24h，目的地重合场景）+ 任务级调用上限（防单任务跑飞）

#### 4. Validation & Error Matrix
| 条件 | 行为 |
|---|---|
| 网络/解析失败 | 返回空数组或 null，**绝不抛错到流水线** |
| Key 未配置 | Null 源；`phase_start` note 说明降级 |
| 全站日额度不足一个任务预留量 | 整任务注入 Null 源（不断服） |
| 任务级上限用尽 | 返回空结果，Agent 靠工具文本提示自愈 |

#### 5. Good/Base/Bad Cases
- Good：双源可用，候选池齐全，`meta.dataSources=['amap','websearch']`
- Base：全部 Key 缺失 → 纯模型知识调研，生成成功，`dataSources=[]`
- Bad（禁止）：数据源异常抛错导致 `job_error`；额度用尽后继续外呼

#### 6. Tests Required
- `scripts/verify-c2.mjs`：断言降级路径生成成功、Null 源不烧额度（amap=0/search=0）、candidate 事件流
- `scripts/smoke-sources.mjs`：未配 Key 明确提示并 `exit 0`

#### 7. Wrong vs Correct
```ts
// Wrong：状态自检端点直连真实外呼 —— 登录用户可刷接口耗尽全站计量配额
app.get('/sources-status', () => source.selfCheck());
// Correct：服务端 60s 记忆化护栏（quotaService 同款模式）
const cached = memoize60s(() => source.selfCheck());
```

---

## API Error Responses

<!-- Standard error response format -->

(To be filled by the team)

---

## Common Mistakes

### Common Mistake: 状态探测端点烧计量配额

**Symptom**：设置页反复展开数据源状态，站点当月 API 免费额度被耗尽。
**Cause**：自检从「零成本自托管服务探活」换成「计量 API 真实外呼」时，风险性质改变但护栏没跟上。
**Fix / Prevention**：凡 selfCheck 会产生真实计量外呼的，路由层必须加服务端记忆化（60s 起步），见上方 Wrong vs Correct。（2026-07-09 trellis-check 发现于 `routes/settings.ts`）
