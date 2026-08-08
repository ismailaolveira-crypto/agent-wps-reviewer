# Agent WPS Reviewer

Agent WPS Reviewer 是一个本机白皮书审稿助手。当前发布通道是公开 Beta：WPS 批注模式可供验收；Word 修订和 PDF 复刻暂未发布。未通过真实 WPS 和新手无协助门禁前，不宣称生产完成，也不升级到 1.0。

它把 Codex、Claude Code、WorkBuddy 或其他本机 agent 的审稿意见投递到 WPS 侧边栏里。用户可以逐条定位正文、拒绝建议，或在 WPS 中接受后生成真实批注；正文不会被替换。

给同事分发时使用 GitHub Release 中独立的 macOS 或 Windows 包。让 WorkBuddy 自行下载和配置时，只需把仓库根目录的 `WORKBUDDY_SETUP.md` 链接交给它。

## 形态

```text
Agent / CLI
  -> localhost bridge
  -> WPS taskpane
  -> WPS JSAPI
  -> 批注 / 定位
```

用户只需要安装一次白皮书审稿助手。Agent 负责思考，WPS 运行组件负责把结构化建议落到文档审阅流程里。不要分别安装或配置多个 Skill。

## 从 GitHub 获取

当前版本通过公开 GitHub 仓库交付，不需要仓库协作者权限即可克隆源码：

```bash
git clone https://github.com/ismailaolveira-crypto/agent-wps-reviewer.git
cd agent-wps-reviewer
bash setup.command
```

Windows 使用 PowerShell 或 CMD 进入目录后运行：

```bat
setup.cmd
```

也可以从 [GitHub Releases](https://github.com/ismailaolveira-crypto/agent-wps-reviewer/releases) 下载最新的 `*-macos.zip` 或 `*-windows-x64.zip`，解压后按系统运行根目录的 `setup.command`（macOS）或 `setup.cmd`（Windows）。发布 ZIP 同时包含 WPS 插件、bridge、MCP server、用户入口 Skill 和内部执行 Skill，不需要从其他仓库补文件。

Agent 或维护脚本需要自动下载最新平台包时，可以运行 `npm run download:latest -- --platform macos` 或 `npm run download:latest -- --platform windows`。下载器使用公开 GitHub API，不要求登录，并会按 manifest 校验 ZIP 的 SHA-256。

安装完成后新开一个 Agent 会话，直接说“使用 `whitepaper-chief-editor` 审查当前 WPS 文章”。安装器会把用户入口 Skill 和 `agent-wps-reviewer` MCP 条目写入已检测到的 Codex/Claude Code 配置；`npm run doctor` 用于确认两者均可用。

仓库通过 `.github/workflows/ci.yml` 持续验证自动测试、Agent 契约、Skill 压力门、GitHub 发布前检查、发布包构建和干净安装链路。

## 新手安装

从 release ZIP 解压后，macOS 优先双击根目录的 `setup.command`，Windows 优先双击 `setup.cmd`。两者都会一次完成 Skill、WPS 运行配置、bridge、用户级 bridge 登录后自启动配置和 MCP 配置/自检；如果本机安装了 Codex 或 Claude Code，会只写入名为 `agent-wps-reviewer` 的本产品 MCP 条目，不覆盖其他 MCP。不会启动、重启或聚焦 WPS。

安装入口需要已安装的 WPS Office，以及 Node.js 20 或更高版本（Node.js 自带 npm）。如果双击后提示缺少 Node.js，请先安装官方 Node.js 20+，再重新运行对应入口；安装器不会偷偷下载或替换系统运行时。

如果 macOS 不允许双击脚本，打开终端进入解压目录后只执行：

```bash
npm run setup
npm run doctor
```

Windows 的等价命令为：

```bat
npm run setup
npm run doctor
```

Windows 首次安装使用 WPS 官方 `publish/trust` 流程；安装器不会直接写入 `authaddin.json`，也不会修改 WPS 安装目录。Windows Beta 目前只承诺 Windows 10/11 x64，具体 WPS 版本、架构和 build 必须记录在真实验收证据中。

Windows 安装输出会分别报告 `ready`、`publishReady`、`wpsTrustPending` 和 `wpsTrusted`；写入 `publish.xml` 只代表本地资源已准备，不代表 WPS 官方信任已经完成。完成信任后再运行 `npm run doctor`。

生产安装不会启用 WPS JS 调试属性。如果顶部出现“打开JS调试器”白色栏，请按 [WPS 安装排障说明](docs/WPS_INSTALL.md) 检查并清理旧的开发配置。

安装完成后再打开 WPS。若没有显示 `Agent 审阅`，只在允许的测试窗口重启 WPS；Windows 还应重新检查官方信任安装状态。普通用户不需要分别安装 Skill、插件、bridge 或 LaunchAgent/Task Scheduler。

安装失败不会留下半套产品配置：安装器会回滚本产品的 WPS 配置、Skill、token、bridge、LaunchAgent 和同名 MCP 条目，不会改动其他插件或其他 MCP 条目。

## 启动

```bash
cd agent-wps-reviewer
npm run setup
npm run doctor
```

默认服务：

- Bridge: `http://127.0.0.1:17531`
- 侧栏页面: `http://127.0.0.1:17531/addin/taskpane.html`
- WPS 在线插件入口: `http://127.0.0.1:17531/WpsAgentReviewer/`

后台停止：

```bash
npm run bridge:status
npm run bridge:stop
```

可选的 macOS LaunchAgent 模板：

```bash
npm run launch-agent:status
npm run launch-agent:install
npm run launch-agent:uninstall
```

`launch-agent:install` 只写入用户级 plist 文件，不会执行 `launchctl`。需要常驻自启动时，再由内部测试窗口手动加载。

## 浏览器验收

不打开 WPS 也可以先验收完整投递闭环：

```bash
npm start
```

再打开：

```text
http://127.0.0.1:17531/addin/taskpane.html
```

浏览器界面联调数据属于开发兼容入口，不代表正式白皮书批注。正式审稿必须由 Agent 调用仓库内置 `whitepaper-chief-editor` 调度 Skill；WPS 执行器是其内部 bundle，不应被用户单独调用。

```bash
npm run send:development-fixture
```

页面会出现开发联调建议卡片。点“定位”和“接受”可在右侧模拟文档验证定位与批注；正文不会被替换。

## Agent 投递

正式流程固定为：读取当前小节和任务 → 给出 3-7 条候选 → 用户选择 → 重读上下文并检查反证 → 展示最终批注 → 调用 `submit_wps_suggestions`。完整批次见 `examples/sample-suggestion.json`。

系统会拒绝未获用户选择、缺少修改目的、没有上下文证据、未引用 2022-2024 风格规则或锚点无法在当前版本定位的批次。`bin/wps-suggest.mjs` 和 `POST /api/suggestions` 仅用于显式开启的开发兼容测试，正式环境默认返回 410。

## MCP 接入

`setup.command` 会自动配置本产品的 MCP 条目。普通用户不需要手工安装或编辑 Agent 配置；如果安装后才安装了 Codex 或 Claude Code，维护人员重新运行一次 `npm run setup` 即可。

底层 MCP 状态、卸载和配置命令只供维护人员使用，详见 [docs/WPS_INSTALL.md](docs/WPS_INSTALL.md)，不会成为普通用户的安装步骤。

手工接入其他支持 MCP 的本机 agent 时，使用这个 stdio server：

```bash
node "$PWD/bin/wps-reviewer-mcp.mjs"
```

环境变量：

```bash
WPS_REVIEWER_URL=http://127.0.0.1:17531
```

正式审稿使用以下工具：

- `list_wps_documents` / `get_active_wps_document` / `read_wps_document`: 发现并读取指定 WPS 文档与小节。
- `submit_wps_suggestions`: 提交通过用户选择和反证检查的正式批次。
- `list_wps_suggestions`: 查询当前建议状态。

`submit_wps_suggestion` 是开发兼容工具，正式流程不得调用。

## WPS 加载

新用户只需要使用上面的 `setup.command`（或 `npm run setup`）和 `npm run doctor`。WPS 加载项、bridge 和 MCP 都由产品安装入口统一处理；不要分别安装插件、Skill 或 bridge。

维护人员的诊断、回滚和底层配置说明见 [docs/WPS_INSTALL.md](docs/WPS_INSTALL.md)。这些命令不会成为普通用户的安装步骤。

## 验证

```bash
npm test
npm run validate:background
npm run validate:agent-contract
npm run validate:launch-agent
npm run validate:foreground-prep
npm run validate:local-install
npm run validate:default-port
npm run smoke:wps-resources
npm run check:url-consistency
npm run acceptance:audit
npm run release
```

Windows Beta 还需要独立测试者在标准用户账户完成新手无协助安装；先运行
`npm run acceptance:novice-kit` 生成待填步骤，再用
`npm run acceptance:record-novice -- --steps-file ...` 记录安装、信任、自启动、MCP、卸载和重装证据。仅有 WPS 侧栏批注事件不会通过该门禁。

测试覆盖：

- 文档锚点定位与重复片段 disambiguation
- 建议队列持久化
- Bridge API 创建、查询、更新建议
- MCP 初始化、工具列表、工具调用
- 后台验收脚本：CLI + MCP 都能投递到 bridge
- Agent 契约校验：JSON Schema、单条样例和批量样例都符合 bridge 校验规则
- 可选 Agent Token：启用后 agent 投递建议必须带 API key，默认不影响本机使用
- LaunchAgent 模板验收：在临时 `LaunchAgents` 目录写入并删除 plist，不加载系统服务
- 前台验收准备器：在临时环境创建验收包、安装配置、启动 bridge、投递样例并清理
- 本地安装器验收：在临时 jsaddons 目录安装插件配置并验证本地 URL
- 干净发布包验收：从最新 ZIP 解压并执行真实 `setup.command`、doctor 和 MCP 自检
- 默认端口验收：短暂启动 `127.0.0.1:17531`，验证 WPS 配置里的真实 URL 可访问，随后清理
- WPS 资源 smoke：ribbon、main.js、document-connector、侧栏、app、adapter 和样式都能按真实路径访问
- URL 一致性检查：WPS 用户配置、发布模板、main.js 和 document-connector 的本地 URL 保持一致；自定义端口不会回退到 17531
- WPS API 兼容层：任务窗格和批注调用同时覆盖新旧文档里的常见 API 形态
- 真实 WPS 事件采集：只有 WPS 运行时的侧栏打开、批注、应用事件能进入最终验收；浏览器模拟事件不会通过
- 后台验收审计：汇总测试、agent 投递、release、WPS 配置与只读诊断证据

生成最终实机验收包：

```bash
npm run acceptance:kit
```

允许前台测试窗口时，推荐先准备好真实 WPS 验收环境：

```bash
npm run acceptance:prepare
```

它会安装/确认 WPS 插件配置、启动本地 bridge、刷新验收包，并把样例建议投递到 `default` 会话。

随时查看当前验收状态：

```bash
npm run acceptance:status
```

真实 WPS 侧栏会自动记录前台验收事件。允许测试窗口里完成这些动作后，再跑：

```bash
npm run acceptance:wait
npm run acceptance:validate-manual
npm run acceptance:audit
```

也可以先启动 `npm run acceptance:wait`，再去 WPS 里做定位并点击接受；它会等待真实 WPS 的定位与批注事件，正文不应被替换。

如果自动事件不可用，也可以手工记录真实 WPS 前台验收证据：

```bash
npm run acceptance:record -- \
  --wps-version "12.1.25895" \
  --document output/acceptance-kit/wps-reviewer-acceptance.docx \
  --taskpane-evidence "Agent 审阅 tab and side pane were visible." \
  --mutation-evidence "Locate and comment creation worked in WPS; the document body remained unchanged."
```
- 发布包清单：源码、WPS 插件入口、agent 集成脚本和文档都在 release zip 中
- WPS 后台诊断：插件配置、WPS 版本、bridge 状态、WPS 运行状态

## 参考产品

当前产品设计参考了这些项目的产品和工程经验，但没有直接复制它们的代码：

- `lnxsun/opencode-wps`: WPS 原生侧边栏、本地桥、WPS 读写方向。
- `yuch85/word-ai-redliner`: AI 修改意见落成 redline/diff 的工程思路。
- `ImadBoyZz/clauseguard`: 逐条建议卡片、应用单条建议的审阅形态。
- `gleanwork/sl-glean-legal-redlining-for-word`: 法务审阅场景里的结构化建议流程。
