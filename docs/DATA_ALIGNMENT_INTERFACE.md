# 数据对齐接口边界

当前发布的数据对齐能力是“审稿证据契约”，不是自动连接任意数据库的通用数据平台。

## 输入

- WPS 当前文档中的标题、正文、表图引用和锚点；
- 用户提供或授权 WorkBuddy 读取的数据文件、接口结果和来源链接；
- 所选白皮书 Profile 的历史风格证据。

## 对齐要求

WorkBuddy 在提出数据类批注前必须记录：

- `evidenceId`：本轮唯一证据编号；
- 来源名称和可回溯位置；
- 数据时间范围；
- 指标名称、单位、分母和统计口径；
- 适用范围与不能外推的边界。

正式批注中的 `quality.evidenceIds` 必须引用这些证据编号。Bridge 会验证正文锚点、上下文、修订版本和 `evidenceIds` 是否存在，但不会替 WorkBuddy证明外部数据源本身真实；外部来源核验仍由执行审稿的 Agent 和人类编委负责。

## WPS 接口顺序

```text
get_wps_document_by_code / list_wps_documents
  -> read_wps_document
  -> 用户确认候选意见
  -> submit_wps_suggestions
  -> list_wps_suggestions
  -> 用户在 WPS 接受并生成真实批注
```

不同文档的数据和建议按 `documentKey` 隔离；提交时必须携带当前 `revisionToken`，旧版本定位结果不能复用。
