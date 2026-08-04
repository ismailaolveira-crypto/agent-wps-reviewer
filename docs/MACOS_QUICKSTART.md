# macOS 同事版

只需要关注三个文件：

1. `START_HERE.md`：本包入口；
2. `setup.command`：唯一安装入口；
3. `WORKBUDDY_SETUP.md`：交给 WorkBuddy 执行的完整说明。

前置条件：macOS、WPS Office、Node.js 20+，以及私有 GitHub 仓库读取权限。

安装：

```bash
bash setup.command
npm run doctor
```

安装器负责插件、Bridge、Skill 和已检测 Agent 的 MCP 配置，不需要分别配置组件。
