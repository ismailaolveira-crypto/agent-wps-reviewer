# 白皮书审稿 Skill 集与 WPS 产品生产化改造执行文档

日期：2026-07-14
适用仓库：`agent-wps-reviewer`
文档性质：架构决策、问题清单、实施步骤与验收门禁
执行对象：后续开发 Agent（包括 GPT-5.6 Luna）
当前结论：先收敛架构，再将 WPS 批注闭环生产化；Word 修订和 PDF 复刻暂不发布

---

## 1. 文档目的

本文件用于指导后续 Agent 将当前内部原型改造成可从 GitHub 获取、可在新机器安装、可被不同 Agent 稳定调用的生产级白皮书审稿产品。

本次改造不是继续增加批注数量、修辞规则或界面功能，而是解决以下根本问题：

1. 本机总编 Skill、仓库内置 Skill、WPS 插件分别演进，没有唯一事实源。
2. “写入”同时可能表示提交侧栏、创建真实批注、离线修改 DOCX 或生成修订稿。
3. GitHub 用户安装到的能力小于本机当前使用的能力。
4. WPS 批注模式相对成熟，但 Word 修订和 PDF 复刻尚不足以对外承诺。
5. 安装、常驻、诊断和真实 WPS 验收对新手仍过于复杂。
6. 部分测试依赖开发者机器上的真实状态，不能作为稳定发布证据。

本文件必须作为执行基线。后续 Agent 不得一边改架构一边擅自扩大产品范围。

---

## 2. 已确认的产品决策

### 2.1 采用 Skill 集，但只暴露一个用户入口

采用“调度 Skill + 专项执行能力 + Profile”的内部结构。

用户和普通 Agent 只需要认识：

```text
whitepaper-chief-editor
```

它负责：

- 理解用户意图；
- 判断目标文档和审稿范围；
- 选择项目 Profile；
- 检查目标能力是否已发布；
- 调度专项执行 Skill；
- 统一人工确认、审计和失败提示。

当前唯一进入生产发布的专项执行能力是（源码仍保留独立目录，安装后作为内部 bundle）：

```text
whitepaper-wps-reviewer
```

它只负责 WPS 小节级审稿、候选意见、反证检查、提交侧栏和真实批注闭环。

### 2.2 Word 修订和 PDF 复刻暂不作为可用能力发布

以下能力状态必须明确标记为 `disabled` 或 `experimental`：

- 离线 DOCX 修订和 tracked changes；
- 离线 DOCX 精确批注；
- 高还原 PDF 复刻；
- Word 到 PDF 的成品级排版复刻。

调度 Skill 遇到这些请求时，不得假装已经支持，也不得自动降级成可能损坏文件的脚本操作。它应明确说明：

1. 当前能力未进入生产发布；
2. 可以做分析、生成修改清单或实验性产物；
3. 未经明确确认，不修改原文件；
4. 实验输出不能标记为正式交付物。

### 2.3 用户不单独安装“插件”，但产品安装必须获得明确授权

用户侧只提供一个产品动作：

```text
安装白皮书审稿助手
```

这个动作内部完成：

- 安装调度 Skill；
- 安装 WPS 批注执行 Skill；
- 安装本机 bridge；
- 写入 WPS 加载项配置；
- 配置 Agent MCP；
- 配置后台启动方式；
- 运行健康检查。

公开快速入门中不要求新手分别执行“安装 Skill”“安装插件”“启动 bridge”“配置 LaunchAgent”。这些概念只放在高级维护文档中。

但不得让 Skill 在用户不知情时静默修改 WPS 配置、Agent 配置或后台服务。一次明确的产品安装操作就是授权边界。

### 2.4 首个生产版本只承诺 WPS 批注模式

首个生产版本的对外承诺固定为：

> Agent 可以识别用户指定的已打开 WPS 文档，按小节生成经过人工选择和反证检查的审稿意见，精确定位原文，并在用户点击接受后创建真实 WPS 批注；不直接替换正文。

任何 README、Skill description、示例、界面或发布说明不得超出该承诺。

---

## 3. 当前结构与事实源

### 3.1 当前本机总编 Skill

位置：

```text
技能管理中心/skills/whitepaper-chief-editor/
```

它包含：

- 总编审稿流程；
- 批注模式；
- 修订购物车；
- Word tracked changes；
- PDF 高还原复刻；
- 数据证据和问卷 SQLite；
- `ai-security-talent-report-2026` 项目包；
- DOCX 处理脚本。

优点：领域规则较完整，项目上下文和证据边界较强。
问题：范围过大，成熟度不同的能力被写在同一个公开 Skill 中。

### 3.2 当前仓库内置 Skill

位置：

```text
skills/whitepaper-wps-reviewer/
```

它包含：

- WPS 小节级批注流程；
- 3-7 条候选意见；
- 人工选择；
- 完整上下文与反证检查；
- 2022-2024 风格规则；
- 正式提交契约。

优点：边界窄，已经与当前 WPS 插件契约基本对齐。
问题：缺少总编调度层、项目包和完整安装交付能力。

### 3.3 当前 WPS 产品仓库

位置：

```text
仓库根目录/agent-wps-reviewer/
```

当前包含：

- localhost bridge；
- WPS taskpane；
- WPS 文档注册与多文档句柄；
- MCP 工具；
- 建议契约与质量门；
- 安装、诊断和验收脚本；
- 发布包脚本。

当前目录执行 `git status` 返回“not a git repository”。在放入 GitHub 前，必须先确定此目录是否就是唯一正式仓库，并在备份和排除敏感文件后初始化版本管理。

### 3.4 唯一事实源决策

改造完成后：

```text
agent-wps-reviewer 仓库 = 产品源代码和发布 Skill 的唯一事实源
技能管理中心 = 本机安装镜像，不再直接手工维护产品 Skill
~/.codex/skills / ~/.claude/skills = 运行时安装目标
```

禁止继续同时手工修改仓库 Skill 和技能管理中心 Skill。所有产品 Skill 修改先进入仓库，再由安装器同步。

---

## 4. 生产阻断问题清单

## P0-1：调度规则与执行能力没有统一发布

### 现状

原始仓库安装器只安装 `whitepaper-wps-reviewer`：

```text
src/install/skillInstall.mjs
```

本机更完整的 `whitepaper-chief-editor` 不在发布包中。该问题已在本轮改造中收敛：安装器现在只在用户 Skill 根目录创建 `whitepaper-chief-editor`，并把 WPS 执行器安装到其 `references/executors/` 下。

### 风险

- 开发者本机和 GitHub 用户得到不同能力；
- 用户说同一句话，不同 Agent 走不同工作流；
- 项目包、证据规则和审稿边界无法随产品发布；
- 无法复现开发者演示效果。

### 必须修改

建立仓库内的调度 Skill，并让安装器按 manifest 安装唯一用户入口及其内部执行器 bundle。

---

## P0-2：同一个 Skill 中存在多个互相冲突的默认模式

### 现状

本机总编 Skill 声明默认是 comment-only，但项目包 `pack.yaml` 又包含：

```yaml
editing: revision_cart_first
word_output: tracked_changes
uncertain_changes: comments_only
```

### 风险

“审查”“写入”“生成批注版”等表达可能被路由到完全不同的修改方式。

### 必须修改

调度器必须根据 capability manifest 路由，不允许项目 Profile 自行把生产模式从 WPS 批注切换到 tracked changes。

Profile 只能提供领域规则，不能越权决定执行器。

---

## P0-3：离线 DOCX 写入器存在误定位和内容破坏风险

### 已确认问题

`apply_docx_review.py` 当前实现存在：

1. 重复锚点时选择第一处匹配；
2. 批注范围覆盖整段而非目标字符；
3. 替换时删除并重建段落节点；
4. 可能破坏混合格式、超链接、书签、域、脚注、图片和已有修订；
5. 部分项目失败后仍可能输出文件并以成功状态结束；
6. 没有生产级复杂 DOCX 测试矩阵。

### 必须修改

首个生产发布不得调用这套脚本修改用户文件。脚本保留在实验区，直到完成独立安全重构和真实 Word/WPS 兼容验收。

---

## P0-4：用户安装不是单一产品闭环

### 现状

用户需要理解和操作：

- Node.js；
- npm；
- bridge；
- WPS 加载项；
- WPS 授权；
- LaunchAgent；
- MCP 配置；
- WPS 重启。

`install:local` 的短时 readiness 检查结束后还会停止它自己启动的 bridge。LaunchAgent 安装只写 plist，不实际加载服务。

### 风险

新手完成安装后插件仍可能不可见或 bridge 不在线，并且不知道问题在哪一层。

### 必须修改

提供单一产品安装入口、单一 doctor 和可操作的中文恢复建议。公开文档不再把底层组件作为并列安装步骤。

---

## P1-1：历史母本真实存在，但规则缺少可审计来源映射（已补齐页码映射）

已确认 2022、2023、2024 三份历史报告 PDF 存在，且哈希与当前 `source-fingerprints.json` 一致。

已补齐：

- `style-evidence-map.json` 中的 STYLE 规则对应 PDF 页码；
- 来源文件、证据类型和不超过必要范围的证据摘要；
- 每条规则的适用边界；
- 机器校验和“编委最终签字待确认”状态。

2023、2024 母本主要为扫描/版面 PDF，页码证据经过本机 OCR 复核；OCR 结果只用于定位证据页，不复制母本正文到公开仓库。

### 必须修改

来源文件指纹和规则证据已分开记录。哈希只证明来源文件身份；页码级证据地图用于支持规则提炼，最终风格签字仍由编委负责。

---

## P1-2：项目包与通用能力混合

`ai-security-talent-report-2026` 项目包适用于当前网络安全人才报告，不适合作为所有行业白皮书的默认规则。

### 必须修改

把项目包拆成可选 Profile。通用核心不能硬编码：

- 网络安全章节结构；
- 2022-2024 人才报告风格；
- 当前问卷分母；
- 当前报告的删减目标；
- 当前编委边界。

---

## P1-3：验收测试受到本机真实数据污染

`loadManualEvidence()` 在指定证据不存在时会回退读取默认真实 `review-store.json`。部分测试没有传入隔离的临时事件库。

### 风险

测试结果随开发者机器残留数据变化，不能证明发布包稳定。

### 必须修改

所有自动测试必须使用临时目录和显式事件库。真实 WPS 验收单独执行，不得成为单元测试的隐式后备数据。

---

## P1-4：README 和验收文档存在旧能力描述

当前文档仍出现：

- “内部原型”；
- “应用替换”；
- “修订替换”；
- 漏写 `list_wps_documents`；
- 真实验收记录仍要求 replacement applied。

### 必须修改

所有公开文档、验收事件和示例统一为 comment-only。任何 replacement 字段只能留在明确标记的兼容协议中，不得出现在用户流程。

---

## P1-5：开发完整性规则尚未成为机器门禁

现有开发完整性 Skill 可以指导风险分级、测试和验收，但仓库发布脚本没有强制检查完整性状态。

### 必须修改

发布命令必须读取机器可检查的 release gates。任何 P0 门禁失败时，不能生成标记为 production 的发布包。

---

## 5. 目标架构

## 5.1 总体结构

```text
User / Codex / Claude / Hermes
  -> whitepaper-chief-editor             # 唯一公开调度入口
       -> capability manifest             # 判断能力是否生产可用
       -> profile resolver                # 选择通用或项目 Profile
       -> whitepaper-wps-reviewer         # 内置执行器 bundle，不作为同级用户入口
            -> MCP contract
            -> localhost bridge
            -> WPS add-in runtime
            -> user Accept
            -> real WPS comment

Experimental specifications
  -> docx-redline                         # 不安装、不自动调用
  -> pdf-replica                          # 不安装、不自动调用
```

## 5.2 目标目录

建议整理为：

```text
agent-wps-reviewer/
├── skills/
│   ├── whitepaper-chief-editor/
│   │   ├── SKILL.md
│   │   └── references/
│   │       ├── capability-routing.md
│   │       ├── review-workflow.md
│   │       ├── human-approval.md
│   │       └── capability-manifest.json
│   └── whitepaper-wps-reviewer/
│       ├── SKILL.md
│       └── references/
│           ├── submission-contract.md
│           ├── review-purpose.md
│           └── failure-recovery.md
├── profiles/
│   ├── generic-whitepaper/
│   │   ├── profile.json
│   │   └── editorial-rules.md
│   └── network-security-talent-2022-2024/
│       ├── profile.json
│       ├── style-rules.json
│       ├── style-evidence-map.md
│       └── source-fingerprints.json
├── project-packs/
│   └── ai-security-talent-report-2026/
│       ├── pack.json
│       ├── chapter-question-map.md
│       ├── evidence-index.json
│       └── sensitive-boundaries.md
├── docs/
│   └── experimental/
│       ├── docx-redline-status.md
│       └── pdf-replica-status.md
├── config/
│   └── product-manifest.json
├── schemas/
├── src/
├── public/
└── scripts/
```

说明：

- `profiles` 是规则和证据配置，不是独立 Skill；
- `project-packs` 是项目上下文，不得决定执行器；
- 未成熟能力只保留规格，不放进可被 Agent 自动发现的生产 Skill 目录；
- 敏感问卷数据库是否进入发布包，必须由发布级别决定，不能默认公开。

安装后的用户 Skill 根目录只暴露一个入口：

```text
whitepaper-chief-editor/
├── SKILL.md
└── references/executors/whitepaper-wps-reviewer/
```

若检测到旧版本的顶层 `whitepaper-wps-reviewer`，安装器会先生成带时间戳备份，再迁移并隐藏旧入口；失败时按事务回滚。

## 5.3 Capability manifest

新增机器可读能力清单，例如：

```json
{
  "schemaVersion": 1,
  "productVersion": "0.2.0",
  "capabilities": {
    "wps-comment": {
      "status": "production",
      "executorSkill": "whitepaper-wps-reviewer",
      "mutatesBody": false,
      "requiresWps": true,
      "requiresUserAccept": true
    },
    "docx-redline": {
      "status": "disabled",
      "executorSkill": null,
      "reason": "OOXML precision and compatibility gates are incomplete"
    },
    "pdf-replica": {
      "status": "disabled",
      "executorSkill": null,
      "reason": "Full-page visual fidelity and template coverage are incomplete"
    }
  }
}
```

调度器必须以此文件为准，不能仅凭自然语言描述猜测能力是否可用。

---

## 6. 调度 Skill 设计

## 6.1 职责

`whitepaper-chief-editor` 只负责决策和调度，不直接操作 WPS API 或 OOXML。

必须完成：

1. 识别用户目标；
2. 确认输入对象；
3. 判断能力类型；
4. 读取 capability manifest；
5. 选择 Profile；
6. 给出清晰的范围说明；
7. 调用生产执行 Skill；
8. 汇总结果和审计状态。

## 6.2 路由规则

| 用户意图 | capability | 当前处理 |
|---|---|---|
| 找问题、给批注、在 WPS 审稿 | `wps-comment` | 调用 WPS 批注执行 Skill |
| 修改正文、生成修订稿、红线稿 | `docx-redline` | 明确未发布，只允许分析或生成修订清单 |
| 仿照历史报告生成 PDF | `pdf-replica` | 明确未发布，只允许样式分析或实验计划 |
| 只分析文档、不写入 | `analysis-only` | 调度器直接输出分析，不修改文件 |
| 意图不清 | none | 先确认目标，不自行选择高风险执行器 |

## 6.3 禁止行为

- 不得把“同意”解释成真实 WPS 写入；
- 不得把“写入”同时用于侧栏投递和真实批注；
- 不得在 WPS 不在线时伪称已创建批注；
- 不得在 `docx-redline` disabled 时调用旧 OOXML 脚本；
- 不得把项目 Profile 的默认值当作用户授权；
- 不得在用户未执行产品安装时静默写配置或启动常驻服务。

## 6.4 统一用户语言

必须使用以下术语：

| 术语 | 含义 |
|---|---|
| 候选意见 | 仅在聊天中展示，尚未提交 |
| 最终批注预览 | 用户已选择，等待投递侧栏 |
| 投递到 WPS | 进入侧栏，不修改文档 |
| 接受并生成批注 | 用户在 WPS 点击接受，创建真实批注 |
| 生成修订稿 | 未来能力，修改 DOCX 副本 |

禁止只说“已写入”，必须说明写入了哪里、是否已经改变文档。

---

## 7. WPS 批注执行 Skill 设计

## 7.1 保留的成熟流程

继续保留：

1. `list_wps_documents` 列出所有打开文档；
2. 按标题或完整路径确定目标；
3. 记录 `documentHandle` 和 `revisionToken`；
4. 每轮只读取一个小节；
5. 生成 3-7 条候选，最多 8 条；
6. 等用户选择；
7. 重读前后文并做反证检查；
8. 展示最终批注预览；
9. 调用 `submit_wps_suggestions`；
10. 用户在侧栏接受后创建真实批注。

## 7.2 必须进一步生产化的能力

- 多文档同名时使用完整路径或句柄消歧；
- 未保存文档有稳定的运行期身份；
- 目标文档关闭后拒绝继续提交；
- revisionToken 变化后建议进入 stale 状态；
- 重复锚点必须用上下文唯一定位；
- 精确到字符边界，不多选或少选字符；
- 接受或拒绝后自动选择并定位下一条待处理建议；
- 没有下一条时清空详情；
- 自动定位同样记录 `suggestion.located`；
- 接受失败不得把建议标记为已处理；
- 批注创建成功后必须读回或至少取得 WPS API 成功证据；
- bridge 断开后给出可操作恢复提示；
- WPS 重启后能重新注册文档并识别旧建议不可直接使用。

## 7.3 状态机

统一状态：

```text
candidate
  -> selected
  -> final-previewed
  -> queued-in-wps
  -> located
  -> commented | rejected | stale | failed
```

约束：

- `queued-in-wps` 不等于已经生成批注；
- `commented` 必须来自真实 WPS adapter；
- 浏览器 mock 不得生成生产验收事件；
- 自动定位下一条不能跳过 stale 或定位失败状态；
- 失败状态必须保留可重试原因。

---

## 8. Profile 与母本治理

## 8.1 Profile 分层

### generic-whitepaper

只包含跨行业稳定规则：

- 事实与观点边界；
- 数据口径；
- 章节任务；
- 结构和编号；
- 去空话；
- 人工确认边界；
- 批注可执行性。

### network-security-talent-2022-2024

包含：

- 同系列报告风格；
- 三级标题连续性；
- 样本外推边界；
- 网络安全行业术语；
- 2022-2024 母本来源指纹。

### ai-security-talent-report-2026 project pack

包含：

- 当前报告章节目标；
- 问卷题目映射；
- 数据证据索引；
- 当前稿件敏感边界；
- 当前编委确认事项。

## 8.2 风格规则证据结构

每条 STYLE 规则至少包含：

```json
{
  "id": "STYLE-01",
  "statement": "判断在前，解释和数据随后",
  "scope": "section-opening and analytical paragraphs",
  "sourceEvidence": [
    {
      "sourceId": "REPORT-2024",
      "page": 18,
      "evidenceType": "layout-and-prose-pattern",
      "note": "章节首段先给出调查判断，再解释数据"
    }
  ],
  "counterExample": "只因个人偏好调整句序，不构成风格问题",
  "reviewedByHuman": true
}
```

如果版权或保密要求不允许在 GitHub 放原文，只记录短摘要、页码和哈希，不复制大段母本文字。

## 8.3 公共发布与内部项目包分离

发布级别至少分为：

- `public`：通用规则、可公开风格摘要、代码和 schema；
- `internal`：当前项目包、问卷统计、内部证据和敏感边界；
- `local-only`：原始母本 PDF/DOCX、个人路径、未脱敏材料。

构建脚本必须按发布级别选择文件，不能使用当前“遍历所有支持扩展名”的粗粒度方式把敏感文件意外装入 zip。

---

## 9. 安装与新手体验

## 9.1 用户侧目标

用户只需要完成：

```text
下载 -> 安装白皮书审稿助手 -> 打开 WPS -> 开始审稿
```

不要求用户理解 Skill、MCP、bridge、WPS JS 加载项和 LaunchAgent 的区别。

## 9.2 安装入口

短期内部 Beta 可以提供：

```text
setup.command
```

或：

```bash
npm run setup
```

公开文档只展示一个推荐入口。底层命令保留给维护人员。

真正面向新手公开发布前，应评估签名并公证的 macOS 安装器或带运行时的单一安装包，避免要求用户预装 Node.js。

## 9.3 安装事务

安装必须按事务执行：

1. 检查系统和 WPS；
2. 检查端口和旧版本；
3. 将所有新文件写入 staging；
4. 验证 staging 完整性；
5. 备份旧配置；
6. 原子替换 Skill 和 WPS 配置；
7. 启动或注册 bridge；
8. 验证 MCP；
9. 验证 WPS 资源 URL；
10. 输出一份中文结果报告。

任何一步失败都必须自动恢复旧版本，不能出现“旧 Skill 已重命名、新 Skill 没复制成功”的中间状态。

## 9.4 Doctor

新增统一命令：

```bash
npm run doctor
npm run doctor:fix
```

至少检查：

- 产品版本；
- Skill 集版本；
- capability manifest；
- WPS 是否安装；
- 加载项配置是否正确；
- bridge 是否在线；
- 端口是否冲突；
- MCP 是否可调用；
- Agent 是否能找到调度 Skill；
- 是否有打开的 WPS 文档；
- 是否需要用户重启 WPS；
- 是否存在旧版或重复安装。

错误提示格式：

```text
问题：bridge 未运行
影响：Agent 无法读取已打开的 WPS 文档
自动修复：已尝试重新启动
下一步：如果仍失败，请运行……
```

不得只输出堆栈或内部错误码。

---

## 10. 发布包与 GitHub 策略

## 10.1 Git 仓库准备

当前目录不是 Git 仓库。执行者必须：

1. 先生成文件清单；
2. 识别敏感数据、真实文档、token、日志和用户路径；
3. 建立 `.gitignore`；
4. 建立发布级别 manifest；
5. 用户确认后再初始化或迁移到正式 Git 仓库；
6. 不得为了初始化 Git 删除当前文件或覆盖工作状态。

## 10.2 发布包不应包含

- `data/review-store.json`；
- 验收事件和真实批注内容；
- 用户 Word/PDF 文件；
- 原始问卷开放文本；
- 本机绝对路径；
- token、MCP 私密配置；
- 未批准公开的母本；
- disabled 能力的可执行破坏性脚本。

## 10.3 版本策略

建议：

- `0.2.x`：内部架构收敛和 WPS comment-only Beta；
- `0.3.x`：新手安装、doctor、干净机器验证；
- `1.0.0`：通过生产发布门禁后再发布。

不要因为功能能演示就升级为 1.0。

---

## 11. 分阶段实施计划

## Phase 0：基线冻结与风险清点

### 任务

- 保存当前目录文件清单和哈希；
- 记录当前测试结果；
- 记录当前 WPS 版本和已知实机验收证据；
- 列出仓库外依赖路径；
- 标记敏感文件；
- 确认当前目录是否作为正式 Git 仓库。

### 验收

- 有可复核的 baseline 报告；
- 没有修改或删除用户真实文档；
- 不因基线操作启动、重启或聚焦 WPS。

## Phase 1：建立唯一事实源和能力清单

### 任务

- 将总编调度逻辑迁入仓库；
- 新建 capability manifest；
- 将 PDF/Word 修订标记为 disabled；
- 将项目规则拆出为 Profile 和 project pack；
- 明确仓库 Skill 为唯一源，技能管理中心为安装镜像。

### 验收

- 新 Agent 只看仓库即可知道当前支持什么；
- 调度器不会进入 disabled 能力；
- Profile 无权改变执行器；
- 没有本机绝对路径成为运行必需条件。

## Phase 2：重写 Skill 安装器

### 任务

- 从单 Skill 常量改成 manifest 驱动；
- 同时安装调度 Skill 和 WPS 执行 Skill；
- 增加 staging、校验、回滚；
- 支持 Codex、Claude 和约定的其他 Agent 入口；
- 输出安装版本和目标路径；
- 增加卸载和恢复旧版本能力。

### 验收

- 任一步复制失败，旧版本仍可用；
- 重复安装幂等；
- 升级和降级均有明确结果；
- 临时 HOME 环境测试通过；
- 不污染开发者真实 Skill 目录。

## Phase 3：统一 WPS 状态和定位闭环

### 任务

- 统一状态枚举；
- 修复自动定位下一条；
- 加强重复锚点消歧和字符边界；
- 完善多文档自动选择；
- 增加 stale/closed/failed 恢复；
- 接受成功后记录真实 comment evidence；
- 接受失败不提前改变建议状态。

### 验收

- 相同锚点出现在多处时不会定位第一处冒充成功；
- 中英文空格、全半角标点和换行不会造成多选字符；
- 接受或拒绝后自动定位下一条；
- 没有下一条时详情清空；
- 自动定位生成 `suggestion.located`；
- 多篇文章同时打开时批注只进入绑定文档。

## Phase 4：测试隔离和发布门禁

### 任务

- 所有测试注入临时 store；
- 自动测试禁止读取默认真实数据目录；
- 将真实 WPS 验收拆成独立 gate；
- 增加安装失败回滚测试；
- 增加 capability 路由测试；
- 增加发布包敏感文件检查；
- 修正 acceptance 文档中的 replacement 旧语义。

### 验收

- 连续运行测试结果一致；
- 空 HOME、带旧版本 HOME 和损坏配置 HOME 均有测试；
- 没有真实 WPS 证据时不会标记 production complete；
- 浏览器 mock 事件不能通过真实 WPS gate；
- disabled 能力不能进入发布 Skill 集。

## Phase 5：单一安装体验与文档重写

### 任务

- 增加统一 setup；
- 增加 doctor 和 doctor:fix；
- README 改成新手快速入门；
- 高级维护细节移入单独文档；
- 所有文档统一 comment-only；
- 清理“应用替换”“修订替换”等旧表述；
- 明确“投递侧栏”与“生成真实批注”的区别。

### 验收

- 新用户只按 README 可完成安装；
- 快速入门只有一个安装入口；
- README 不要求用户理解插件组件；
- doctor 能解释常见失败并给出下一步；
- 卸载不会删除其他 WPS 插件配置。

## Phase 6：真实 WPS 与新手验收

该阶段只能在用户明确打开 WPS 并允许验收后执行。

### 测试矩阵

- 一篇已保存文档；
- 多篇不同标题文档；
- 多篇同名不同路径文档；
- 未保存文档；
- 文档读取后发生修改；
- 目标文档关闭；
- bridge 中断后恢复；
- WPS 重启；
- 重复锚点；
- 中英文标点和空格边界；
- 接受、拒绝、撤销、自动下一条；
- 真实批注在保存和重新打开后仍存在。

### 新手任务

让未参与开发的使用者完成：

1. 安装产品；
2. 打开一篇文章；
3. 让 Agent 审查一个小节；
4. 投递三条意见；
5. 接受一条、拒绝一条；
6. 确认真实批注；
7. 自行处理一次 bridge 离线提示。

不得由开发者在旁边代替输入命令。

---

## 12. 自动化测试要求

至少新增或修正以下测试：

### 调度层

- WPS 批注请求路由到 `wps-comment`；
- Word 修订请求被 disabled gate 拦截；
- PDF 复刻请求被 disabled gate 拦截；
- 分析请求不会触发安装或写入；
- Profile 不能覆盖 capability 状态。

### 安装层

- 唯一用户入口和内置执行器 bundle 原子安装；
- 旧顶层执行器迁移、备份与回滚；
- 旧版本备份；
- staging 失败自动回滚；
- 重复安装幂等；
- 临时 HOME 隔离；
- 卸载只删除本产品文件；
- 版本不一致时 doctor 报错。

### 契约层

- 正式批次状态为 `final-previewed`；
- documentHandle 和 revisionToken 必填；
- 重复锚点无上下文时整批拒绝；
- style 类必须有 styleRuleIds；
- data 类必须有 evidenceIds；
- disabled capability 不能构造正式批次。

### WPS 交互层

- 接受失败不标记 commented；
- 接受成功后自动定位下一条；
- 拒绝后自动定位下一条；
- 无下一条清空详情；
- stale 建议不可接受；
- 错误文档句柄不可写入；
- mock adapter 不产生真实验收通过状态。

### 发布层

- public 包不包含 internal/local-only 文件；
- 发布包包含 capability manifest；
- 发布包包含调度 Skill 与可审计的执行器源码；安装结果只暴露一个用户入口；
- README 中不存在“应用替换”等过期承诺；
- zip manifest 与实际文件和哈希一致。

---

## 13. 生产发布门禁

只有以下条件全部满足，才能标记生产可用：

### Gate A：架构一致性

- 调度 Skill、执行 Skill、MCP 和 UI 使用同一状态语义；
- capability manifest 是机器可读事实源；
- disabled 能力无法被正式调用。

### Gate B：自动验证

- test、contract validation、resource smoke、installer validation 全部通过；
- 测试不读取开发者真实 store；
- 发布包可重复构建；
- 敏感文件检查通过。

### Gate C：安装验证

- 干净用户环境安装成功；
- 升级和回滚成功；
- 重启后 bridge 可恢复；
- doctor 输出正确。

### Gate D：真实 WPS 结果

- ribbon 可见；
- taskpane 可打开；
- 多文档可选择；
- 定位字符准确；
- 接受创建真实批注；
- 正文没有被替换；
- 自动下一条工作；
- 保存重开后批注仍存在。

### Gate E：新手可用性

- 新用户不需要理解插件、bridge 或 MCP；
- 只按快速入门可完成首个批注；
- 常见错误可由 doctor 或界面提示恢复。

任何一项未通过，发布状态最多是 Beta，不得写“生产级完成”。

---

## 14. Word 修订能力重新进入发布的条件

未来 `docx-redline` 只有满足以下条件才能从 disabled 改为 beta：

- 精确 run-level 替换，不重建整段；
- 支持重复锚点消歧；
- 支持已有修订和批注；
- 不破坏超链接、书签、域、脚注、图片和样式；
- 全过程只写副本；
- 原子输出和失败回滚；
- 每条修改与用户批准 ID 一一对应；
- Word 和 WPS 均可打开；
- 至少覆盖普通段落、表格、标题、混合样式、超链接、已有修订的测试夹具；
- 有真实文档人工抽检。

在此之前，只能输出修订清单或审稿建议，不能自动生成正式红线稿。

---

## 15. PDF 复刻能力重新进入发布的条件

未来 `pdf-replica` 只有满足以下条件才能从 disabled 改为 beta：

- 明确目标是成品 PDF，而不是普通 Word 导出；
- 建立完整页面类型清单；
- 母本页面尺寸、页眉页脚、标题阶梯、目录、图表、表格和附录都有模板；
- 每页均渲染检查；
- 生成 contact sheet 和 QA manifest；
- 字体缺失时明确替代策略；
- 不把近似复刻称为完全复刻；
- 有视觉差异指标和人工验收；
- 与 WPS 批注产品解耦，不影响主产品安装和稳定性。

PDF 能力更接近独立排版产品，不应继续作为 WPS 批注 Skill 的附带功能。

---

## 16. 回滚策略

每个实施 Phase 必须可独立回滚。

### Skill 回滚

- 保留安装前版本；
- manifest 记录 installed version 和 backup path；
- 回滚后重新运行 doctor。

### WPS 配置回滚

- 只操作 `WpsAgentReviewer` 项；
- 保留其他 WPS 加载项；
- 安装失败自动恢复原 XML；
- 不通过删除整个配置目录解决问题。

### 数据回滚

- schema 变化前备份 store；
- 提供迁移和反向迁移；
- 不把测试数据写入真实 store。

### 发布回滚

- 保留上一稳定版本压缩包和 manifest；
- 新版本 doctor 失败时提示恢复上一版本；
- 不覆盖用户文档和批注。

---

## 17. 后续执行 Agent 的工作纪律

1. 先读本文件、现有两份 2026-07-10 规格和当前代码。
2. 先记录基线，再修改代码。
3. 不把当前目录假定为已受 Git 保护。
4. 不删除或覆盖用户已有修改。
5. 手工编辑使用小范围 patch，不做无关重构。
6. 每个 Phase 完成后运行对应测试并保存输出。
7. 未经用户允许，不启动、重启、聚焦或自动控制 WPS。
8. 浏览器 mock 验收不能代替真实 WPS 验收。
9. 不因代码已写就声称能力可用。
10. 每次汇报使用以下状态：

```text
已实现
已自动验证
已后台验收
待真实 WPS 验收
待用户确认
```

禁止把这些状态合并成含糊的“已完成”。

---

## 18. 建议的首次执行范围

下一位 Agent 不要一次完成所有 Phase。第一次执行建议只做：

1. Phase 0 基线冻结；
2. Phase 1 唯一事实源和 capability manifest；
3. Phase 2 安装器测试驱动改造；
4. 修复测试读取真实 store 的隔离问题；
5. 更新 README 的能力边界。

第一次执行结束时，不要求操作真实 WPS。应交付：

- 新的仓库 Skill 结构；
- 可检查的 capability manifest；
- 唯一用户入口及其内置执行器 bundle 的事务安装；
- disabled 能力路由测试；
- 隔离后的自动测试；
- 更新后的文档；
- 尚未执行的真实 WPS 验收清单。

第二次执行再集中处理 WPS 精确定位、自动下一条和真实验收。

---

## 19. 最终 Definition of Done

该架构改造只有在以下事实同时成立时才算真正完成：

1. GitHub 仓库是唯一产品事实源。
2. 用户只面对 `whitepaper-chief-editor` 一个入口。
3. 内部只有 `whitepaper-wps-reviewer` 处于 production，用户侧只看到 `whitepaper-chief-editor` 一个入口。
4. Word 修订和 PDF 复刻不会被误调用或虚假承诺。
5. 一次产品安装完成 Skill、运行组件和 WPS 配置部署。
6. 安装过程可回滚，doctor 可以定位常见问题。
7. Skill、MCP、bridge、UI 使用同一状态机和术语。
8. 自动测试完全隔离开发者真实数据。
9. 发布包不包含敏感材料和本机路径。
10. 新手可以在没有开发者协助的情况下创建第一条真实 WPS 批注。
11. 多文档、版本变化、重复锚点和失败恢复均通过真实验收。
12. 所有未验证部分都被明确标记，没有“代码存在即完成”的表述。

---

## 20. 当前实现证据索引

后续执行 Agent 应先复核以下仓库相对路径，避免只按本文件转述修改。以下索引以 2026-07-14 当前实现为准；行号可能随补丁变化，文件和导出符号才是稳定入口：

| 问题 | 当前证据位置 |
|---|---|
| 唯一用户入口和 disabled 能力拒绝 | `skills/whitepaper-chief-editor/SKILL.md`、`skills/whitepaper-chief-editor/references/capability-manifest.json` |
| 当前唯一生产执行能力 | `skills/whitepaper-wps-reviewer/SKILL.md`、`config/product-manifest.json`；安装后位于调度 Skill 内部 |
| Word/PDF 不得被误调用 | `skills/whitepaper-chief-editor/SKILL.md` 的“Word 修订”和“PDF 复刻”段落 |
| Skill 集事务安装与回滚 | `src/install/skillInstall.mjs` 的 `installProductionSkills` |
| 产品安装入口 | `scripts/setup.mjs`、`src/install/localInstall.mjs` |
| 新手双击安装与发布包闭环验收 | `setup.command`、`scripts/validate-release-install.mjs` |
| 安装诊断入口 | `scripts/doctor.mjs`、`src/install/doctor.mjs` |
| WPS 配置写入与备份 | `src/wps/pluginConfig.mjs` |
| bridge PID、端口归属和健康检查 | `src/bridge/processControl.mjs`、`src/bridge/server.mjs` |
| MCP stdio 初始化烟测 | `src/install/mcpHealth.mjs`、`src/install/doctor.mjs`、`src/install/localInstall.mjs` |
| 自定义端口下 WPS taskpane/connector URL 注入 | `public/WpsAgentReviewer/main.js`、`public/WpsAgentReviewer/document-connector.js`、`src/bridge/server.mjs` 的静态资源服务 |
| 重复锚点拒绝与上下文消歧 | `public/addin/wps-adapter.js`、`src/bridge/locator.mjs` |
| 自动下一条和真实批注事件 | `public/addin/app.js`、`src/acceptance/manualEvidence.mjs` |
| 批注写入防重复、状态重试和原生撤销对账 | `public/addin/app.js` 的 `COMMENT_OPERATION_LOG_KEY`、`COMMENT_FINGERPRINT_KEY`、`addCommentOnce`、`reconcileCommentState`；`public/addin/wps-adapter.js` 的 `findComment` |
| stale/conflict 不可接受 | `public/addin/app.js` 的 `acceptStatuses`、`renderActionState` 和 `runAction` 门禁 |
| 正式批次 grounding 与质量门 | `src/agent/documentGrounding.mjs`、`src/agent/whitepaperReview.mjs` |
| 测试数据隔离 | `test/manual-evidence.test.mjs`、`test/acceptance-audit.test.mjs` |
| 发布包收集与敏感路径排除 | `scripts/build-release.mjs`、`test/release.test.mjs` |
| GitHub 发布前源文件与 Git 状态检查 | `scripts/github-preflight.mjs`、`package.json` 的 `github:preflight` |
| GitHub CI 门禁模板 | `ci/github-actions.yml`；发布账号获得 `workflow` 权限后复制到 `.github/workflows/ci.yml` 启用 |
| 新手安装和公开能力边界 | `README.md`、`docs/AGENT_INTEGRATION.md`、`docs/WPS_INSTALL.md` |
| 活动文档和定位设计规格 | `docs/superpowers/specs/2026-07-10-agent-reviewer-ui-active-document-design.md` |
| 批注质量门规格 | `docs/superpowers/specs/2026-07-10-whitepaper-review-quality-gate-design.md` |

执行文档本身不进入公开 release zip；它是维护者交接材料。公开文档和 Skill 不得依赖任何 `/Users/...` 本机绝对路径。

---

## 21. 已执行记录（2026-07-14）

本轮已经按第 18 节完成了第一批工程改造，后续 Agent 不应重复创建同名结构。

### 已落地

- `whitepaper-chief-editor` 已进入仓库，作为唯一用户可见调度入口。
- `whitepaper-wps-reviewer` 保持为当前唯一生产执行能力，源码独立可审计，安装后作为 `whitepaper-chief-editor` 内部 bundle。
- `config/product-manifest.json` 已成为生产 Skill 和资源安装清单。
- `capability-manifest.json` 已将 `wps-comment` 标记为 production，将 `docx-redline` 和 `pdf-replica` 标记为 disabled。
- 安装器已支持唯一用户入口、内置执行器 bundle、Profile 资源、备份、临时 staging、旧顶层执行器迁移和失败恢复。
- Skill 备份现在写入用户 Skill 根目录外的 `.agent-wps-reviewer-backups/skills`，旧的根目录内 `.backup-*` 目录会在下一次安装时迁移，避免被 Agent 误扫描成公开 Skill。
- 已增加 `setup`、`doctor`、`doctor:fix` 入口。
- 已增加 `setup.command` 新手入口，以及可重复执行的 `validate:release-install` 发布包安装门禁。
- `acceptance:audit` 已纳入干净发布包安装门禁，统一验证最新 ZIP、真实 `setup.command`、临时 HOME、MCP 自检和 doctor；不再只验证源码目录下的本地安装器。
- `setup.command` 现在会把隔离验收需要的 `--dir`、`--skill-target`、`--port` 传给安装流程，并将 WPS 目录映射给 doctor；发布验收直接执行该入口，避免底层脚本通过而双击入口失效。
- 产品安装现在采用提交式事务：WPS 配置、授权、完整 Skill 集、token、受本次安装管理的 bridge 和本产品 MCP 条目在后续步骤失败时回滚；成功后才清理临时 staging，其他 WPS 插件和其他 MCP 名称不参与回滚。
- doctor 现在只读检查 WPS 安装/进程和 bridge 已注册文档数量；未打开文章不会被误判为安装失败，但会给出“打开目标文章并进入 Agent 审阅”的中文下一步。
- 损坏的 `authaddin.json` 现在会被明确标记为无效并阻止静默修复；同时增加了 Skill 升级回滚、bridge 重启恢复和损坏授权配置回归测试。
- 侧栏接受流程已增加本地 `operationId` 日志；若批注创建成功但状态同步失败，重试只同步状态，不再次调用 WPS `Comments.Add`。
- 侧栏现在在调用 `Comments.Add` 前先持久化 `started` 操作；若 WPS 已写入批注但插件在收到响应前崩溃，下一次重试会先核对目标文档中已有批注并恢复状态，不会再次调用 `Comments.Add`；无法确认时会阻止盲目重试。
- 侧栏已增加批注指纹和原生撤销对账；当前活动文档中的已接受建议若对应批注被 WPS 原生撤销，会恢复为待处理；无法读取批注集合时不会误改状态。
- “定位”操作不再误触发自动下一条；只有接受或拒绝成功后才自动选择并定位下一条待处理建议。
- 自动下一条在当前建议是待处理列表末项时不再回跳到上一条；当后面没有下一条时通过显式选择清空状态保持详情为空，刷新、筛选或用户重新点选时再恢复正常自动选中；新增末项交互回归测试。
- 定位成功后的结果提示现在在详情重新渲染后仍保留，用户可以同时看到成功反馈和实际选区，不再只能依赖正文高亮判断是否定位成功。
- 跨文档自动定位后会同步当前活动文档句柄，避免下一轮批注对账读取错误文档。
- WPS 文档激活现在等待并核对目标句柄；不再把 `Activate()` 的 `undefined` 返回值误当成已切换，异步切换超时会明确失败并阻止错文档定位。
- 文档句柄现在按当前 WPS 运行期的文档对象绑定，不再因未保存文档保存、另存为或文件改名而变化；没有 `WeakMap` 的旧运行环境也有对象引用回退映射。
- 活动文档同步改为按目标句柄重试确认，避免 WPS 切换事件与连接器注册存在几十毫秒时序差时读取旧文档。
- `get_active_wps_document` 现在通过连接器、registry 和 MCP 返回当前活动文档的 `selectionText`（上限 2000 字符），仍不把正文写入 bridge 存储。
- 安装级 token 现在覆盖 WPS 文档注册/读取、侧栏建议列表与状态更新、SSE、会话和验收事件接口；未授权请求统一返回 401，WPS 页面继续通过同源 HttpOnly cookie 工作。
- 定位上下文现在必须贴合锚点两侧（允许边界标点），非相邻上下文返回明确冲突并停止猜测；bridge 与 WPS 适配器使用同一规则。
- 修复定位上下文边界正则将 `\\s` 误写成字面量 `s` 的问题，避免英文词尾或词首的 `s` 被误当作可忽略字符而放行错误候选；新增 bridge 与 WPS 适配器回归测试。
- WPS Range 校验现在只归一化 CR/LF 换行编码，不放宽锚点两端字符；换行格式不同不会误报定位失败，也不会因此扩大批注选区。
- WPS 任务窗格在连接器尚未注册文档时不再回退到通用 session 列表，避免把其他文章的建议显示到当前文章；只重试连接并提示用户当前没有可用 WPS 文档。
- `stale` 和 `conflict` 建议保留在待处理列表但不可接受；执行层也拒绝绕过 UI 的旧版本批注写入。
- bridge 状态现在区分“端口上有服务”和“服务由当前安装管理”，避免孤儿 bridge 被报告为已停止或被错误启动。
- 通用 Profile 与网络安全人才白皮书 Profile 已加入仓库，并随调度 Skill 安装。
- 测试验收证据已使用隔离事件库，不再隐式读取开发者真实 store。
- WPS adapter 对重复锚点在上下文不足时改为拒绝，不再默认选择第一处。
- WPS taskpane URL 改为由 bridge 按实际服务 origin 注入，`--port` 不再导致入口和 bridge 失配。
- WPS document connector 的 bridge origin 改为由 bridge 按实际服务 origin 注入，`--port` 不再把文档读写、定位和批注请求打到旧的 17531 进程。
- bridge pid 文件记录 host/port，doctor 不再把另一端口的进程误判为当前服务。
- MCP `initialize.serverInfo.version` 改为读取 `package.json`，避免发布版本和服务自报版本漂移。
- setup readiness 和 doctor 现在会启动隔离的 MCP stdio 子进程执行 `initialize` 烟测，确认发布包里的 MCP 入口可运行；setup 同时通过 Codex/Claude 官方 CLI 只配置名为 `agent-wps-reviewer` 的本产品 MCP 条目，不直接编辑配置文件，也不会启动 WPS。
- 安装流程现在会生成幂等的随机 Agent token，token 文件和父目录分别收紧为用户可读（`600`）与用户可访问（`700`）；bridge 子进程、doctor 和 MCP 会自动读取同一 token 文件，不再要求新手手工复制 token 环境变量。
- WPS 静态页面会通过同源 `HttpOnly; SameSite=Strict` cookie 获得安装凭据；页面正文不包含 token，Agent 保护路由同时接受该同源 cookie、Bearer 和显式 token header。
- 已增加 token 文件权限、MCP token-file 调用、detached bridge 保护路由和同源 cookie 的回归测试。
- 已增加 MCP 安装器：支持 Codex 与 Claude Code，缺少某个 CLI 时跳过而不阻断安装；`mcp:status` 只读，`mcp:uninstall` 只删除本产品同名条目。
- 验收事件和人工验收文件现在由当前运行时写入 `productVersion` 与 `buildFingerprint`；审计只接受与当前源码构建一致的 WPS 证据，旧版本、缺少指纹或指纹不匹配的事件仍保留在历史 store 中但不再冒充当前验收通过。
- 发布包已排除测试、内部 superpowers 文档、演示脚本、运行数据和本机绝对路径。
- 已增加 GitHub 发布前检查：源文件、发布文件清单和敏感路径检查通过；因当前目录尚未初始化 Git，检查按预期以非零状态退出，不会擅自创建仓库或设置远程地址。
- 已增加仓库根级 `AGENTS.md`：GitHub 下载后的 Agent 会先进入 `whitepaper-chief-editor` 调度 Skill，并以能力清单、WPS 批注执行边界、安装入口和 WPS 安全规则为准；该文件已纳入发布包和 GitHub 源文件预检。
- `doctor` 已增加 Skill 源漂移检测：比较仓库 Skill 源目录、manifest 声明的公共 Profile 资源和 Codex/Claude 安装目录的完整文件树；发现不一致时明确报告 `source-drift` 并要求运行 `npm run install:skill`，不会把旧安装误报为健康。
- `doctor` 现在同时检查 manifest 声明的 retired top-level Skill；旧的顶层 `whitepaper-wps-reviewer` 残留会单独报告为 `retired-top-level-skill`，不会因为调度 Skill 本身无 drift 就被误报为健康。
- 演示录制脚本已移除开发机私有 Playwright 路径，改为按 `PLAYWRIGHT_PACKAGE_JSON`、本地依赖和通用用户缓存顺序解析；新增发布可移植性回归测试，避免 GitHub 下载者继承本机路径。
- `setup.command` 已增强 macOS Finder 场景的 Node/npm 发现：支持 PATH、Volta、mise、asdf、nvm、Homebrew 和 `/usr/local` 常见位置；会跳过低于 Node 20 的 PATH 版本，并优先使用所选 Node 同目录的 npm；同时修复无参数双击时 `set -u` 的空数组错误，并加入最小 PATH 与多版本 Node 的真实入口测试。
- 发布构建已加入可复现性回归门禁：发布前复制到固定时间戳 staging 目录，并使用稳定文件清单生成 ZIP；连续独立构建和源文件 mtime 改变后的 ZIP SHA256、manifest SHA256、文件数量都必须一致，避免同一源码生成不可追溯的发布包。
- 发布构建现在使用发布锁、临时 ZIP/manifest 和原子重命名；并发构建会串行执行，避免多个 Agent 或 CI 互相覆盖 `dist` 中的中间产物；新增并发构建回归测试。
- `doctor` 已增加公开文档和发布产物完整性检查：拒绝 README 中的“应用替换”“修订替换”等过期承诺；若本地存在 `dist` 发布包，则校验 ZIP SHA256、manifest 文件清单和包身份；发布锁持有期间会明确报告构建进行中，避免读取中间状态造成误判，超过 10 分钟的锁会提示残留锁恢复。
- `setup` 现在把本产品用户级 LaunchAgent 纳入安装事务；LaunchAgent 直接启动 bridge 时写入受管理 PID 文件并在退出时清理，doctor 能区分已配置、缺失和异常的自启动配置；失败时恢复原有 plist，不执行 `launchctl`。
- 已增加维护人员专用 `uninstall:skill`：默认只移除 manifest 声明的用户入口和退役顶层执行器，保留其他 Skill；历史备份存放在 Skill 根目录外，只有显式传入 `--restore-backup` 才恢复旧版本。
- 发布脚本已增加发布元数据机器门禁：`beta` 不得标记为 `productionReady`，`production` 必须清空晋级阻塞项，防止只改 manifest 字段绕过真实 WPS、新手安装和 GitHub 事实源验收。
- 干净 release 安装验收已增加内容级 Skill 契约：除目录结构外，还必须从安装结果读取调度器、能力清单、内部 WPS 执行器和公开 Profile，并确认 Word/PDF 仍为 disabled。
- 文档审阅数据现在按 `documentKey` 隔离：已保存文档使用规范化完整路径，当前运行期句柄只负责 WPS 读写；任务窗格、SSE 和历史建议迁移均按文档身份处理，同名多文档不自动猜测归属。
- WPS 连接器对同一路径的重复 COM 包装复用运行期句柄，并按文档身份判断活动文档，避免同一篇文章被登记成多个后台文档。
- 每个文档身份现在有稳定的 `WPS-XXXX-XXXX` 连接码：任务窗格显示并可复制，Agent 可按连接码解析唯一打开文章；正式批量投递支持连接码或运行期句柄二选一，历史建议会安全回填连接码。

### 当前验证证据

- `npm test`：258/258 通过；其中发布相关定向测试、安装/诊断相关定向测试和连接码匹配定向测试均通过，新增文档级数据隔离、历史建议安全迁移、重复 WPS 包装去重和连接码投递回归。
- `npm ci --ignore-scripts`：通过，无漏洞报告。
- `npm run validate:agent-contract`：6/6 通过。
- `npm run validate:background`：通过。
- `npm run check:url-consistency`：5/5 通过。
- `npm run validate:skill-pressure`：3/3 通过。
- `npm run release`：生成 0.2.0 `beta` 发布包，110 个文件；当前 SHA256 为 `c89a6bd104b5475536c89ed0b7c738857de9864fde3995109b114fa0ac801b15`。release manifest 明确 `productionReady=false`，并列出真实 WPS、新手无协助安装和 GitHub 唯一事实源三个晋级阻塞项；不升级到 1.0。
- 发布包已确认包含调度 Skill、可审计的 WPS 执行器源码和公共 Profile；安装后只暴露一个用户入口，未包含 `test/`、`data/`、`output/`、内部规格和开发者绝对路径。
- 网络安全人才 Profile 已加入 2022-2024 母本的页码级证据地图，8 条 STYLE 规则均通过来源 ID 和页码范围校验。
- 从最新 release zip 解压目录不执行 `npm ci`，直接运行临时端口 setup/doctor：通过；每个目标根目录只暴露一个顶层 Skill，并包含内置执行器 bundle。
- `npm run validate:release-install`：通过；真实 `setup.command` 安装结果为 `skills: 1`、用户入口 `whitepaper-chief-editor`、内置 `whitepaper-wps-reviewer`，doctor/MCP/资源/URL/LaunchAgent 均通过。
- 新手无间接依赖路径实测：将最新 ZIP 解压到全新临时 HOME 后不执行 `npm ci`，直接运行发布包内 `setup.command`；本轮 release 安装门禁明确证明 `nodeModulesPresent=false`、安装入口未调用 `npm ci`，并通过单一顶层入口、MCP/doctor/LaunchAgent/bridge 健康检查，随后仅停止临时 bridge 并清理环境。
- 发布 ZIP 可复现性回归：全量测试中的连续构建、源文件 mtime 改变和并发构建回归均通过；最终发布包文件数为 110，SHA256 为 `c89a6bd104b5475536c89ed0b7c738857de9864fde3995109b114fa0ac801b15`。
- `npm run validate:background`：通过；CLI 与 MCP 各提交 1 条，隔离 bridge 建议数为 2。
- `npm run validate:agent-contract`：6/6 通过；`npm run validate:skill-pressure`：3/3 通过；`npm run check:url-consistency`：5/5 通过。
- `npm run github:preflight`：源文件就绪、发布清单 110 个文件、敏感路径 0 个；新增根级 `AGENTS.md` 已通过存在性检查；Git 状态为 `not-initialized`，因此整体结果为未通过，等待用户明确授权后再初始化 Git 并设置远程仓库。
- `npm run acceptance:audit`：13 个自动后台门禁通过，0 个自动门禁失败，2 个真实 WPS 门禁仍为 `manual_required`；自动测试门禁为 258/258，release 安装门禁已确认单一用户入口、内置执行器、旧顶层入口残留检查、无依赖 setup 和发布包安装通过。不得将 mock 或后台 bridge 结果替代真实 WPS 门禁。
- 无 WPS 后台浏览器验收：`node scripts/validate-responsive-ui.mjs` 通过；320/360/420/480 宽度均无横向溢出、无控制台错误；交互夹具验证了定位选区、接受后自动定位并选中下一条、拒绝最后一条后清空详情。证据文件为 `output/playwright/quality-gate-responsive.json`，截图为 `output/playwright/quality-gate-320.png`、`quality-gate-360.png`、`quality-gate-420.png`、`quality-gate-480.png`。该脚本使用无头 Chromium，不启动、不聚焦 WPS；仅作为浏览器/任务窗格后台验收，不能替代真实 WPS 门禁。
- 构建指纹门禁回归验证：无身份旧 WPS 事件、旧构建指纹事件均不能满足当前人工验收；当前构建由 bridge 服务端强制盖章，客户端提交的伪造版本/指纹不会被采纳。
- 当前源码与最新发布包运行时身份：`productVersion=0.2.0`，`buildFingerprint=7f68d20a7242ced31485c6f8a93a0591`；后台 bridge 已重启并核对为同一指纹（当前 PID `47902`）。
- `npm run install:skill`：已在本机 Codex 和 Claude Skill 根目录完成真实迁移；每个根目录只安装 `whitepaper-chief-editor`，并嵌入 `whitepaper-wps-reviewer` 执行器，旧顶层目录均保留在根目录外的带时间戳备份区。
- `npm run setup` + `npm run doctor`：通过；Skill 两处均 `drift=false`，retired top-level 检查通过，WPS 配置、token、MCP、LaunchAgent、release manifest 和后台 bridge 均通过；未执行任何 WPS 启动、重启或聚焦操作。
- 当前 bridge 只读复核：目标文章登记数从重复的 12 条收敛为 1 条；旧版本 5 条建议已安全绑定到该文章的 `path:` 文档身份，未执行正文写入。
- 当前 bridge 只读复核：目标文章使用形如 `WPS-XXXX-XXXX` 的连接码，按码解析返回同一篇已打开文章；历史建议会安全回填同一连接码和当前运行期句柄，未执行正文写入。
- `npm run acceptance:kit`：已生成真实 WPS 人工验收所需的 `output/acceptance-kit/wps-reviewer-acceptance.docx`、样例 payload 和步骤说明；仅生成文件，未打开或操控 WPS。

### 尚未完成的门禁

- 当前目录仍未初始化为 Git 仓库，尚未推送 GitHub。
- 尚未在真实 WPS 前台验证 ribbon、taskpane、精确定位和真实批注写入。
- 自动化发布验收已覆盖真实 `setup.command` 入口；尚未完成由非技术用户进行的无协助人工安装任务。
- Word 修订和 PDF 复刻仍保持 disabled。
- 2022-2024 母本风格规则已完成页码级证据映射，仍待编委最终签字确认；这不阻塞当前内部 Beta，但不能宣称完成正式母本审计。

真实 WPS 门禁必须在用户主动打开 WPS 并允许验收后执行；此前不得用浏览器 mock 或后台 bridge 结果替代。
