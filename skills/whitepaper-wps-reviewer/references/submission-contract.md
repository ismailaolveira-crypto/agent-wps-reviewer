# 正式提交契约

只使用 `submit_wps_suggestions`。一批对应同一小节、同一轮最终预览，包含 1-8 条意见，最多 8 条。

批次必须包含：

- `documentHandle`、`revisionToken`、`sourceAgent`
- `reviewProfile: whitepaper-chief-editor-v1`
- `reviewScope`: `sectionId`、`sectionTitle`、`sectionGoal`
- `workflow`: `stage: final-previewed`、`candidateRoundId`、`approvedCandidateIds`
- `styleBaseline`: `profile: network-security-talent-whitepaper-2022-2024`、`version: 1`

每条建议必须包含：

- `candidateId`、`category`
- 精确 `anchorText`，以及 `contextBefore` 或 `contextAfter`
- 自然的最终 `comment`
- `quality.issue`：问题与正文关键术语之间的明确关系
- `quality.impact`：问题带来的明确后果
- `quality.action` 和 `quality.actionStatement`：动作子句必须原样出现在批注结尾
- `quality.purposeCodes`：对应修改目的
- `quality.keyTerms`：1-5 个正文术语，不能用“本段”“内容”充数
- `quality.evidenceIds`：数据事实类不可为空
- `quality.styleRuleIds`：历史风格类不可为空
- `quality.verification`: `fullContextChecked`、`counterEvidenceChecked`、`result: supported`、`documentEvidenceExcerpt`、`relatedExcerpts`

bridge 会重新读取当前版本全文，验证锚点、上下文、正文证据和 `keyTerms`，再原子写入队列。任何一条失败，整批不入库。服务端校验不能代替 Agent 的语义反证和用户选择。
