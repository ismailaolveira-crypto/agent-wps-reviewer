---
name: whitepaper-chief-editor
description: Use as the only user-facing entry point for Chinese white-paper review. Route requests to the published WPS comment workflow, apply the selected editorial profile, and refuse unsupported Word redline or PDF replica execution.
---

# 白皮书审稿调度

这是用户和 Agent 面对的唯一白皮书审稿入口。它负责判断任务、选择 Profile、检查已发布能力和调度专项执行 Skill；它不直接操作 WPS API，也不直接修改 DOCX 或 PDF。

## 先读能力清单

先读取本目录的 `references/capability-manifest.json`。不要根据记忆或用户措辞猜测能力是否可用。

当前生产能力只有：

- `wps-comment`：读取内部执行器 bundle `whitepaper-wps-reviewer`，在已打开的 WPS 文档中生成经过人工确认的真实批注。该执行器不是用户入口，不应单独调用。

当前不可自动执行：

- `docx-redline`：Word 修订和离线 DOCX 写入仍是实验能力；
- `pdf-replica`：PDF 高还原复刻仍是实验能力。

## 路由规则

### WPS 批注

用户说“审查文章”“找问题并批注”“给 WPS 批注”“定位原文”等，默认进入 `wps-comment`：

1. 读取内部执行器 `whitepaper-wps-reviewer`：仓库运行时读取 `skills/whitepaper-wps-reviewer/SKILL.md`，安装后读取本目录下的 `references/executors/whitepaper-wps-reviewer/SKILL.md`；
2. 如果用户提供了侧栏复制的 `WPS-XXXX-XXXX` 连接码，先按连接码匹配目标文章；没有连接码时再列出打开的 WPS 文档；
3. 按连接码、标题或完整路径确认目标，不把活动文档当成唯一目标；
4. 一次只处理一个小节；
5. 生成 3-7 条候选意见，最多 8 条；
6. 等用户选择并重读上下文做反证检查；
7. 展示最终批注文本；
8. 只调用 `submit_wps_suggestions` 投递侧栏；
9. 明确说明：用户在 WPS 点击“接受”后才会创建真实批注。

### Word 修订

用户要求“修改正文”“生成修订稿”“红线稿”时，不能调用旧 DOCX 写入脚本。明确说明 `docx-redline` 当前未发布，可以继续做：

- 问题分析；
- 修订清单；
- 逐条修改建议；
- 等待未来能力发布。

未经用户明确授权，不覆盖原文件，不把实验脚本产物称为正式修订稿。

### PDF 复刻

用户要求“复刻 PDF”“完全仿照历史报告”时，不能承诺成品级复刻。可以做母本结构分析、页面类型清单和实验计划，但必须标记为未发布能力。

### 意图不清

如果用户只说“处理一下”“改好”“写进去”，先区分：

- 只要聊天中的审稿意见；
- 投递到 WPS 侧栏；
- 用户接受后生成真实 WPS 批注；
- 生成离线修订文件。

不要把“同意”或“写入”自动解释成修改文件。

## 统一状态

对外只使用以下术语：

```text
候选意见 -> 用户选择 -> 最终批注预览 -> 投递 WPS -> 定位 -> 接受并生成真实批注
```

“投递 WPS”不等于“已经生成批注”。真实批注状态必须来自 WPS adapter 的成功结果。

## Profile 选择

- 在仓库中运行时使用 `profiles/generic-whitepaper`；安装后使用本目录的 `references/profiles/generic-whitepaper`；
- 指定网络安全人才报告时，读取对应的 `network-security-talent-2022-2024` Profile；
- `ai-security-talent-report-2026` 只能作为当前项目包，不得作为所有文章的默认规则；
- Profile 提供领域证据和风格基线，不得改变执行器或绕过用户确认。

## 禁止行为

- 不静默安装 WPS 配置、MCP 配置或后台服务；
- 不在 WPS 未在线时声称已经创建批注；
- 不直接调用 `submit_wps_suggestion` 兼容入口；
- 不把 PDF 或 Word 修订实验能力当作生产能力；
- 不把个人措辞偏好伪装成历史白皮书风格；
- 不把无法唯一定位的建议提交到 WPS。
