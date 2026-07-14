# Agent WPS Reviewer project instructions

## 唯一 Skill 入口

当任务是中文白皮书、行业报告或类似长文审稿时，先读取并使用
`skills/whitepaper-chief-editor/SKILL.md`。不要绕过它直接调用执行 Skill。

`skills/whitepaper-chief-editor/references/capability-manifest.json` 是能力和发布状态的机器可读事实源。当前对用户开放的唯一生产入口是 `whitepaper-chief-editor`：调度 Skill 先完成审稿，再通过 `wps-comment` 交给内部 `whitepaper-wps-reviewer` bundle 执行 WPS 批注；不要直接调用内部执行器或旧的兼容提交脚本。

## 审稿边界

- 每条建议必须经过原文候选定位、反证检查、最终预览和用户明确确认。
- 每个批次绑定一个文档句柄和修订令牌，禁止跨文档复用定位结果。
- `docx-redline` 和 `pdf-replica` 当前未发布，不要调用对应的写入脚本。
- “已投递 WPS”不等于“已在文档中生成真实批注”；真实批注需要单独验收。

## 安装和运行

- 从 GitHub 下载源代码后，使用唯一入口 `setup.command`（或 `npm run setup`），再运行 `npm run doctor`。
- 不要手动分别安装两个 Skill，也不要修改其他 WPS 插件或其他 MCP 配置。
- 以项目内的 `config/product-manifest.json`、Skill 能力清单和 `npm run doctor` 输出为准，不以旧文档或缓存状态为准。

## WPS 安全

- 后台测试、浏览器模拟和本地 bridge 验证不能冒充真实 WPS 验收。
- 未获得用户明确许可时，不启动、重启、聚焦或操控 WPS；真实 WPS 验收必须在用户主动打开并允许后进行。
