# Release

当前版本 `0.2.1` 明确属于 `beta` 通道。安装成功、自动测试通过或浏览器可以演示，都不能单独把产品标记为生产完成；真实 WPS 前台验收、新手无协助安装和 GitHub 唯一事实源门禁通过后，才允许单独进行发布晋级。

生成离线交付包：

```bash
cd agent-wps-reviewer
npm run release
```

产物：

- `dist/agent-wps-reviewer-0.2.1.zip`
- `dist/agent-wps-reviewer-0.2.1-manifest.json`

面向同事生成双平台包：

```bash
npm run release:platforms
npm run validate:platform-releases
```

产物分别为 `*-macos.zip` 与 `*-windows-x64.zip`，每个包都有独立 manifest、SHA-256、`START_HERE.md`、平台配置和 WorkBuddy 自助安装说明。平台包根目录只保留对应系统的安装入口。

公开仓库的 Agent 可以用 `npm run download:latest -- --platform macos|windows` 无登录下载最新平台包；下载器会从 GitHub Release 读取 manifest 并在落盘前校验 SHA-256。

发布 ZIP 使用固定文件时间戳和稳定文件清单生成；同一源码即使源文件 mtime 不同，ZIP SHA256 也应保持一致。manifest 同时记录 ZIP 哈希和完整文件清单，`npm run doctor` 会在本地存在发布产物时校验二者一致。

发布过程使用发布锁和临时文件，最后以原子重命名替换 ZIP 与 manifest；多个 Agent 或 CI 同时执行 `npm run release` 时会串行构建，不会互相覆盖中间产物。

发布前会校验 `config/product-manifest.json` 的发布元数据：`beta` 不能标记为 `productionReady`，`production` 必须清空晋级阻塞项；因此不能仅通过修改一个字段绕过真实 WPS、新手安装和 GitHub 事实源门禁。

`npm run doctor` 会识别发布锁：构建进行中不会把临时状态误报为 ZIP/manifest 损坏；如果锁超过 10 分钟，则提示确认没有残留发布进程后重新构建。

发布包包含：

- 本地 bridge
- WPS taskpane 静态资源
- WPS 插件入口文件
- CLI / MCP agent 集成
- 用户可见的 `whitepaper-chief-editor` 调度 Skill
- `whitepaper-chief-editor` 内置的 `whitepaper-wps-reviewer` 执行器 bundle（不作为同级用户 Skill 暴露）
- capability manifest 和产品安装 manifest
- WPS 安装/卸载脚本
- `setup` 一体化安装入口与 `doctor` 诊断入口
- MCP stdio 初始化自检，确认 Agent 入口可运行
- Codex/Claude Code MCP 同名条目安装、状态和卸载脚本；不会把 token 写入发布包
- `setup.command` 新手安装入口和 `validate:release-install` 干净发布包验收脚本
- `setup.cmd` Windows 新手安装入口；Windows 使用用户级 Task Scheduler，不安装服务、不要求管理员权限
- Windows 稳定安装目录事务（`app.next`/`app.previous`）、autostart 验证脚本和 `wpsjs@2.2.3` publish 调用适配；本地生成 publish 产物仍不等于 WPS 已完成信任
- 仅维护人员使用的 Skill 卸载/恢复脚本；默认只移除本产品入口，恢复旧版本备份必须显式传入 `--restore-backup`
- `setup` 默认写入本产品用户级 LaunchAgent；bridge 进程会写入并清理 PID 文件，doctor 可以识别登录后自启动的服务归属
- 后台启停脚本
- 可选 macOS LaunchAgent 生成/卸载脚本
- 前台 WPS 验收准备、等待与状态脚本
- WPS 验收事件的当前版本/构建指纹绑定，避免旧发布包的验收记录被当前版本复用
- WPS 后台诊断脚本
- 后台验收与诊断脚本
- 文档与样例建议

发布包排除：

- `data/`
- `output/`
- `.playwright-cli/`
- `node_modules/`

## Skill 卸载与回滚

普通用户不需要执行此操作。维护人员如需移除本产品写入的 Skill 入口：

```bash
npm run uninstall:skill -- --skill-target "$HOME/.codex/skills"
npm run uninstall:skill -- --skill-target "$HOME/.claude/skills"
```

命令只处理产品 manifest 声明的用户入口和已退役的旧顶层执行器，不会删除同一 Skill 根目录下的其他 Skill；历史版本备份保存在 Skill 根目录外的 `.agent-wps-reviewer-backups/`，避免被 Agent 发现为可调用 Skill。

只有明确需要恢复最近一次备份时才追加 `--restore-backup`。恢复前应先确认目标目录和备份内容，不能把它当作普通安装步骤。
