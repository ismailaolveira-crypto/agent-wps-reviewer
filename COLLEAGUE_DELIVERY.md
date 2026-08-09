# 同事交付包

维护人员只需要运行：

```bash
npm run release:colleague
```

命令会生成并校验两套独立交付包：

- `dist/agent-wps-reviewer-<version>-macos.zip`
- `dist/agent-wps-reviewer-<version>-windows-x64.zip`
- `dist/agent-wps-reviewer-<version>-colleague-delivery.json`

每个 ZIP 都包含：

- 唯一用户入口 `whitepaper-chief-editor` Skill 及其界面元数据；
- 内置 `whitepaper-wps-reviewer` 执行器和公开审稿 Profile；
- WPS `Agent 审阅` 加载项、侧边栏与文档连接器；
- 本地 Bridge、MCP Server、安装、诊断、卸载和回滚能力；
- 当前平台唯一安装入口、`START_HERE.md` 和 WorkBuddy 说明。

同事不需要分别安装 Skill、WPS 插件、Bridge 或 MCP。解压对应系统的 ZIP，先读 `START_HERE.md`，然后只运行根目录的 `setup.command` 或 `setup.cmd`。

也可以完全不手工下载 ZIP，直接使用仓库根目录的：

- macOS：`install-from-github.command`
- Windows：`install-from-github.ps1`

两者都会自动下载最新匹配平台的 GitHub Release、验证 manifest 与 SHA-256、解压并调用统一安装器；安装器随后配置本机检测到的 Codex、Claude Code 和 WorkBuddy MCP。

## 发布边界

当前发布通道仍是 Beta。机器检查可以证明包体、安装链路、后台资源和版本一致；真实 WPS 任务窗格、定位、原生批注、保存重开以及 Windows 标准用户无协助安装，仍必须由实际使用者验收。

默认包不启用 Word 红线、PDF/InDesign 复刻，也不包含项目数据、文档、日志、Token 或本机验收记录。
