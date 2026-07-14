# Agent WPS Reviewer 设计

## 产品边界

Agent 负责发现和复核问题，WPS 插件负责展示、定位和生成真实批注。系统不静默修改正文，也不以批注数量作为质量指标。

正式审稿必须同时满足：

- 符合训练后的白皮书编委风格；
- 服务明确的修改目的；
- 能证明问题存在并给出直接动作；
- 降低审稿人的定位、判断和核对成本；
- 与 2022-2024 同系列白皮书保持内容风格连续性；
- 经过用户候选选择和最终文本确认。

## 正式数据流

```text
Agent 读取 whitepaper-chief-editor 调度 Skill
  -> 路由到 whitepaper-chief-editor 内置的 whitepaper-wps-reviewer 执行器 bundle
  -> list_wps_documents（按标题/路径选择目标文章）
  -> read_wps_document(documentHandle, 一次一个小节)
  -> 3-7 条候选意见
  -> 用户选择
  -> 重读上下文、证据和反证
  -> 最终批注预览
  -> submit_wps_suggestions
  -> Bridge 对目标 documentHandle 的当前 revision 做契约与正文定位校验
  -> ReviewStore 原子写入
  -> WPS 侧栏展示
  -> 侧栏按 documentHandle 激活目标文章
  -> 用户点击定位 / 接受 / 拒绝
  -> 接受后 Comments.Add 生成真实 WPS 批注
```

正文不被替换。拒绝仅改变队列状态，可立即撤销拒绝。接受或拒绝成功后，侧边栏自动选中并定位列表中的下一条待处理建议；没有下一条时清空详情。

## 质量门

一批只对应一个小节，最多 8 条。每条正式意见包含：

- 用户已选择的 `candidateId`；
- 精确 `anchorText` 和至少一侧相邻上下文；
- 自然、具体、可执行的最终 `comment`；
- 问题、影响、动作和修改目的；
- 正文关键术语、证据编号或历史风格规则；
- 全文检查、反证检查和文档证据摘录。

Bridge 会重新读取当前 WPS 文档。版本变化、锚点不存在、重复锚点无法消歧、上下文不相邻、证据摘录不在正文或任一意见不合格时，整批拒绝，不产生半批数据。

## 修改目的

- `chapter-focus`
- `evidence-accuracy`
- `structure-logic`
- `compression`
- `anti-ai-tone`
- `historical-style`
- `human-boundary`

仓库源码中的执行器定义见 `skills/whitepaper-wps-reviewer/references/review-purpose.md`；安装后它位于调度 Skill 的 `references/executors/whitepaper-wps-reviewer/`，不作为用户可直接调用的同级 Skill 暴露。

## MCP 边界

正式工具：

- `list_wps_documents`
- `get_active_wps_document`
- `read_wps_document`
- `submit_wps_suggestions`
- `list_wps_suggestions`

`submit_wps_suggestion` 与 `POST /api/suggestions` 仅用于显式开启的开发兼容测试，默认关闭，写入记录标记为未验证。

## WPS 适配

真实 WPS 模式使用：

- `wps.WpsApplication()`
- `ActiveDocument`
- `ActiveDocument.Range(start, end)`
- `Range.Select()`
- `ActiveDocument.Comments.Add(...)`
- `POST /api/acceptance/events`

适配层会比较批注数量，防止 JSAPI 返回成功但没有真实生成批注。真实验收必须记录同一文档会话的 `taskpane.opened`、`suggestion.located` 和 `suggestion.commented`；浏览器 mock 事件不能通过。

## 安全与安装

- Bridge 默认只监听 `127.0.0.1`。
- 插件不保存 AI API Key。
- 安装脚本复制内置 Skill，并写入 WPS 用户级插件配置；覆盖前备份。
- 安装和后台验证不启动 WPS。
- 真实 WPS 验收只在用户允许的前台窗口进行。
