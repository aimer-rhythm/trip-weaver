# Directory Structure

> How backend code is organized in this project.

---

## Overview

<!--
Document your project's backend directory structure here.

Questions to answer:
- How are modules/packages organized?
- Where does business logic live?
- Where are API endpoints defined?
- How are utilities and helpers organized?
-->

(To be filled by the team)

---

## Directory Layout

```
<!-- Replace with your actual structure -->
src/
├── ...
└── ...
```

---

## Module Organization

<!-- How should new features/modules be organized? -->

### Convention: 源码级静态资产放 `apps/server/src/data/`

**What**：随代码走、被 `import` 的静态数据（如 `reservationSeeds.json` 预约种子表）放 `apps/server/src/data/`；运行时产物（SQLite 等）放 `apps/server/data/`（gitignore）。

**Why / Gotcha**：根 `.gitignore` 的 `data/` 规则**匹配任意层级目录**，会连 `src/data/` 一起吞掉——源码资产对 git 不可见，新 clone/CI 直接 typecheck 失败（2026-07-09 trellis-check 发现的发布阻断级问题）。

**Example**：
```gitignore
# Wrong：只写宽规则，src/data 被误伤
data/

# Correct：宽规则 + 源码资产例外，并用 git check-ignore -v 验证
data/
!apps/server/src/data/
```

**Prevention**：新增任何 `src/**/data` 类源码资产目录后，必须跑 `git check-ignore -v <新文件>` 确认未被忽略。

---

## Naming Conventions

<!-- File and folder naming rules -->

(To be filled by the team)

---

## Examples

<!-- Link to well-organized modules as examples -->

(To be filled by the team)
