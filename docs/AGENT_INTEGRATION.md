# Agent 接入

## 安装

```bash
cd agent-wps-reviewer
npm run setup
npm run doctor
```

这两个命令安装 WPS 运行配置、唯一用户入口 `whitepaper-chief-editor` 及其内置 WPS 执行器 bundle、同名 MCP 条目并启动本地 bridge。安装后不会把执行器作为同级用户 Skill 暴露；覆盖已有入口前会生成备份，并会迁移旧版本的顶层执行器。安装过程不会启动 WPS。MCP 配置只处理 `agent-wps-reviewer`，不会覆盖其他 MCP。

维护人员只安装 Skill：

```bash
npm run install:skill
```

## MCP

普通用户不需要手工编辑 Agent 的 MCP 配置。若 Agent 是安装后才出现，运行：

```bash
npm run mcp:install
```

维护人员也可以手工使用当前仓库的绝对路径：

```bash
node /absolute/path/to/agent-wps-reviewer/bin/wps-reviewer-mcp.mjs
```

环境变量：

```text
WPS_REVIEWER_URL=http://127.0.0.1:17531
WPS_REVIEWER_TOKEN=optional-agent-token
```

正式工具链：

1. `get_wps_document_by_code`：当用户从目标文章的 Agent 审阅侧栏复制 `WPS-XXXX-XXXX` 连接码后，按连接码解析唯一目标文章。这是多篇文章同时打开时的首选方式；每个连接码对应一个隔离的文章数据空间。
2. `list_wps_documents`：没有连接码时列出所有已打开文章，按标题或路径选择目标句柄；同时记录返回的 `connectionCode` 和 `documentKey`。
3. `get_active_wps_document`：需要确认当前活动文章时使用，不替代目标选择；返回的元数据包含 `selectionText`（最多 2000 个字符），可用于核对用户当前选区，但不返回全文。
4. `read_wps_document`：使用目标句柄按小节读取正文与相邻上下文。
5. `submit_wps_suggestions`：提交绑定同一目标句柄、已选择且已复核的正式批次；也可传连接码，由 MCP 先解析当前运行期句柄。
6. `list_wps_suggestions`：查询待处理和历史状态。

目标句柄由后台 WPS 连接器持续注册，当前运行期内用于读写；连接码持久化绑定到 `documentKey`，对已保存文档使用规范化完整路径，因此 WPS 加载项重载后同一篇文章仍能找回原有审阅数据。侧栏按当前文档的 `documentKey` 读取建议，不会把其他文章的建议混入；在“定位”或“接受”前会向 bridge 请求激活目标文章，确认活动文档已经切换后才执行定位或写入。

未保存文档没有可跨 WPS 重启复用的稳定文件身份，系统会降级为当前运行期会话身份；保存文档后才获得可持久匹配的路径身份。

`submit_wps_suggestion` 是开发兼容工具。服务端默认关闭对应入口，正式白皮书审稿不得调用。

## 必须遵守的审稿顺序

1. 调用 `whitepaper-chief-editor`，读取能力清单并路由到其内置的 `whitepaper-wps-reviewer` 执行器 bundle。
2. 每次只处理一个小节，先说明小节任务。
3. 给出 3-7 条候选意见，不直接写入 WPS。
4. 等用户选择候选编号。
5. 对入选项重读标题、前后文和相关证据；已有解释、边界或不同功能构成反证时，删除该意见。
6. 展示自然语言最终批注，确认动作和对象明确。
7. 仅用 `submit_wps_suggestions` 提交。
8. 用户在 WPS 点击“接受”后，才生成真实 WPS 批注。

## 修改目的

每条正式意见至少服务一个目的：

- `chapter-focus`：让本章只回答既定问题，删除跑题和跨章结论。
- `evidence-accuracy`：修正事实、数据、口径、来源和外推边界。
- `structure-logic`：修复标题、层级、编号、图表引用和论证顺序。
- `compression`：删除重复、空转和不增加信息的铺垫。
- `anti-ai-tone`：去除口号、套话和空泛 AI 腔。
- `historical-style`：保持与 2022-2024 同系列白皮书的内容风格连续性。
- `human-boundary`：把传播口径、价值判断和证据不足事项留给编委确认。

不能降低审稿时间、减少误判或形成明确修改动作的意见，不进入候选。

## 正式契约

- 批次 Schema：`schemas/wps-suggestion-batch.schema.json`
- 单条正式意见 Schema：`schemas/wps-suggestion.schema.json`
- 完整示例：`examples/sample-suggestion.json`、`examples/batch-suggestions.json`
- 调度 Skill：`skills/whitepaper-chief-editor/SKILL.md`
- WPS 执行器源码：`skills/whitepaper-wps-reviewer/SKILL.md`；安装后的运行时路径为 `whitepaper-chief-editor/references/executors/whitepaper-wps-reviewer/SKILL.md`，不单独安装或直接调用。

校验：

```bash
npm run validate:agent-contract
```

正式批次必须包含当前 `documentHandle` 和 `revisionToken`；MCP 正式批量工具也接受连接码，并会先解析到当前运行期句柄。Bridge 会重新读取当前版本全文，验证锚点、相邻上下文、证据摘录和关键术语；任何一条失败，整批不入库。

## 开发兼容入口

`examples/development-legacy-suggestion.json` 只用于浏览器界面联调。只有显式设置 `WPS_REVIEWER_ALLOW_LEGACY_SUBMIT=1` 时，`POST /api/suggestions` 和单条 MCP 工具才可写入；记录会标记为未验证，不能作为正式审稿结果。
