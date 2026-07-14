# Agent WPS Reviewer 产品化故障整改与发布门禁

日期：2026-07-14
适用仓库：`agent-wps-reviewer` 仓库根目录
执行对象：GPT-5.6 Luna 或后续开发 Agent
文档性质：故障审计、目标架构、实施顺序、测试矩阵与发布门禁
当前产品结论：**Stop Ship；只能保持 beta，不得作为真实客户可用产品发布**

---

## 0. 执行约束

后续执行 Agent 必须遵守：

1. 先读取本文、`docs/2026-07-14-production-skill-suite-refactor-execution.md`、`docs/ACCEPTANCE.md`、`docs/WPS_API_NOTES.md` 和现有代码，再修改。
2. 全程默认后台操作，不启动、重启、聚焦或自动操控 WPS。
3. 真实 WPS 验收必须等用户主动打开 WPS 并明确允许当次验收；自动化不得抢占窗口焦点。
4. 当前目录不是 Git 仓库。不得擅自执行 `git init`、推送 GitHub 或重写用户文件。
5. 不得删除当前正式 bridge、真实建议、真实批注或文档数据。
6. 清理孤儿进程前必须证明进程属于本项目测试实例；不得按进程名批量误杀其他 Node/WPS/MCP 进程。
7. 每一阶段都要有可复现的测试证据。代码写入不等于功能可用。
8. 真实 WPS 门禁未通过前，任何文档和 manifest 都不得标记 `productionReady: true`。

---

## 1. 本轮用户报告

### 1.1 UI 宽度故障

用户截图显示，WPS 右侧任务窗格在常用宽度下出现以下问题：

- 连接码后的提示被右侧裁切；
- “待处理 / 全部”分段控件只能看到一部分；
- 建议卡片的分类、标题、正文摘要和文档名超出可视区域；
- 详情内容被裁切，底部操作区在截图中不可见；
- 必须把任务窗格拖到很宽，才能看到完整内容。

这不是“用户窗格太窄”，而是任务窗格没有按 WPS 真实宿主尺寸做可靠的横向收缩与内容分层。

### 1.2 定位与批注故障

用户报告：

- 点击“定位”无法正常定位；
- 点击“接受”不能稳定创建真实批注；
- 当前新增的三条建议均无法形成可用闭环。

截至本次后台审计：

- 三条新建议仍为 `pending`；
- 三条建议均没有新的 `suggestion.located` 或 `suggestion.commented` 事件；
- 当前系统只记录成功事件，不记录失败尝试；
- 因此可以确认“没有成功证据”，但不能仅凭现有日志断言失败发生在激活、锚点搜索、Range 映射、Select 还是 Comments.Add。

### 1.3 产品化要求

目标不是做一个能演示的插件，而是做一个新手可以安装、Agent 可以稳定调用、多个打开文档不会串数据、失败可诊断、更新可回滚的真实产品。

---

## 2. 审计结论摘要

| 编号 | 严重度 | 结论 | 证据等级 |
|---|---:|---|---|
| F-01 | P0 | 动作链在执行定位/批注后才同步活动文档，顺序错误 | 已由代码证实 |
| F-02 | P0 | WPS adapter 忽略已保存的 `metadata.location`，重新搜索并重新计算偏移 | 已由代码证实 |
| F-03 | P0 | `Content.Text` 字符偏移直接映射 `Document.Range(start,end)`，对表格等结构不具备已验证的一致性 | 代码事实；真实 WPS 影响待前台验证 |
| F-04 | P0 | 三条新建议无成功事件，失败过程也完全无事件 | 已由数据证实 |
| F-05 | P0 | 自动测试已遗留 115 个随机端口 bridge 进程 | 已由进程和环境变量证实 |
| F-06 | P0 | 孤儿进程直接来源之一是测试停止 bridge 时漏传随机端口 | 已由代码和进程 `DATA_DIR` 证实 |
| F-07 | P0 | 浏览器响应式测试不能复现 WPS WebView 和真实长内容 | 已由测试夹具证实 |
| F-08 | P1 | taskpane 缺少完整的横向收缩边界，列表允许横向滚动 | 已由 CSS 证实 |
| F-09 | P1 | 运行数据已有 1861 个 session，但只有 1 个持久文档绑定 | 已由 `/health` 和 store 证实 |
| F-10 | P1 | 原始英文分类枚举直接显示给新手用户 | 已由 UI 与代码证实 |
| F-11 | P1 | 临时运行错误会把建议永久改成 `conflict` | 已由代码证实 |
| F-12 | P1 | 成功日志不足，失败日志缺失，不能完成现场诊断 | 已由代码和日志证实 |
| F-13 | P1 | 批注幂等状态主要放在 taskpane `localStorage`，多窗格、重装或清缓存后不可靠 | 已由代码结构证实 |
| F-14 | P1 | 当前测试通过不等于真实 WPS 通过 | 已由验收边界和 mock 实现证实 |

### 2.1 当前可以确定的根因

#### 根因 A：目标文档确认发生得太晚

`public/addin/app.js` 当前执行顺序：

1. 调用 `adapter.locateSuggestion()` 或 `addCommentOnce()`；
2. adapter 内部尝试激活文档并执行定位/批注；
3. 返回后才调用 `syncActiveWpsSession()`；
4. 再写成功事件。

`advanceToNextPending()` 同样先定位下一条，再同步 session。

目标文档身份应该是动作的前置条件，而不是动作执行后的补充校验。

#### 根因 B：定位数据存在两套事实源

Agent/bridge 在正式提交时已经保存：

```text
metadata.location.start
metadata.location.end
metadata.location.strategy
metadata.revisionToken
metadata.documentHandle
metadata.documentKey
```

但 WPS adapter 没有使用这组位置作为受校验的首选候选，而是：

1. 重新读取 `ActiveDocument.Content.Text`；
2. 重新查找 anchor；
3. 把字符串索引直接交给 `Document.Range(start,end)`；
4. 在正负 4 个字符内试探修正。

这会让“Agent 审阅时的位置”和“点击时的位置”成为两个相互独立的定位结果。

#### 根因 C：正文字符串坐标和 WPS Range 坐标没有正式契约

当前代码假设：

```text
Content.Text 的第 N 个字符 === Document.Range(N, N+1) 的字符
```

这个假设尚未在当前 WPS 版本的下列结构中验证：

- 表格单元格和单元格结束符；
- 段落标记与 `\r` / `\n`；
- 域、超链接和书签；
- 页眉页脚、文本框、脚注；
- 修订痕迹；
- 合并单元格。

本轮三条建议中有一条明确位于表格内容，因此该风险已经进入真实用户路径。

#### 根因 D：测试清理漏传端口，持续制造孤儿 bridge

`test/local-install.test.mjs` 为测试申请随机端口，并用该端口启动持久 bridge；但 `finally` 中调用：

```js
await stopBridge(bridgeOptions);
```

`bridgeOptions` 不包含 `port`，`stopBridge()` 因而回退到默认端口 `17531`。随机端口 bridge 没被停止，临时目录随后被删除，进程成为 PPID 1 的孤儿进程。

现场证据：

- 审计时发现 115 个 `node src/bridge/server.mjs` 孤儿监听器；
- 抽样进程的 `DATA_DIR` 指向 `wps-local-setup-test-*` 临时目录；
- 正式 bridge 是 PID 47902、端口 17531，必须与测试孤儿区分。

这说明现有测试本身会污染用户机器，属于 P0，而不是普通测试卫生问题。

### 2.2 尚不能在后台确认的事项

以下事项必须在增加失败遥测后，由用户主动进行一次真实 WPS 验收才能确认：

1. 当前 WPS build 中 `Range.Select()` 是否抛错、静默失败或选错范围；
2. 当前 WPS build 接受哪一种 `Comments.Add` 签名；
3. 表格单元格中的 `Content.Text` 和 `Range` 偏移差值；
4. WPS WebView 的实际 `innerWidth`、`visualViewport.width`、缩放比例和任务窗格可视宽度；
5. 文档激活命令是否真正切换了 WPS 活动标签页，还是只更新了 bridge 注册状态。

Luna 不得把这些未验证项写成“已定位根因”或“已修复”。

---

## 3. Stop Ship 条件

以下任意一项存在，都禁止生产发布：

1. 常用任务窗格宽度出现横向裁切或需要横向滚动；
2. 定位后的 `Range.Text` 与建议 anchor 不一致；
3. 接受后无法确认真实 WPS 批注存在；
4. 目标文档未确认时仍可执行定位或写批注；
5. 表格场景在没有正式支持声明时继续盲目定位；
6. 自动测试仍会残留进程、端口或临时数据；
7. 失败动作没有可诊断事件；
8. 自动定位下一条失败时，UI 丢失当前工作上下文；
9. 多文档情况下可能把建议写到错误文档；
10. `npm test`、浏览器 mock 或安装成功被当成真实 WPS 验收替代品；
11. 新手安装后需要理解 bridge、MCP、LaunchAgent 才能恢复；
12. release manifest 把当前版本标为 production。

---

## 4. 目标产品闭环

### 4.1 用户闭环

```text
用户打开 WPS 文档
  -> 打开 Agent 审阅
  -> taskpane 显示当前文档和连接码
  -> 用户把连接码发给 Agent
  -> Agent 读取该连接码对应的文档
  -> Agent 生成候选并由用户确认
  -> 正式建议进入该文档独立收件箱
  -> 用户点击定位
  -> 插件先确认文档，再验证原文，再选中精确范围
  -> 用户点击接受
  -> 插件在同一验证范围创建真实 WPS 批注
  -> 插件确认批注存在，再更新建议状态
  -> 自动选择并定位下一条待处理建议
  -> 没有下一条时清空详情
```

### 4.2 必须坚持的边界

- 连接码绑定持久 `documentKey`，不绑定一次性 runtime handle；
- Agent token 是权限凭证，连接码只是文档路由标识，不是安全密钥；
- 每条建议必须同时绑定 `documentKey`、当前 runtime handle 和 revision token；
- 定位成功必须以真实 `Range.Text` 校验为准；
- 批注成功必须以真实 comments 集合或可验证 comment fingerprint 为准；
- 接受不直接修改正文；
- 任何不确定都停止写入，而不是猜测位置。

---

## 5. P0 阶段：先止血，不碰 WPS 前台

## P0-1 修复测试孤儿进程

### 修改位置

- `test/local-install.test.mjs`
- `src/bridge/processControl.mjs`
- `src/install/localInstall.mjs`
- `scripts/validate-release-install.mjs`
- 新增专用进程生命周期测试

### 必须修改

1. 所有 `startBridge({ port, ... })` 必须使用同一份 resolved options 执行 `stopBridge()`。
2. 测试 `finally` 必须调用 `stopBridge({ ...bridgeOptions, port })`。
3. `startBridge()` 返回一个包含完整 resolved identity 的 handle，停止时优先使用该 handle，不再由调用者拼参数。
4. bridge PID 记录增加：
   - `pid`
   - `host`
   - `port`
   - `projectRoot`
   - `dataDir`
   - `instanceId`
   - `startedAt`
   - `ownerKind`：`product` / `test` / `acceptance`
5. 测试 bridge 不应默认 detached。只有产品常驻模式可以 detached；测试使用普通子进程并绑定父进程生命周期。
6. 测试进程收到 `SIGINT`、`SIGTERM`、uncaught exception 或 runner cancel 时，也要清理子进程。
7. 增加“测试前后本项目监听器数量不增加”的门禁。

### 当前 115 个孤儿的安全清理要求

先生成只读清单，不直接 kill。每个候选必须同时满足：

- 命令为当前仓库的 `src/bridge/server.mjs`；
- PPID 为 1；
- 监听端口不是 17531；
- `DATA_DIR` 位于系统临时目录；
- `DATA_DIR` 名称匹配本项目测试前缀；
- `/health.service === "agent-wps-reviewer"`；
- 不是 LaunchAgent 当前管理的 PID。

只有全部满足，`doctor --fix` 才能逐个终止，并输出 PID、端口和判断依据。默认 `doctor` 只能报告，不得自动杀进程。

### 验收

- 单独循环运行相关测试 20 次；
- 每轮结束后无新增监听器；
- 临时目录全部清理；
- 正式 17531 bridge 不受影响；
- MCP 进程不受影响；
- 测试被 `SIGTERM` 中断后仍无孤儿。

## P0-2 增加动作失败遥测

### 目标

在不记录全文和批注敏感内容的前提下，能判断失败停在哪一步。

### 新事件

```text
suggestion.action.started
suggestion.target.confirmed
suggestion.location.resolved
suggestion.location.failed
suggestion.comment.started
suggestion.comment.verified
suggestion.comment.failed
suggestion.action.completed
suggestion.action.failed
suggestion.auto_advance.started
suggestion.auto_advance.failed
```

### 每个事件的最小字段

```json
{
  "operationId": "uuid",
  "eventType": "suggestion.location.failed",
  "suggestionId": "...",
  "documentKeyHash": "sha256:...",
  "documentHandle": "...",
  "expectedRevisionToken": "...",
  "actualRevisionToken": "...",
  "step": "range.verify",
  "reason": "range_text_mismatch",
  "structureType": "body|table|header|footer|textbox|unknown",
  "anchorLength": 22,
  "candidateCount": 1,
  "rangeStart": 26276,
  "rangeEnd": 26298,
  "rangeCorrection": 0,
  "wpsVersion": "...",
  "buildFingerprint": "...",
  "createdAt": "..."
}
```

禁止记录：完整文档、完整前后文、完整连接码 token、用户隐私路径。需要比对时只记录 hash、长度和最多 40 字的脱敏摘要。

### 失败事件规则

- 每次点击必须有 started 和 completed/failed 成对事件；
- 失败事件也必须写入；
- 遥测写入失败不能导致文档动作重复执行；
- 事件写入与业务状态分开，不能为了日志失败而把建议标记为 conflict。

---

## 6. P0 阶段：重建定位与批注事务

## P0-3 建立统一的文档动作状态机

当前 `runAction()` 同时承担 UI 锁、定位、批注、状态 PATCH、遥测和自动下一条，职责过多。

拆分为：

```text
ReviewActionController
  prepareTarget(suggestion)
  resolveVerifiedRange(target, suggestion)
  selectRange(actionContext)
  createAndVerifyComment(actionContext)
  commitSuggestionStatus(actionContext)
  advanceToNextPending(actionContext)
```

动作状态机：

```text
idle
  -> targeting
  -> target_confirmed
  -> locating
  -> range_verified
  -> selecting
  -> located
  -> commenting
  -> comment_created
  -> comment_verified
  -> committing
  -> completed
```

任意步骤失败进入 `failed`，但失败是 operation 状态，不是建议的持久审核状态。

### 状态分类

建议持久状态：

```text
pending
commented
rejected
stale
conflict
```

动作临时错误：

```text
bridge_offline
target_not_open
target_activation_timeout
target_identity_mismatch
revision_mismatch
anchor_not_found
ambiguous_anchor
context_mismatch
unsupported_structure
range_text_mismatch
selection_failed
comments_api_unavailable
comment_unverified
telemetry_failed
```

只有以下情况才能把建议持久改为 `conflict`：

- 当前 revision 中锚点存在多个同分候选，且前后文不能唯一消歧；
- 锚点与上下文明确互相矛盾；
- 人工确认该建议不再能对应原文。

网络错误、WPS API 错误、文档未激活、插件离线都不能永久改为 conflict。

## P0-4 目标文档必须在动作前确认

### `prepareTarget()` 必须完成

1. 根据 `documentKey` 找到当前打开的 runtime handle；
2. 发出 `document.activate`；
3. 等 connector 回报该 handle 为 active；
4. adapter 再读取 `Application.ActiveDocument`；
5. 用 normalized full path 或稳定 identity 确认是同一文档；
6. 读取实际 revision token；
7. revision 不一致时停止动作并标为 stale，不允许继续猜测；
8. 返回不可变 `TargetContext`。

```ts
type TargetContext = {
  operationId: string;
  documentKey: string;
  documentHandle: string;
  fullName: string;
  revisionToken: string;
  wpsDocument: unknown;
  confirmedAt: number;
};
```

`syncActiveWpsSession()` 不再放在动作后面。它应被 `prepareTarget()` 取代或变成其内部步骤。

## P0-5 建立唯一的位置契约

正式建议位置结构升级为：

```json
{
  "version": 2,
  "offsetSpace": "wps-content-text-v1",
  "strategy": "exact-context",
  "start": 26276,
  "end": 26298,
  "anchorHash": "sha256:...",
  "beforeHash": "sha256:...",
  "afterHash": "sha256:...",
  "structureType": "body",
  "structurePath": null,
  "revisionToken": "sha256:..."
}
```

### 定位优先级

1. 使用已保存位置作为候选；
2. 获取该位置的真实 `Range.Text`；
3. 若与 anchor 完全或受控规范化后相等，直接采用；
4. 若不等，在同一结构内做有限纠偏；
5. 再使用 exact anchor + before/after 消歧；
6. 最后使用经过验证的 WPS Find/Search API；
7. 仍不唯一则停止，绝不默认第一处。

### 规范化限制

允许：

- `\r\n` 与 `\n` 的等价；
- 连续普通空白的受控等价；
- WPS 明确可证明的段落结束符差异。

不允许：

- 删除中文标点后声称匹配；
- 忽略汉字差异；
- 模糊相似度选第一处；
- 在跨表格、跨段落时自动扩大范围；
- anchor 不一致但仍执行批注。

## P0-6 表格与非正文结构必须显式分流

在真实 WPS 表格坐标契约完成前：

- body paragraph 可进入生产路径；
- table cell 只能进入实验路径或返回 `unsupported_structure`；
- header/footer/textbox/footnote 默认不支持；
- UI 必须显示“当前版本暂不支持此位置”，不能显示笼统的“定位失败”。

如果 Luna 要开放表格支持，必须先完成：

1. 当前 WPS 版本官方 API / 类型定义调研；
2. 单元格文本、结束符、合并单元格坐标实验；
3. 保存结构路径，例如 table index / row / cell / local offset；
4. 结构路径定位后再校验 `Range.Text`；
5. 至少 20 个真实表格案例通过。

不能仅把 `MAX_RANGE_CORRECTION` 从 4 改大。这会扩大误批注风险。

## P0-7 接受必须复用已验证范围

当前“定位”和“接受”分别重新执行 locator，两个动作可能得到不同 Range。

改为：

- 定位成功生成短期 `VerifiedRangeToken`；
- token 绑定 operation、suggestion、documentKey、runtime handle、revision、anchor hash、start/end；
- token TTL 建议 15 秒；
- 用户点击接受时，若文档和 revision 未变化，复用同一 Range；
- token 失效时重新走完整定位事务；
- `Comments.Add` 后必须读取 comments 集合确认 fingerprint 存在；
- 只有确认存在后才 PATCH 为 `commented`。

## P0-8 服务端幂等

不要只依赖 taskpane `localStorage`。

新增服务端 operation 记录：

```text
operationId
suggestionId
documentKey
revisionToken
actionType
state
rangeFingerprint
commentFingerprint
startedAt
completedAt
lastError
```

同一 suggestion 的 accept 重试必须：

- 先查已有 operation；
- 已验证 comment 存在则只补状态；
- comment 状态未知则要求人工刷新或重新确认；
- 不能盲目再次 `Comments.Add`。

---

## 7. P0/P1 阶段：任务窗格 UI 重构

## P0-9 横向布局硬门禁

### CSS 基线

以下容器必须统一具备 `min-width: 0` 和横向约束：

```text
html
body
.app-shell
.inbox-panel
.topbar
.title-stack
.connection-code-row
.segmented-control
.suggestion-list
.suggestion-card
.detail-sheet
.detail-card
.detail-header
.detail-content
.actions
```

必要规则：

```css
html,
body {
  width: 100%;
  max-width: 100%;
  overflow-x: hidden;
}

.app-shell,
.inbox-panel,
.suggestion-list,
.detail-sheet,
.detail-card,
.detail-content {
  min-width: 0;
  max-width: 100%;
}

.suggestion-list,
.detail-content {
  overflow-x: hidden;
  overflow-y: auto;
}
```

这只是基线，不是完整修复。Luna 必须用真实长内容测试每个子项的 intrinsic width。

### 顶部信息重排

常用窄宽度下：

- 第一行：`Agent 审阅` + 刷新图标按钮；
- 第二行：连接状态；
- 第三行：当前文档，单行省略；
- 第四行：连接码 + 复制按钮；
- 复制结果放下一行或短时 toast，不与连接码争抢同一行；
- “待处理 / 全部”必须始终完整显示。

### 建议卡片

- 卡片宽度严格为父容器可用宽度；
- 箭头固定 16-20px，不参与文本宽度竞争；
- 标题最多两行，不用无限 nowrap；
- 摘要最多两行；
- 文档名只显示短标题，不显示完整路径；
- 英文 category 映射成中文短标签；
- 不得把 `duplicate-compression`、`numbering-figure-table` 直接显示给用户。

建议映射：

```text
duplicate-compression -> 重复与压缩
numbering-figure-table -> 图表编号
structure-logic -> 结构逻辑
data-fact -> 事实核验
style-consistency -> 风格一致性
minor -> 文字优化
```

未知分类统一显示“审阅建议”，原始值只进入诊断信息。

### 详情区

- 详情头部文本容器 `min-width: 0`；
- 正文片段和批注意见正常换行；
- 操作按钮区域固定在 taskpane 底部或 sticky；
- 内容滚动时“定位 / 拒绝 / 接受”始终可见；
- 高度不足时滚动详情内容，不把按钮推到不可达位置；
- 错误提示紧邻按钮并可复制诊断编号。

## P0-10 UI 验收矩阵

浏览器必须覆盖：

```text
宽度：280 / 300 / 320 / 360 / 420 / 480 / 640 CSS px
高度：480 / 640 / 900 CSS px
deviceScaleFactor：1 / 1.25 / 1.5 / 2
```

每种组合至少包含：

- 80 个中文字符的文档名；
- 200 个字符的连接状态；
- 40 个字符的英文 category；
- 300 个字符的标题；
- 500 个字符的正文片段；
- 800 个字符的批注意见；
- 0 / 1 / 3 / 100 条建议；
- pending / conflict / stale / commented / rejected；
- 离线状态和错误状态。

断言不能只检查 `body.scrollWidth`。还必须逐元素检查：

- `getBoundingClientRect().right <= visualViewport.width`；
- 可点击元素没有超出 viewport；
- tab、复制、刷新和三个动作按钮都可见；
- 页面和列表没有横向滚动；
- 文本没有被裁成不可理解的半行；
- sticky 操作区不遮挡正文。

真实 WPS 验收时额外记录：

```text
window.innerWidth
document.documentElement.clientWidth
window.visualViewport?.width
window.devicePixelRatio
taskpane buildFingerprint
```

这些信息只写诊断事件，不在普通 UI 常驻显示。

---

## 8. P1 阶段：自动定位下一条的正确语义

接受或拒绝后：

1. 当前建议状态提交成功；
2. 计算下一条待处理建议；
3. 先在 UI 选中下一条并显示“正在定位”；
4. 走完整 `prepareTarget -> resolveVerifiedRange -> selectRange`；
5. 成功后写 `suggestion.located`；
6. 失败时保留下一条详情和重试按钮，不回退上一条、不清空详情；
7. 没有下一条时清空详情并显示“全部处理完成”；
8. 自动定位失败不能撤销刚才已经成功的接受/拒绝；
9. 自动定位失败不能把下一条直接改成 conflict；
10. 用户快速连续点击时只允许一个 action operation 在运行。

需要增加测试：

- 接受后自动定位下一条成功；
- 拒绝后自动定位下一条成功；
- 下一条属于同文档；
- 下一条 runtime handle 已变化但 documentKey 相同；
- 下一条文档已关闭；
- 下一条 revision 已变化；
- 自动定位失败后手动重试成功；
- 最后一条处理完后详情清空；
- 自动定位也写成功或失败事件。

---

## 9. P1 阶段：数据与运行时治理

## P1-1 session 膨胀

当前 `/health`：

```text
sessions: 1861
suggestions: 8
documentBindings: 1
```

这不是正常的比例。必须检查：

- connector 是否在每次加载/心跳生成新 handle；
- `registerSession()` 是否对同一 runtime handle 重复追加；
- WPS taskpane 和 document connector 是否各自创建 session；
- 历史 runtime handle 是否应该折叠到同一 documentKey；
- session 是否有 TTL 和上限。

### 短期整改

- 同一 `docSessionId` 使用 upsert；
- 关闭或超时的 runtime session 设置 `closedAt`；
- 默认只保留最近 30 天或最近 500 个 runtime session；
- acceptance event 按数量和时间双重保留；
- 提供只读统计和显式 compaction；
- compaction 前自动备份，使用原子替换。

### 存储决策

不要在本轮未经评估直接改成 SQLite。先比较：

- Node >=20 的兼容性；
- 是否引入原生依赖；
- 发布包体积；
- schema migration 和备份恢复；
- 多进程并发写入；
- Windows/macOS WPS 兼容计划。

若继续 JSON，必须具备原子写、写锁、schema version、迁移、备份、损坏恢复和上限。若迁移 SQLite，必须提供旧 JSON 一次性迁移与回滚。

## P1-2 连接码生命周期

连接码不是 secret，但仍需：

- 对应唯一 documentKey；
- 用户可复制；
- 文档另存为后提示是否沿用或生成新码；
- 可手动轮换；
- 删除绑定需二次确认；
- Agent 根据连接码连接时返回文档短标题和状态供用户核对；
- 不在日志中输出 agent token；
- 不允许连接码绕过 agent token 调用受保护 API。

## P1-3 诊断中心

为新手提供“复制诊断信息”，内容包括：

- 产品版本和 build fingerprint；
- bridge 在线状态；
- WPS 版本；
- 当前文档是否确认；
- 连接码后四位或 hash；
- 当前 suggestion id；
- operation id；
- 最近失败 step/reason；
- taskpane viewport；
- 是否支持当前结构类型。

不得包含全文、完整路径、agent token 或完整批注意见。

---

## 10. 测试体系重建

## 10.1 单元测试

必须覆盖：

- anchor exact / normalized / duplicate / context mismatch；
- saved location 验证；
- revision mismatch；
- typed error mapping；
- status 不被临时错误污染；
- action state machine；
- service-side idempotency；
- category 中文映射；
- session upsert / TTL / compaction；
- bridge process handle 和 cleanup。

## 10.2 WPS adapter 合同测试

不要只 mock 一个平坦字符串。建立 WPS host shim：

- body paragraph；
- CR/LF 差异；
- duplicate text；
- table cell marker；
- Range.Text 与 Content.Text 偏移不一致；
- Comments.Add 各种签名；
- Count 可读和不可读；
- Activate 延迟、失败和错误文档；
- Select 静默失败；
- 批注创建后无法立即读取；
- revision 在动作中变化。

合同测试必须验证“失败时不写批注”和“写批注前 Range.Text 一致”。

## 10.3 浏览器产品测试

使用与真实 taskpane 相同的长数据，不得使用只有十几个字的 fixture 充当响应式证明。

必须覆盖：

- 所有 UI 宽高矩阵；
- 离线重连；
- 连接码复制；
- 100 条建议列表性能；
- 详情滚动与 sticky actions；
- 失败提示；
- 接受/拒绝/撤销；
- 自动下一条；
- 无下一条清空；
- 多文档隔离。

## 10.4 真实 WPS 验收矩阵

真实 WPS 验收只能在用户允许的前台窗口进行。

文档样本：

1. 纯正文短文档；
2. 67 页真实白皮书；
3. 包含重复句的文档；
4. 包含表格和合并单元格的文档；
5. 包含已有批注的文档；
6. 包含修订痕迹的文档；
7. 同名但不同路径的两个文档；
8. 多文档同时打开。

动作矩阵：

- 手动定位；
- 接受并生成真实批注；
- 拒绝；
- 撤销拒绝；
- 接受后自动定位下一条；
- 拒绝后自动定位下一条；
- 文档切换后自定位；
- 文档关闭后的可理解错误；
- 文档修改后的 stale；
- 重复 anchor 停止猜测；
- 表格支持或明确阻断；
- taskpane 常用窄宽度。

每条通过必须保存：

- build fingerprint；
- WPS version；
- suggestion id；
- operation events；
- 目标 Range.Text hash；
- comment fingerprint；
- 正文未改变的证据；
- 用户可见截图或录屏。

浏览器 mock 不能替代以上任何一项。

## 10.5 进程与安装测试

- 干净用户目录安装；
- 重复安装幂等；
- 升级；
- 回滚；
- 卸载不删除其他 Skill；
- WPS 未安装；
- Node 版本不支持；
- 17531 被占用；
- LaunchAgent 未加载；
- Agent token 丢失；
- 测试中断后无孤儿；
- 安装失败后配置和进程全部回滚。

---

## 11. Luna 实施顺序

不得并行大改所有模块。按以下阶段，每阶段独立验证后再继续。

### Phase 0：建立基线

1. 记录当前文件清单和 build fingerprint；
2. 备份 `data/review-store.json`；
3. 只读记录正式 bridge PID/port；
4. 只读输出孤儿 bridge 清单；
5. 不运行会继续泄漏进程的完整测试；
6. 为本轮建立变更日志。

退出条件：基线可恢复，正式 bridge 与 WPS 未被操作。

### Phase 1：进程止血与失败遥测

1. 修复随机端口 cleanup；
2. 测试 bridge 改为非 detached；
3. 增加 action failed 事件；
4. 增加安全孤儿诊断；
5. 运行进程循环测试。

退出条件：20 次测试无新增进程；真实失败可以定位到 step/reason。

### Phase 2：UI 横向重构

1. 修复所有 flex/grid min-width；
2. 列表只允许纵向滚动；
3. 重排连接码；
4. 中文化 category；
5. sticky 操作区；
6. 建立长内容矩阵。

退出条件：全部浏览器宽高矩阵通过，截图人工检查通过。

### Phase 3：定位事务重构

1. 引入 `ReviewActionController`；
2. 激活与身份确认前置；
3. 定义 location v2；
4. saved location 首选且校验；
5. Range.Text 强校验；
6. 结构类型分流；
7. 临时错误与建议状态分离。

退出条件：host shim 全部通过；不支持结构会明确停止。

### Phase 4：批注事务与自动下一条

1. VerifiedRangeToken；
2. 服务端 operation 幂等；
3. Comments.Add 后验证；
4. 状态 commit；
5. 自动下一条完整事务；
6. 自动下一条失败恢复。

退出条件：重复点击不产生重复批注；所有分支有事件。

### Phase 5：数据生命周期与诊断

1. session handle 稳定性；
2. session upsert/TTL；
3. compaction 与备份；
4. 连接码轮换；
5. 诊断复制。

退出条件：长时间运行不会无限增长；诊断不泄露正文或 token。

### Phase 6：真实 WPS 验收

1. 等用户主动允许；
2. 先用专用验收副本，不碰原稿；
3. 依次验正文、重复、表格、多文档、自动下一条；
4. 保存证据；
5. 失败后回到对应 Phase，不在现场临时猜补丁。

退出条件：真实矩阵通过，无正文误改，无错误文档写入。

### Phase 7：发布候选

1. 完整测试；
2. 干净机/干净 HOME 安装；
3. release zip 可复现；
4. doctor 输出新手可执行建议；
5. 文档与实际工具一致；
6. 仍保留 beta，直到独立新手验收完成。

---

## 12. 建议的文件边界

避免继续把所有逻辑堆到 `app.js` 和 `wps-adapter.js`。

```text
public/addin/
  app.js                       # UI 绑定和渲染，不承担动作事务
  action-controller.js         # 动作状态机
  target-controller.js         # 文档激活和身份确认
  location-contract.js         # location v2 与校验
  wps-range-resolver.js         # WPS Range 解析
  wps-comment-writer.js         # 批注创建与验证
  wps-adapter.js                # 薄适配入口
  category-labels.js            # 用户可见中文映射
  diagnostics.js                # 脱敏诊断
  styles.css

src/bridge/
  actionOperations.mjs          # 服务端幂等 operation
  actionTelemetry.mjs           # 成功/失败事件
  processControl.mjs
  sessionLifecycle.mjs
  store.mjs

test/
  action-controller.test.mjs
  target-controller.test.mjs
  wps-range-resolver.test.mjs
  wps-comment-writer.test.mjs
  process-leak.test.mjs
  taskpane-responsive.test.mjs
  taskpane-long-content.test.mjs
```

只有在拆分确实降低复杂度时才新增文件；不能机械搬运后留下双重实现。

---

## 13. 代码级待办清单

### `public/addin/app.js`

- [ ] `runAction()` 动作前调用 target preparation；
- [ ] 删除动作后的 session 同步依赖；
- [ ] 非定位型错误不再 PATCH 为 conflict；
- [ ] 成功和失败都产生 operation event；
- [ ] 自动下一条复用统一 controller；
- [ ] 自动下一条失败保留详情和重试；
- [ ] UI 锁按 operationId 管理；
- [ ] raw category 不直接渲染。

### `public/addin/wps-adapter.js`

- [ ] 使用 location v2；
- [ ] saved offset 先验证再搜索；
- [ ] 激活、定位、选择、批注拆分；
- [ ] Range.Text 不匹配时停止；
- [ ] 明确结构类型；
- [ ] 表格未验收前返回 unsupported；
- [ ] Comments.Add 后确认真实存在；
- [ ] 返回 typed error，不返回随意字符串；
- [ ] 删除不可审计的盲目多签名成功判断。

### `public/addin/styles.css`

- [ ] 全链路 `min-width: 0`；
- [ ] 页面 `overflow-x: hidden`；
- [ ] 列表/详情只纵向滚动；
- [ ] 顶部信息窄宽重排；
- [ ] 卡片标题与摘要多行限制；
- [ ] sticky actions；
- [ ] 280px 起完整可用；
- [ ] 长中文、英文枚举、路径和状态均不撑宽。

### `scripts/validate-responsive-ui.mjs`

- [ ] 加入真实长内容；
- [ ] 加入 280/300 和低高度；
- [ ] 检查 visual viewport 和每个交互元素；
- [ ] 加入 deviceScaleFactor；
- [ ] 截图不只 fullPage，也截 viewport；
- [ ] 模拟 WPS 宿主布局约束；
- [ ] 报告具体溢出元素和 bounding box。

### `test/local-install.test.mjs`

- [ ] `stopBridge({ ...bridgeOptions, port })`；
- [ ] 启动后保存 returned handle；
- [ ] finally 无条件停止正确实例；
- [ ] 目录删除前确认进程退出；
- [ ] 测试结束断言监听器不存在。

### `src/bridge/processControl.mjs`

- [ ] 返回完整实例 handle；
- [ ] PID 文件增加实例身份；
- [ ] 测试模式不 detached；
- [ ] 停止时校验 pid + port + instanceId；
- [ ] 关闭 log fd；
- [ ] 启动失败时清 PID 和子进程；
- [ ] 提供安全孤儿审计，不误杀未知进程。

### `src/bridge/store.mjs`

- [ ] schema version；
- [ ] operation 记录；
- [ ] session upsert；
- [ ] retention；
- [ ] atomic compaction；
- [ ] migration 与回滚；
- [ ] 并发写测试。

---

## 14. 完成定义

只有同时满足以下条件，才可以说“产品化整改完成”：

### 功能

- [ ] 常用窄任务窗格无需拖宽即可完成全流程；
- [ ] 每次定位都选中与 anchor 一致的真实 Range；
- [ ] 接受后只生成一条真实 WPS 批注；
- [ ] 正文没有被修改；
- [ ] 接受/拒绝后自动定位下一条；
- [ ] 没有下一条时清空详情；
- [ ] 多文档不会串建议或写错文档；
- [ ] 不支持结构明确阻断。

### 稳定性

- [ ] 测试、安装、升级、失败回滚均无孤儿进程；
- [ ] 连续运行 8 小时无 session 异常膨胀；
- [ ] bridge 重启后连接码和文档绑定仍正确；
- [ ] taskpane 重载不产生重复批注；
- [ ] 网络/bridge/WPS 短暂失败可恢复。

### 可诊断性

- [ ] 每次动作有 started 和 completed/failed；
- [ ] 失败能定位到 step/reason；
- [ ] 用户可复制脱敏诊断；
- [ ] 日志不包含全文和 token；
- [ ] build 和 WPS version 可追踪。

### 验收

- [ ] 单元测试通过；
- [ ] WPS host shim 通过；
- [ ] 响应式矩阵通过；
- [ ] 进程泄漏门禁通过；
- [ ] 干净安装通过；
- [ ] 用户允许下的真实 WPS 矩阵通过；
- [ ] 新手无开发者协助完成安装和首条批注；
- [ ] release audit 不复用旧 build 证据。

任何一项未满足，都只能报告“部分完成”并列出阻塞项。

---

## 15. Luna 开工提示词

可把下面内容直接交给 Luna：

> 在仓库根目录中，严格按照 `docs/2026-07-14-agent-wps-reviewer-productization-remediation-plan.md` 执行。先完成 Phase 0 基线和 Phase 1 进程止血/失败遥测，不要直接跳到 UI 补丁。默认全程后台操作，不启动、重启、聚焦或操控 WPS；真实 WPS 验收等用户主动允许。未经维护者明确授权，不要初始化新远端或推送。每个阶段先写测试，再改最小范围代码，再运行对应门禁并给出文件、行号和测试输出。不得把浏览器 mock、安装成功或自动测试通过当作真实 WPS 通过。发现文档与代码冲突时以可验证的本地运行事实为准，并回写本文的“实际实施记录”。

---

## 16. 本次审计证据索引

### 代码证据

- `public/addin/app.js:702-729`：自动下一条先定位、后同步 session；
- `public/addin/app.js:754-807`：通用动作先执行 adapter、后同步 session；
- `public/addin/app.js:774-782`：非成功结果会把建议改成 conflict；
- `public/addin/wps-adapter.js:159-197`：adapter 重新搜索 anchor；
- `public/addin/wps-adapter.js:209-258`：Content.Text 偏移映射 Range 并做正负 4 字纠偏；
- `public/addin/wps-adapter.js:405-429`：adapter 内部独立激活目标文档；
- `public/addin/wps-adapter.js:495-520`：定位和批注分别重新解析位置；
- `public/addin/styles.css:27-33`：页面没有完整横向约束；
- `public/addin/styles.css:238-245`：建议列表使用双轴 `overflow: auto`；
- `public/addin/styles.css:311-374`：详情容器缺少完整 min-width/max-width 约束；
- `public/addin/app.js:75-76,581-583`：raw category 直接显示；
- `scripts/validate-responsive-ui.mjs:35-42`：响应式 fixture 内容过短；
- `scripts/validate-responsive-ui.mjs:47-66`：只测 320/360/420/480 和 body overflow；
- `scripts/validate-responsive-ui.mjs:91-126`：交互使用 browser mock；
- `test/local-install.test.mjs:60-99`：随机端口启动，但 finally 停止时漏传 port；
- `src/bridge/processControl.mjs:138-190`：bridge 以 detached 子进程启动；
- `src/bridge/processControl.mjs:194-208`：停止参数端口不符时不会终止进程。

### 运行证据

审计时：

```text
正式 bridge: PID 47902, 127.0.0.1:17531
health.productVersion: 0.2.0
health.buildFingerprint: 7f68d20a7242ced31485c6f8a93a0591
health.sessions: 1861
health.suggestions: 8
documentBindings: 1
新三条建议: pending 3
新三条成功 acceptance events: 0
PPID 1 的 bridge/server 进程: 115
```

抽样孤儿进程的 `DATA_DIR` 指向：

```text
/var/folders/.../T/wps-local-setup-test-*/data
```

### 验收边界

本次没有启动、重启、聚焦或自动操控 WPS；没有执行真实定位和真实批注动作。本文对真实 WPS API 的最终判断仍需用户允许后的前台验收证据。

---

## 17. 实际实施记录（2026-07-14）

本轮已按本文的后台安全边界执行代码整改和可重复验证；以下是已落地内容，不等同于真实 WPS 前台验收通过。

### 已完成

- **进程生命周期止血**：测试桥接实例显式携带随机端口、`ownerKind=test`、非 detached 模式；PID 文件记录实例身份；启动失败清理子进程和 PID 文件；新增 `scripts/cleanup-orphan-bridges.mjs`，只审计并清理当前项目、测试临时数据目录、非正式端口且健康身份匹配的孤儿实例。
- **孤儿进程清理**：清理前扫描到 115 个 bridge 进程，其中 114 个满足安全清理条件；清理结果为 114 成功、0 失败；清理后仅保留正式 bridge，正式 bridge 的 `127.0.0.1:17531/health` 仍健康。
- **动作可诊断性**：`app.js` 已为动作、目标确认、定位、批注、自动下一条写入 started/completed/failed 事件；事件携带 operationId、step、reason、错误码、候选数、范围修正和脱敏文档键摘要；遥测失败不会阻断用户动作。
- **动作前目标确认**：接受、拒绝、自动下一条均先执行目标文档准备和 session 同步，再执行定位/批注动作；移除动作后的盲目 session 同步依赖。
- **定位优先复用已保存位置**：`wps-adapter.js` 优先验证 suggestion location v2，只有保存位置无法通过当前文本校验时才回退到 anchor 搜索；歧义结果返回候选数量。
- **批注与错误语义**：瞬时运行时错误不再一律把建议改成 conflict；只有 `ambiguous_anchor` 和 `context_mismatch` 进入冲突状态；用户界面增加目标未打开、目标不匹配、范围文本不一致、结构不支持、批注 API 不可用等明确提示。
- **任务窗格窄宽约束**：页面、列表、详情、卡片、操作区补齐横向 containment 和 `min-width: 0`；列表只纵向滚动；连接信息在窄宽下换行；操作区固定在详情底部；长中文和英文类别不再撑破容器。
- **响应式门禁**：覆盖 280/300/320/360/420/480/640 宽度、480/640/900 高度、deviceScaleFactor 1.5，并检查 body/document 与交互元素 bounding box。
- **发布包隔离**：内部整改文档因含本机证据路径，不进入面向 GitHub 用户的 release ZIP；孤儿审计脚本作为维护工具保留在发布包中。

### 已验证

```text
node --test test/locator.test.mjs test/wps-api-compat.test.mjs test/taskpane-ui.test.mjs
36/36 passed

node --test test/process-control.test.mjs test/local-install.test.mjs
9/9 passed

node --test test/api.test.mjs test/store.test.mjs test/wps-api-compat.test.mjs test/taskpane-ui.test.mjs
48/48 passed

node scripts/validate-responsive-ui.mjs
ok=true; 22 个尺寸布局及交互检查通过
```

### 尚未完成、不得提前宣称通过

- `npm test` 已在发布包隔离修复后重新执行并通过 260/260；这仍然不替代真实 WPS 验收；
- 尚未执行真实 WPS 的前台定位、接受写入、拒绝、自动下一条、多文档隔离和批注持久化矩阵；
- 尚未取得新手干净机器无开发者协助安装证据；
- 尚未达到 8 小时连续运行和真实 WPS 重启恢复证据。

因此当前状态应报告为：**后台代码整改已执行并通过局部门禁，产品仍处于 beta，真实 WPS 验收待用户主动允许后完成**。
