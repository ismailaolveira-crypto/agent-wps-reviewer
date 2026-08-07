# WPS Install

## 推荐安装方式

新用户在 macOS 优先双击发布包中的 `setup.command`，Windows 优先双击 `setup.cmd`。如果系统没有允许双击脚本，打开终端或 PowerShell 后只执行：

```bash
cd agent-wps-reviewer
npm run setup
npm run doctor
```

该入口需要 WPS Office 和 Node.js 20 或更高版本（Node.js 自带 npm）。安装器不会自动下载或替换 Node.js；缺少运行时会先停止并给出明确提示。

`setup` 会安装唯一用户入口 `whitepaper-chief-editor` 及其内部 WPS 执行器 bundle、WPS 运行配置、生成本机 token、配置本产品 MCP 条目、写入用户级 bridge LaunchAgent（macOS）或 Task Scheduler 任务（Windows）并启动本地 bridge，同时执行一次隔离的 MCP 初始化烟测和 doctor。Windows 首次运行会先把运行文件事务性复制到 `%LOCALAPPDATA%\Programs\Agent WPS Reviewer\app`，升级时使用 `app.next`/`app.previous` 回滚；Task Scheduler 和 MCP 均引用稳定目录。旧版本顶层 `whitepaper-wps-reviewer` 会在迁移时备份并移除。它不会启动、重启或聚焦 WPS；只会处理名为 `agent-wps-reviewer` 的 MCP 条目，不会改写其他 MCP。Windows 首次安装需完成 WPS 官方 `publish/trust` 信任流程，不直接修改 `authaddin.json`。

安装采用提交式事务：后续步骤失败时会回滚本产品已写入的 WPS 配置、授权、Skill、token、LaunchAgent 和本次启动的 bridge；MCP 只处理本产品同名条目，失败时撤销本次新增或恢复本产品配置，其他 MCP 条目不动。

维护者或 CI 可以用 `npm run validate:release-install` 验证“最新 release ZIP 解压 -> 不安装依赖 -> setup -> doctor”的新手链路。该命令使用临时 HOME、临时 Skill 目录、临时 WPS 配置目录和临时 bridge 端口，不读取或修改当前用户安装；Node.js 20+ 自带的 npm 只负责执行脚本，不要求用户先运行 `npm ci`。

发布包会按实际 bridge 服务端口动态注入 `main.js` 的 taskpane 地址和 `document-connector.js` 的 bridge origin。不要手工把 connector 中的地址改回 `17531`；自定义端口验收必须通过资源 smoke 和 URL 一致性检查。

## 维护人员：单独启动 bridge

```bash
cd agent-wps-reviewer
npm start
```

如果不想占一个终端窗口，可以后台启动：

```bash
npm run bridge:start
npm run bridge:status
npm run bridge:stop
```

如果需要维护或单独修复 bridge 自启动配置，macOS 可以重新生成用户级 LaunchAgent plist：

```bash
npm run launch-agent:install
npm run launch-agent:status
```

这一步只写入：

```text
~/Library/LaunchAgents/com.agent-wps-reviewer.bridge.plist
```

它不会执行 `launchctl`，也不会立刻启动服务。需要真正常驻时，建议在专门测试窗口里手动加载 plist，并先确认 `npm run validate:launch-agent` 通过。回滚配置：

```bash
npm run launch-agent:uninstall
```

WPS 插件入口由本地服务提供：

```text
http://127.0.0.1:17531/WpsAgentReviewer/
```

侧栏页面是：

```text
http://127.0.0.1:17531/addin/taskpane.html
```

Windows 用户级自启动任务名为 `Agent WPS Reviewer Bridge`，权限级别为 `LIMITED`，不安装 Windows 服务、不要求管理员权限。可用 `npm run autostart:status` 或 `npm run doctor` 查看任务状态；`npm run autostart:install/uninstall` 只处理本产品精确任务名。

维护者如已按官方要求安装并锁定 `wpsjs@2.2.3`，可在独立目录运行 `npm run wps:publish -- --output-dir <publish-dir>` 生成官方发布产物。该命令只生成 `publish.html`/`publish.xml` 并报告 `trustPending`；用户仍需在 WPS 中完成官方信任安装，不能把本地文件生成当成 `wpsTrusted` 证据。

## 安装方式

维护人员如需单独写入 WPS 配置，可使用底层脚本。普通用户请使用 README 中的 `npm run setup`，不要分别安装 Skill 和 WPS 组件：

```bash
cd agent-wps-reviewer
npm run install:local
npm run wps:status
```

`install:local` 会安装 WPS 用户级插件配置，并短暂启动默认端口做本地 URL 验收；验收结束后会清理它自己启动的 bridge。只想写配置时也可以用 `npm run wps:install`。

`wps:install` 会把下面这段配置写入 WPS 用户级 JS 加载项目录，并在已有配置存在时先生成备份。Mac 版会同时写 `jsplugins.xml` 和 `publish.xml`，用于覆盖不同 WPS 版本的加载习惯；Windows 生产安装只写本产品的 `publish.xml`，返回 `publishReady=true`、`wpsTrustPending=true`，直到用户完成官方信任安装前不会报告 `wpsTrusted=true`，也不直接改 `jsplugins.xml` 或 `authaddin.json`：

```xml
<jsplugins>
  <jspluginonline name="WpsAgentReviewer" type="wps" url="http://127.0.0.1:17531/WpsAgentReviewer/"/>
</jsplugins>
```

WPS 加载后会出现 `Agent 审阅` 选项卡，点击 `审阅收件箱` 打开侧边栏。

### Windows 顶部白色“打开JS调试器”栏

如果 WPS 顶部出现包含“审阅收件箱”和“打开JS调试器”的白色栏，通常不是
侧栏页面无法关闭，而是旧的 `publish.xml`/`jsplugins.xml` 仍带有
`debug=""` 或 `enable="enable_dev"` 开发属性。生产安装现在不会再生成这些属性。

在允许的维护窗口关闭 WPS 后，先查看：

```bash
npm run wps:status
npm run doctor
```

如果输出包含 `debugEnabled: true`，运行 `npm run wps:install` 重新生成本产品配置，
再重新打开 WPS。不要直接修改 `authaddin.json`，也不要删除其他加载项的配置；旧
WPS 进程可能缓存配置，必须在用户允许的窗口完全退出并重新打开后验证。

该判断与 WPS 官方 `CreateTaskPane`/publish 模式区分：`debug` 属性用于网页调试，
不是关闭 Agent 审阅侧栏的业务按钮。

卸载：

```bash
npm run wps:uninstall
```

这只会移除 `name="WpsAgentReviewer"` 的插件项，保留其他 WPS 插件项。

手动安装时，也可以把项目里的 `public/jsplugins.xml` 内容加入 WPS JS 加载项配置。

后台诊断：

```bash
npm run wps:diagnose
```

它会检查：

- WPS app 是否存在和版本号
- `jsplugins.xml` / `publish.xml` 是否已安装
- bridge 是否正在监听
- WPS 当前是否在运行
- 如果 WPS 已经运行但插件入口没出现，会提示在允许窗口重启 WPS

## 文件说明

- `public/jsplugins.xml`: WPS 在线 JS 插件声明。
- `public/WpsAgentReviewer/ribbon.xml`: WPS ribbon 按钮。
- `public/WpsAgentReviewer/main.js`: 调用 `Application.CreateTaskPane` 打开侧栏。
- `public/addin/taskpane.html`: 侧栏 UI。
- `bin/wps-addon-config.mjs`: 安装、卸载、查看 WPS 用户级插件配置。
- `bin/wps-bridge-control.mjs`: 后台启动、停止、查看本地 bridge。
- `bin/wps-diagnose.mjs`: 后台诊断 WPS 插件安装与 bridge 状态。
- `scripts/install-launch-agent.mjs`: 生成、查看、删除 macOS LaunchAgent 或 Windows Task Scheduler 配置；不主动聚焦 WPS。

## 版本差异

WPS 客户端 JSAPI 在不同系统、不同版本中有差异。当前适配层已经同时处理：

- `wps.WpsApplication()` 和 `Application`
- `Comments.Add(range, text)` 和 `Comments.Add({ Range, Text })`

如果某个内部分发版本没有暴露 `Comments.Add` 或 `Range(start,end)`，插件会在侧栏里报错，不会静默修改正文。

## 实机验收步骤

在不影响正常工作时执行（Windows 需记录系统/WPS 架构和 build）：

1. 后台准备：`npm run acceptance:prepare`
2. 重启 WPS，打开 `output/acceptance-kit/wps-reviewer-acceptance.docx`
3. 点击 `Agent 审阅` -> `审阅收件箱`
4. 在侧栏点击 `定位`，确认 WPS 选中原文
5. 点击 `接受`，确认 WPS 生成真实批注且正文保持不变
6. 后台运行：`npm run acceptance:wait`
7. 后台运行：`npm run acceptance:status`
8. 后台运行：`npm run acceptance:audit`
9. 完成后运行：`npm run wps:uninstall`

侧栏在真实 WPS 运行时会自动回传 `taskpane.opened`、`suggestion.located`、`suggestion.commented` 验收事件。浏览器模拟模式的事件不会被最终审计当成真实 WPS 验收。

`acceptance:wait` 只轮询本地证据文件，不会启动、重启、聚焦或控制 WPS。

`npm run doctor` 还会只读显示 WPS 是否安装、WPS 进程状态和 bridge 当前已注册的文档数量；它不会打开、重启或聚焦 WPS。

Skill 入口的移除/旧版本恢复属于维护操作，不是普通用户安装步骤。维护人员可查看 `docs/RELEASE.md` 中的 `uninstall:skill` 说明；默认卸载不会删除其他 Skill，恢复备份必须显式确认。

验收结束后执行：

```bash
npm run bridge:stop
```
