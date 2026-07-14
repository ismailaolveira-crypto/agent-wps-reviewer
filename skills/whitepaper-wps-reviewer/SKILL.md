---
name: whitepaper-wps-reviewer
description: Use when reviewing Chinese white papers or industry reports through the Agent WPS Reviewer, especially when comments must match historical report style, stay evidence-backed, and remain under human approval.
---

# 白皮书 WPS 审稿

只把已经核验、值得作者处理的意见送进 WPS。批注数量不是质量指标，审稿人节省的判断时间才是。

## 必读依据

先读：

- `references/review-purpose.md`
- `references/2022-2024-style-profile.md`
- 当前选择的 Profile 的 `style-evidence-map.json`；它是风格规则的页码级证据索引，不是可省略的装饰文件。

提交前再读 `references/submission-contract.md`。

## 工作流

1. 如果用户提供了插件中显示的 `WPS-XXXX-XXXX` 连接码，先调用 `get_wps_document_by_code`；它是多篇文章同时打开时的权威匹配方式。若没有连接码，再调用 `list_wps_documents`，按文章标题或完整路径确认目标文章；不要把 `ActiveDocument` 当成目标文章。记录目标文档的 `connectionCode`、`documentHandle`、`documentKey` 和 `revisionToken`。连接码对应一个隔离的文章数据空间，`documentHandle` 只用于当前运行期读写。
2. 用目标 `documentHandle` 调用 `read_wps_document`，只读取一个二级小节或内容密集的三级小节，并说明该小节要完成什么任务。
3. 在聊天中给出 3-7 条候选意见，硬上限 8 条。每条固定使用：

```text
【位置】精确标题、表图或原句
【问题】具体说明哪里重复、错误、失焦或无依据
【建议改为】删除、合并、压缩、替换、弱化、移动、核验或请编委确认
```

4. 等用户选择或改写编号。禁止把第一轮候选直接提交到 WPS。
5. 对入选项重新读取前一标题、锚点前后文和相关段落，执行反证检查：前后文是否已经给出标题、证据、边界或解释；所谓重复是否承担不同功能；删除后是否破坏证据链。被上下文推翻的意见必须淘汰。
6. 在聊天中给出最终批注文本预览。WPS 批注使用自然、具体、可执行的人工编委语言，不带三行标签。
7. 用户确认最终文本后，按 `submission-contract.md` 使用同一个目标连接码调用 `submit_wps_suggestions`（或使用由连接码解析出的 `documentHandle`）。提交侧边栏不修改正文。
8. 只有用户在侧边栏点击“接受”，才生成真实 WPS 批注；正文不得被替换。

## 硬规则

- 一轮只处理一个小节，不混审远距离章节。
- 当前稿件偏长，默认方向是删、并、压、换、弱化。只有核心证据或必要边界缺失时才要求补充。
- 数据事实意见必须有 `evidenceIds`；未核验数据不能写成确定事实。
- 风格意见必须引用 `STYLE-01` 至 `STYLE-08`，并能在所选 Profile 的证据地图中找到来源文件和 PDF 页码；不能把个人措辞偏好冒充 2022-2024 历史风格。
- 强判断、重大删减、结构重排和传播表达使用 `committee-confirmation`，由人决定。
- `anchorText` 必须是当前正文中的最短可核验句子或必要的标题/短语；不能把整段正文带进只针对其中一句的批注，也不能使用“但”“高校”“这里”等过短或重复片段。提交前必须逐字比对锚点的起止字符，并确认定位后选区只覆盖该锚点。
- 不能证明问题存在、不能说明修改收益、不能给出直接动作的意见，不进入候选列表。
- 多篇文章同时打开时，每条批次只能绑定一个目标连接码/`documentHandle`；不得把不同文章的锚点混进同一批次。连接码对应隔离的数据空间，插件会按 `documentKey` 隔离列表，不能依靠“目标文档”兜底文字判断归属。
