# Agent WPS Reviewer Windows 适配执行文档

日期：2026-07-15  
执行对象：GPT-5.6 Luna 及后续开发 Agent  
适用仓库：`agent-wps-reviewer`  
目标版本：`0.3.0-beta`（Windows Beta，不晋级 production；当前工作树 package 版本仍为 `0.2.0`，待实机门禁通过后再升版）
文档性质：实现顺序、技术决策、测试矩阵与发布门禁

---

## 0. 执行结论

本次不是把几个 macOS 路径替换成 Windows 路径，而是把现有产品改造成：

```text
一套核心 bridge / MCP / Skill / WPS taskpane
        +
明确的平台适配层
        +
macOS 与 Windows 各自独立的安装、诊断、自启动和实机验收门禁
```

当前正式产品只支持 macOS。Windows 适配必须保持以下边界：

1. 不建立 Windows 分叉仓库，不复制一套 bridge 或 Skill。
2. 不在业务模块中散落 `process.platform === 'win32'`。
3. 不修改 WPS 安装目录，不改 `office6/cfgs/oem.ini`，不要求管理员权限作为默认路径。
4. 不静默启动、重启、聚焦或操控 WPS。
5. 不把浏览器 mock、Windows CI 或配置文件写入当成真实 WPS 批注验收。
6. Windows 未完成真实侧栏、定位、批注和新手安装前，只能标记为 Windows Beta。
7. Word 修订和 PDF 复刻继续保持 `disabled`，本次不扩范围。
8. macOS 现有能力和 `266/266` 测试基线不能回退。

---

## 1. 开工前先读

按顺序读取：

1. `AGENTS.md`
2. `config/product-manifest.json`
3. `skills/whitepaper-chief-editor/references/capability-manifest.json`
4. `docs/2026-07-14-agent-wps-reviewer-productization-remediation-plan.md`
5. `docs/2026-07-14-production-skill-suite-refactor-execution.md`
6. `docs/ACCEPTANCE.md`
7. `docs/WPS_INSTALL.md`
8. `src/wps/pluginConfig.mjs`
9. `src/wps/pluginAuth.mjs`
10. `src/wps/diagnostics.mjs`
11. `src/bridge/processControl.mjs`
12. `src/install/localInstall.mjs`
13. `src/install/doctor.mjs`
14. `src/install/mcpConfig.mjs`
15. `src/install/launchAgent.mjs`
16. `scripts/setup.mjs`
17. `scripts/build-release.mjs`
18. `.github/workflows/ci.yml`

禁止在未读现有测试和事务回滚逻辑前重写安装器。

---

## 2. 已确认事实

### 2.1 当前 macOS 假设

| 模块 | 当前假设 | Windows 后果 |
|---|---|---|
| WPS 配置 | `~/Library/Containers/.../jsaddons` | Windows 应使用 `%APPDATA%\\kingsoft\\wps\\jsaddons` |
| WPS 安装检测 | `/Applications/wpsoffice.app` + `Info.plist` | Windows 需要发现 `wps.exe` 并读取文件版本 |
| WPS 进程 | `pgrep -x wpsoffice` | Windows 需要 `tasklist.exe` 或受控 PowerShell 查询 |
| 端口 PID | `lsof` | Windows 没有系统自带 `lsof` |
| 停止进程 | POSIX `SIGTERM/SIGKILL` | Windows 信号会被强制终止语义替代 |
| 自启动 | `~/Library/LaunchAgents/*.plist` | Windows 需要当前用户登录自启动方案 |
| 新手入口 | `setup.command` | Windows 需要 `setup.cmd` |
| MCP CLI | 直接 `spawnSync('codex')` | Windows CLI 常为 `codex.cmd` / `claude.cmd`，不能假定可直接 `execFile` |
| 发布构建 | 系统 `zip` / `unzip` / `bash` | Windows 运行环境不保证存在这些命令 |
| 文件替换 | 临时文件直接 `rename` 覆盖 | Windows 对已存在目标和文件占用更严格 |
| token 权限 | `chmod 0700/0600` | Windows ACL 不能用 POSIX mode 作为验收依据 |

### 2.2 可直接复用的核心

以下模块原则上保持一份实现：

- `src/agent/*`
- `src/bridge/server.mjs`
- `src/bridge/store.mjs`
- `src/bridge/documentRegistry.mjs`
- `src/bridge/documentCommandBroker.mjs`
- `bin/wps-reviewer-mcp.mjs`
- `public/WpsAgentReviewer/*`
- `public/addin/*`
- `skills/whitepaper-chief-editor/*`
- `skills/whitepaper-wps-reviewer/*`
- schemas、profiles 和质量门

Windows 改造不得复制这些目录形成 `*-windows` 版本。

### 2.3 官方资料给出的边界

WPS 官方资料确认：

- WPS 加载项已适配 Windows/Linux；
- Windows 用户加载项目录为 `%APPDATA%/kingsoft/wps/jsaddons`；
- `publish.xml` 是推荐发布方式；
- `jsplugins.xml + oem.ini` 方式从 WPS `12.1.0.16910` 起受到限制；
- 推荐通过 `wpsjs publish` 生成发布页面和安装流程；
- Windows 下 WPS 加载项仍使用 `window.wps` / `Application`、Ribbon 和 TaskPane 模型。

参考：

- [WPS 加载项开发说明](https://open.wps.cn/documents/app-integration-dev/wps365/client/wpsoffice/wps-integration-mode/wps-addin-development/wps-addin-development-instructions)
- [WPS 加载项概述](https://open.wps.cn/documents/app-integration-dev/wps365/client/wpsoffice/wps-integration-mode/wps-addin-development/addin-overview)
- [生成首个 WPS 加载项](https://open.wps.cn/documents/app-integration-dev/wps365/client/wpsoffice/wps-integration-mode/wps-addin-development/generate-the-first-wps-addin)
- [WPS 加载项集成业务系统](https://open.wps.cn/documents/app-integration-dev/wps365/client/wpsoffice/wps-integration-mode/wps-addin-development/wps-addin-integration-business-system-development)

当前 npm 事实：`wpsjs` 最新版本为 `2.2.3`，registry 更新时间为 `2025-09-26`。若将它加入构建链，必须锁定精确版本；它只用于生成官方 publish 产物，不作为用户运行时依赖，也不复制修改其源码。

Node 官方资料确认：Windows `detached: true` 可以让子进程在父进程退出后继续运行，但会创建独立控制台；Windows 不存在 POSIX 信号，`SIGTERM` 等会变成强制终止语义。因此不能照搬 macOS 的进程清理假设。

参考：[Node.js child_process](https://nodejs.org/api/child_process.html#optionsdetached)

### 2.4 GitHub 可复用项目调研

未发现一个可以直接引入并完整解决本项目 Windows 适配的框架。以下项目只能按许可证和适用边界选择性借鉴。

#### A. `tmustier/pi-for-excel`：优先借鉴真实 Windows WPS 验收

- 仓库：[tmustier/pi-for-excel](https://github.com/tmustier/pi-for-excel)
- 许可证：MIT
- 当前状态：2026-07-14 仍在更新，378 stars / 50 forks。
- 重点文件：
  - [Windows WPS smoke Skill](https://github.com/tmustier/pi-for-excel/blob/e890b4eea28af9701b37ecac95d0c04a081f96e9/.agents/skills/wps-windows-smoke/SKILL.md)
  - [prepare-wps-plugin.mjs](https://github.com/tmustier/pi-for-excel/blob/e890b4eea28af9701b37ecac95d0c04a081f96e9/.agents/skills/wps-windows-smoke/scripts/prepare-wps-plugin.mjs)
  - [WPS support notes](https://github.com/tmustier/pi-for-excel/blob/e890b4eea28af9701b37ecac95d0c04a081f96e9/docs/wps-support.md)
- 可借鉴：真实 Windows VM、`wpsjs publish` 信任安装、Ribbon/taskpane 截图、WPS 版本和 commit 绑定、文档前后状态证据。
- 已知警告：Windows ARM WPS 某些构建即使完成信任仍可能禁用插件；32 位 WPS 365 在同一 VM 反而可正常执行 Ribbon/taskpane。因此验收必须记录 OS 架构、WPS 架构和具体 build，不能只写“Windows 11 通过”。

#### B. `sunbao/ah32`：可借鉴安全配置写入和 WPS 探测

- 仓库：[sunbao/ah32](https://github.com/sunbao/ah32)
- 许可证：MIT
- 当前状态：2026-05-14 仍有更新。
- 重点文件：
  - [wpsjs-debug.mjs](https://github.com/sunbao/ah32/blob/0cbda0a2e54e2a22eba38b112f7ab4c9a7102350/ah32-ui-next/scripts/wpsjs-debug.mjs)
  - [wps-pin-url.mjs](https://github.com/sunbao/ah32/blob/0cbda0a2e54e2a22eba38b112f7ab4c9a7102350/ah32-ui-next/scripts/wps-pin-url.mjs)
- 可借鉴：只修改自己的 XML 节点、写前备份、异常恢复、无变化不重写、运行进程/HKCR/LOCALAPPDATA 多级探测、`windowsHide:true`。
- 限制：主要是开发态工具；注册表 `AddinEngines` 后备路径不能直接当生产安装方案。

#### C. `lewis-hui1202/WPS-AI`：只借鉴安装器生命周期

- 仓库：[lewis-hui1202/WPS-AI](https://github.com/lewis-hui1202/WPS-AI)
- 许可证：仓库未提供 LICENSE，不可复制代码。
- 当前状态：2026-07-03 仍有更新。
- 可借鉴思路：最低权限 Inno Setup、内置 Node、登录计划任务、端口真实 bind、升级前停旧进程、安装后探活。
- 不得照搬：覆盖/删除整个 `publish.xml`、模糊命令行匹配后 kill、直接绕过 WPS 信任链。

#### D. `lnxsun/opencode-wps`：只研究 Windows COM 备用通道

- 仓库：[lnxsun/opencode-wps](https://github.com/lnxsun/opencode-wps)
- 许可证：特殊限制许可，不可复制修改。
- 当前状态：2026-07-06 仍有更新。
- 可借鉴思路：`Kwps.Application` / `Ket.Application` / `Kwpp.Application` ProgID、PowerShell 超时和 JSON 协议、localhost taskpane。
- 限制：COM 只能作为 Windows 诊断/备用传输研究，不能替换当前 WPS taskpane 主链路；其直接修改 `authaddin.json` 的做法不进入生产方案。

#### E. `liriansu-opus/wpsjs-next`：仅作历史机制参考

- 仓库：[liriansu-opus/wpsjs-next](https://github.com/liriansu-opus/wpsjs-next)
- 状态：长期未维护，许可文本存在冲突。
- 只可用于理解旧 `oem.ini/jsplugins.xml`、HKCR ProgID 和 APPDATA 路径，不作为依赖、不复制源码。

采用组合：

```text
pi-for-excel -> 真实 Windows WPS 验收与证据结构
ah32         -> 安全配置合并、备份恢复、WPS 路径探测
WPS-AI       -> 安装器生命周期思路（独立重写）
opencode-wps -> COM 备用诊断思路，不进入默认主链路
```

---

## 3. Windows Beta 支持矩阵

首轮只承诺：

| 维度 | Beta 目标 |
|---|---|
| 系统 | Windows 10 22H2、Windows 11 23H2/24H2，x64 |
| WPS | WPS Office Windows 个人版当前稳定版；Windows x64 上同时覆盖实际安装到的 x86/x64 WPS；记录真实架构、版本和 build |
| Node | 20 LTS、22 LTS |
| Agent | Codex CLI、Claude Code；缺少某个 CLI 时安装器应跳过，不整体失败 |
| 文档 | WPS 文字 `.docx` 连续正文 |
| 能力 | 多文档识别、分段读取、候选意见投递、定位、拒绝、接受后生成真实批注 |
| 安装权限 | 当前用户；默认不要求管理员权限 |

本轮不承诺：

- Windows ARM64（必须保留研究/负向记录，不得根据 x64 结果宣称 ARM64 可用）；
- WPS 企业定制包的全部 OEM 差异；
- Windows Server、多用户 RDS；
- Microsoft Word；
- WPS 表格、演示；
- MSI/MSIX、代码签名、内置 Node 运行时；
- Windows 服务；
- Linux。

---

## 4. 必须先完成的 Windows 探针，不得靠猜

在修改生产代码前，使用一台干净 Windows 测试机执行只读/最小写入探针，输出到：

```text
output/windows-probe/<date>/
```

该目录不得进入 Git 或 release。

### 4.1 采集项

1. `process.platform`、`process.arch`、Node/npm 版本。
2. `%APPDATA%`、`%LOCALAPPDATA%`、`%USERPROFILE%` 是否存在。
3. WPS `wps.exe` 实际路径、文件版本、进程名。
4. `%APPDATA%\\kingsoft\\wps\\jsaddons` 中：
   - `publish.xml`
   - `jsplugins.xml`
   - `authaddin.json`
   - 其他由 WPS 自动生成的加载项文件
5. 使用 `wpsjs@2.2.3 publish` 生成的 `publish.html` 完成信任安装后，当前 WPS 个人版是否能发现在线加载项。
6. 直接用户级维护 `publish.xml` 是否只适合开发旁加载，是否会被新版 WPS 拦截或重写。
7. `authaddin.json` 在 Windows 上是否存在、结构是否与 macOS 一致；只采集，不修改。
8. 是否生成 `jsaddinblockhost.ini` 或其他禁用记录。
9. `Application`、`wps`、`Application.CreateTaskPane`、`Application.Documents`、`ActiveDocument`、`Range`、`Comments.Add` 的真实形态。
10. WPS 同时打开两篇文档时，当前 `document-connector.js` 是否能枚举、激活和读取两篇文档。
11. Node `detached + unref + file stdio` 在 Windows 上是否留下独立可见控制台。
12. 当前用户能否无管理员权限创建、查询、运行、删除登录自启动任务。

### 4.2 探针决策门

只有满足以下条件才进入正式实现：

- 用户级 `jsaddons` 路径已由真实文件或 WPS 官方资料确认；
- 已使用官方 `wpsjs publish` 产物完成至少一次真实信任安装；
- 已确认 `authaddin.json` 的真实结构只用于诊断，且不会被 Windows 生产安装器直接写入；
- 已确定一个不要求管理员权限、可回滚且不会长期显示控制台的自启动方式；
- 已记录至少一次真实 taskpane 创建和 `Comments.Add` 成功形态。

Windows 生产安装默认走官方 publish/trust 链路。直接维护 `publish.xml/jsplugins.xml` 只允许用于开发旁加载和可恢复测试，不得作为“新手安装已完成”的证据。不得退回修改 `oem.ini`。

---

## 5. 目标架构

新增平台层：

```text
src/platform/
├── index.mjs
├── paths.mjs
├── commands.mjs
├── processInspector.mjs
├── autostart.mjs
├── macos/
│   ├── wpsDiscovery.mjs
│   └── launchAgent.mjs
└── windows/
    ├── wpsDiscovery.mjs
    ├── startupTask.mjs
    └── commandShim.mjs
```

业务模块只能调用平台接口：

```js
resolvePlatformPaths()
discoverWpsInstallation()
inspectWpsProcesses()
findListeningPids(port)
terminateOwnedProcess(identity)
installAutostart(options)
readAutostartStatus(options)
uninstallAutostart(options)
runCli(command, args, options)
```

禁止：

```js
if (process.platform === 'win32') { ... }
```

散落在 `doctor`、`localInstall`、`pluginConfig`、`processControl` 等业务文件里。平台判断集中在 `src/platform/index.mjs`。

---

## 6. 分阶段实施

## 阶段 A：平台路径与文件语义

### A1. 新增统一路径解析

修改：

- 新增 `src/platform/paths.mjs`
- 修改 `src/wps/pluginConfig.mjs`
- 修改 `src/install/agentToken.mjs`
- 修改 `src/bridge/processControl.mjs`
- 修改 `src/install/doctor.mjs`

Windows 默认值：

```text
WPS jsaddons:
  %APPDATA%\\kingsoft\\wps\\jsaddons

稳定安装目录：
  %LOCALAPPDATA%\\Programs\\Agent WPS Reviewer\\app

产品数据：
  %LOCALAPPDATA%\\Agent WPS Reviewer\\data

运行状态：
  %LOCALAPPDATA%\\Agent WPS Reviewer\\runtime

日志：
  %LOCALAPPDATA%\\Agent WPS Reviewer\\logs

Agent token：
  %LOCALAPPDATA%\\Agent WPS Reviewer\\agent-token
```

约束：

- Windows 缺少 `%APPDATA%` 或 `%LOCALAPPDATA%` 时明确失败，不回退到仓库目录。
- MCP、自启动和 WPS 本地 URL 的运行时源目录必须指向稳定安装目录，不能指向 Downloads 或临时解压目录。
- macOS 默认路径保持兼容；已有安装不迁移、不丢 token、不丢建议。
- 所有对外 JSON 同时返回 `platform` 和解析后的绝对路径。
- 测试必须覆盖路径含空格、中文和括号。

### A2. Windows 安全文件替换

当前临时文件后直接 `rename` 覆盖目标的方式不能直接视为 Windows 安全。

实现统一的 `replaceFileTransaction()`：

1. 同目录写唯一临时文件；
2. `fsync`/close；
3. 若目标存在，先改名为本次事务备份；
4. 临时文件改名为目标；
5. 成功后清理事务备份；
6. 任一步失败则恢复原文件；
7. WPS 占用文件导致 `EPERM/EBUSY` 时不重试覆盖，给出“关闭 WPS 后重试”的明确提示，但不自动关闭 WPS。

复用到开发旁加载和本产品状态文件：

- `publish.xml`
- `jsplugins.xml`
- `authaddin.json` 仅限读取和备份；Windows 生产安装不直接改授权状态
- pid record
- release manifest

### A3. token 权限

- macOS 继续校验 `0700/0600`。
- Windows 不伪造 POSIX 权限通过；校验文件位于当前用户 `%LOCALAPPDATA%` 且不把 token 打印到日志。
- 如需 ACL 收紧，必须使用系统 API 或受控 `icacls`，先写独立测试；没有证据时不要自动改 ACL。

验收：

- 新增 `test/platform-paths.test.mjs`
- 新增 `test/file-transaction.test.mjs`
- 更新 `test/agent-token.test.mjs`
- macOS 原测试全绿

---

## 阶段 B：WPS Windows 安装与诊断

### B1. 生产安装与开发旁加载分离

修改 `src/wps/pluginConfig.mjs`：

- 将 `defaultMacJsaddonsDir()` 收敛为 `defaultJsaddonsDir({ platform, env })`；保留旧导出作为兼容 wrapper。
- `production`：发布构建阶段锁定 `wpsjs@2.2.3` 生成 `publish.html` 及配套资源；`setup.cmd` 启动 bridge、验证资源后，明确引导用户完成一次 WPS 官方信任安装。
- `development`：允许临时 pin 本机 `publish.xml/jsplugins.xml`，但必须精准 merge 本产品节点、保存备份、退出恢复，不得覆盖其他插件。
- Windows 只使用当前用户 `%APPDATA%` 下的加载项数据。
- 安装、重复安装、卸载均幂等。
- 不写 Program Files，不写注册表，不写 `oem.ini`。
- 不直接修改 `authaddin.json`，不强行写 `enable_dev`。
- `setup` 输出必须区分 `bridgeInstalled`、`publishReady`、`wpsTrustPending`、`wpsTrusted`；不能在用户尚未信任时返回完整成功。

### B2. WPS 发现与版本

新增 `src/platform/windows/wpsDiscovery.mjs`。

发现顺序：

1. 显式参数或 `WPS_REVIEWER_WPS_PATH`；
2. `where.exe wps.exe`；
3. 经真实测试确认的用户级/系统级安装位置；
4. 找不到时返回 `installed:false`，不猜版本。

版本读取优先使用文件 `VersionInfo`。PowerShell 仅作为受控系统后端，参数必须数组化，不拼接用户输入脚本。

进程检测使用：

```text
tasklist.exe /FI "IMAGENAME eq wps.exe" /FO CSV /NH
```

解析器只接受合法 CSV 行，不依赖“没有运行任务”等本地化文本。

### B3. 授权文件

- Windows 只读 `authaddin.json` 用于诊断，不把直接修改它作为生产授权手段。
- 若不存在或结构不同，Windows doctor 返回 `unknown/manual_required`；不能创建猜测结构。
- 若 WPS 将本插件重写为 `enable:false`，或生成 `jsaddinblockhost.ini`，doctor 必须报告具体阻断，不能反复强改文件。
- 安装器不得把“文件不存在”判定为失败；WPS 首次发现加载项后再复查。

### B4. 诊断文案

Windows next steps 必须是平台真实命令，不能出现：

- LaunchAgent
- `launchctl`
- `/Applications/wpsoffice.app`
- `pgrep`
- `lsof`

验收：

- `test/wps-plugin-config-windows.test.mjs`
- `test/wps-discovery-windows.test.mjs`
- `test/wps-diagnostics-windows.test.mjs`
- Windows 假目录安装/卸载不触碰真实 `%APPDATA%`

---

## 阶段 C：bridge 进程控制与所有权

### C1. 端口检测

`findListeningPids(port)` 改为平台后端：

- macOS：保留 `lsof`；
- Windows：解析 `netstat.exe -ano -p TCP` 的 `LISTENING` 行；
- 命令缺失时仍使用 `/health` 判断端口服务，但 PID 返回空数组，不伪造所有权。

### C2. 强化进程身份

当前只凭 pid 文件和端口存在 PID 复用风险。新增 `runtimeInstanceId`：

1. bridge 启动时生成随机实例 ID；
2. `/health` 返回 `pid`、`runtimeInstanceId`、`productVersion`、`buildFingerprint`、`port`；
3. pid record 保存同一组字段；
4. `status/stop/restart/orphan-audit` 必须核对 pid + port + runtimeInstanceId + service；
5. 身份不一致时只能报告 unmanaged，禁止 kill。

### C3. Windows 停止策略

Windows 的 `SIGTERM` 是强制终止，不能假装执行了 POSIX 清理。

实现：

- 先验证完整进程身份；
- 首选平台内受控停止机制；
- 超时后才允许 `taskkill.exe /PID <pid> /T /F`；
- 只允许终止已证明属于本项目的 PID；
- 无身份、仅端口相同、仅命令名相同都不能 kill；
- 停止后清理本产品 pid record，并重新检查 `/health` 已不可达。

不得新增一个可被 WPS 网页 cookie 直接调用的通用 shutdown HTTP 接口。若确需管理端点，必须使用独立管理密钥、只绑定 loopback，并单独做威胁审计。

### C4. detached 控制台

Node 官方说明 Windows detached 子进程会获得独立控制台。必须在真实 Windows 上验证：

- `setup.cmd` 启动后是否留下可见黑窗；
- 日志重定向后黑窗是否消失；
- 若不能消失，自启动不能直接调用 detached `node.exe`，应通过阶段 D 的登录任务后台启动。

验收：

- 更新 `test/process-control.test.mjs`
- 新增 `test/process-control-windows.test.mjs`
- 新增 netstat fixture parser 测试
- 测试 PID 复用、伪造 pid 文件、错误端口、错误实例 ID、占用端口的其他服务

---

## 阶段 D：Windows 自启动

新增：

```text
src/platform/windows/startupTask.mjs
scripts/install-startup.mjs
scripts/validate-windows-startup.mjs
```

### D1. 首选方案

首选当前用户登录触发的 Windows Task Scheduler 任务：

```text
任务名：Agent WPS Reviewer Bridge
触发器：当前用户登录
权限：LeastPrivilege
实例策略：IgnoreNew / 单实例
工作目录：稳定安装目录
程序：当前安装记录中的 node.exe 绝对路径
参数：src/bridge/server.mjs
日志：产品 logs 目录
```

要求：

- 不保存用户密码；
- 不使用 SYSTEM；
- 不提升权限；
- 不弹 UAC；
- 安装前读出现有同名任务，只替换本产品所有的任务；
- 卸载只删除精确任务名；
- 安装失败必须回滚旧任务定义；
- `status` 能识别路径漂移、Node 不存在和版本不匹配。

Windows 官方 `schtasks` 支持 ONLOGON、创建、查询、运行、结束和删除任务，但当前用户无管理员权限的真实行为必须先通过阶段 4 探针确认。

参考：[Microsoft schtasks](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/schtasks)

### D2. 回退方案

若标准用户无法可靠创建 Task Scheduler 任务，使用当前用户 Startup 文件夹：

```text
%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup
```

只允许创建一个本产品启动入口，必须可见、可删除、可诊断。若该方案会长期显示控制台窗口，则 Windows Beta 可暂时要求用户手动运行 `bridge-start.cmd`，但不能伪装成已实现后台自启动。

参考：[Microsoft Windows 启动应用说明](https://support.microsoft.com/en-US/Windows/Experience/Startup-Boot/configure-startup-applications-in-windows)

不要引入：

- Windows Service；
- NSSM/WinSW 第三方二进制；
- VBScript 隐藏窗口；
- `ExecutionPolicy Bypass`；
- HKLM；
- 管理员权限作为默认要求。

---

## 阶段 E：`setup.cmd` 与 Windows 安装事务

新增根目录 `setup.cmd`，保留 `setup.command`。

### E1. `setup.cmd`

职责仅限：

1. 切换到脚本所在目录；
2. 查找 Node 20+；
3. 使用 `node.exe` 直接运行 `scripts/setup.mjs`；
4. 再运行 `scripts/doctor.mjs`；
5. 双击运行时保留错误窗口，CI/非交互运行不阻塞；
6. 不自动下载 Node，不修改 PATH，不启动或重启 WPS。

Node 查找顺序：

```text
where.exe node.exe
%ProgramFiles%\\nodejs\\node.exe
%LOCALAPPDATA%\\Programs\\nodejs\\node.exe
%NVM_SYMLINK%\\node.exe
```

每个候选都实际执行版本检查，不能只看文件存在。

必须验证路径：

- 包含空格；
- 包含中文；
- 解压目录带括号和 `&`；
- Node 路径带空格；
- 非管理员账户。

添加 `.gitattributes`：

```gitattributes
*.cmd text eol=crlf
*.command text eol=lf
*.mjs text eol=lf
*.js text eol=lf
```

### E2. Windows 稳定安装目录

`setup.cmd` 是 bootstrap，不应让产品长期从下载/解压目录运行。Windows setup 使用纯 Node 文件 API：

1. 将 release 运行文件复制到 `%LOCALAPPDATA%\\Programs\\Agent WPS Reviewer\\app.next`；
2. 校验 product manifest、必需文件和 build fingerprint；
3. 若存在旧版本，只停止已证明属于本产品的 bridge；
4. 将旧 `app` 改名为 `app.previous`；
5. 将 `app.next` 改名为 `app`；
6. 后续 Skill、MCP、自启动全部引用稳定 `app`；
7. doctor 全绿后删除 `app.previous`；
8. 任一步失败恢复旧 `app`、旧 MCP、旧自启动和旧 bridge。

禁止使用 junction/symlink 作为默认方案，避免开发者模式或权限差异。禁止在 bridge 仍占用旧目录时直接覆盖文件。

### E3. 安装事务平台化

`installLocalProduct()` 不再接受 `configureLaunchAgent` 作为通用概念，改为：

```js
configureAutostart: true
autostartOptions: {}
```

macOS 后端继续使用 LaunchAgent；Windows 后端使用阶段 D 的方案。

事务顺序：

1. 解析平台和路径；
2. 检查 Node、产品文件、端口；
3. 安装唯一 Skill 入口及内部执行器；
4. 安装 WPS 用户级配置；
5. 只读检查 WPS 信任/授权状态；macOS 保留现有已验证的精准修复逻辑；
6. 生成 token；
7. 配置 Codex/Claude MCP；
8. 安装平台自启动；
9. 启动 bridge；
10. 运行资源、URL、MCP、doctor 检查；
11. 任一步失败，按逆序只回滚本产品本次变更。

### E4. MCP CLI Windows shim

Windows 上 npm 安装的 CLI 常落为 `.cmd`。`spawnSync(command, args)` 不能假设能直接执行批处理入口。

实现 `runCli()`：

- `.exe` 直接执行；
- `.cmd/.bat` 通过 `%ComSpec% /d /s /c`，使用严格参数转义；
- 禁止把未转义的 token、文档路径或用户文本拼进命令行；
- token 继续只通过文件路径传递；
- `windowsHide:true`；
- 输出不得包含 token。

验收：

- `test/setup-windows.test.mjs`
- `test/local-install-windows.test.mjs`
- `test/mcp-config-windows.test.mjs`
- 失败回滚保留其他 WPS 插件、其他 MCP、旧自启动任务和旧 Skill 备份

---

## 阶段 F：doctor、命令与公开文档

### F1. 通用命令

新增/调整 npm scripts：

```json
{
  "setup": "node scripts/setup.mjs",
  "doctor": "node scripts/doctor.mjs",
  "autostart:status": "node scripts/install-autostart.mjs status",
  "autostart:install": "node scripts/install-autostart.mjs install",
  "autostart:uninstall": "node scripts/install-autostart.mjs uninstall",
  "validate:windows-install": "node scripts/validate-windows-install.mjs",
  "validate:windows-autostart": "node scripts/validate-windows-startup.mjs"
}
```

保留 `launch-agent:*` 作为 macOS 维护兼容入口，但 README 普通用户只展示通用 `setup` / `doctor`。

### F2. doctor 输出

新增：

- `platform.id`
- `platform.supported`
- `paths`
- `wps.installation`
- `wps.process`
- `plugin.deploymentMode`
- `autostart.type/status`
- `bridge.runtimeInstanceId`
- `mcp.clients[].resolvedCommand`

Windows doctor 不得因为以下可选项失败：

- 只安装了 Codex，没有 Claude；
- WPS 当前未运行；
- `authaddin.json` 尚未由 WPS 生成。

必须失败：

- bridge 不健康；
- WPS 配置指向错误端口；
- Skill source drift；
- token 缺失；
- MCP 已配置但指向旧目录；
- 自启动指向不存在的 Node 或项目目录；
- WPS 明确禁用本插件；
- release 身份不一致。

### F3. 文档

更新：

- `README.md`
- `docs/WPS_INSTALL.md`
- `docs/ACCEPTANCE.md`
- `docs/RELEASE.md`
- `docs/WPS_API_NOTES.md`
- `AGENTS.md`

README 首屏按平台给出两个唯一入口：

```text
macOS：双击 setup.command
Windows：双击 setup.cmd
```

不要把底层组件安装命令重新暴露给新手。

---

## 阶段 G：CI 与发布包

### G1. GitHub Actions

当前 CI 只有 `ubuntu-latest`。改为分层：

1. `core`：Ubuntu，完整 Node/契约/Skill/发布构建。
2. `windows-runtime`：`windows-latest`，Node 20 和 22，运行跨平台单测、Windows 路径/进程/安装事务测试。
3. `macos-runtime`：`macos-latest`，运行 macOS 安装、LaunchAgent 和回归测试。

Windows CI 不能证明真实 WPS 可用，因为 runner 没有 WPS。其状态只能叫：

```text
windowsBackgroundReady
```

不能叫 `windowsAccepted`。

### G2. release 构建

发布包必须包含：

- `setup.command`
- `setup.cmd`
- 两个平台适配层
- Windows 安装/诊断/自启动脚本
- Windows 验收说明

当前构建依赖系统 `zip/unzip/bash`。短期保持发布构建只在 Ubuntu job 运行；Windows CI 只消费已生成 fixture 或验证 release file manifest，不要求 Windows 用户本地构建发布包。

若未来要求 Windows 维护者本机构建 ZIP，再单独替换为跨平台归档实现；本轮不要为了归档引入运行时依赖，破坏“解压后无需 npm ci”的安装门禁。

### G3. 发布元数据

建议扩展 `config/product-manifest.json`：

```json
{
  "platforms": {
    "darwin": {
      "status": "beta",
      "acceptance": "manual_required"
    },
    "win32": {
      "status": "beta",
      "acceptance": "manual_required"
    }
  }
}
```

不要把当前整体 `productionReady:false` 改为 true。

同时修复现有验收语义：`acceptance:audit` 的 `completed` 不能只看自动门禁和两项 WPS 证据，还必须显式区分：

- `backgroundReady`
- `platformForegroundAccepted`
- `noviceInstallAccepted`
- `releasePromotable`

Windows 验收不得复用 macOS 事件。所有事件必须绑定：

- `platform`
- `osVersion`
- `wpsVersion`
- `productVersion`
- `buildFingerprint`
- `runtimeInstanceId`

---

## 阶段 H：Windows 真实 WPS 验收

真实验收必须在用户明确允许的 Windows 测试窗口执行。不得远程抢焦点或自动点击 WPS。

### H1. 安装验收

在干净 Windows 标准用户账户：

1. 从 GitHub Release 下载 ZIP；
2. 不运行 `npm ci`；
3. 双击 `setup.cmd`；
4. bridge 和 publish 资源检查通过；
5. 用户在官方 publish 页面完成 WPS 信任安装；
6. doctor 显示 `wpsTrusted:true`；
7. 重启/重新登录后 bridge 自动恢复；
8. Codex 或 Claude 新会话能发现 `whitepaper-chief-editor` 和 MCP；
9. 卸载只移除本产品内容；
10. 重新安装成功；
11. 安装目录包含中文和空格时仍成功。

### H2. WPS 闭环

1. 打开两篇测试 `.docx`；
2. 两篇侧栏分别显示稳定连接码；
3. Agent 按连接码选中非活动文档；
4. 分段读取目标正文；
5. 提交一个正式、已确认批次；
6. 目标侧栏出现建议；
7. 点击定位，准确选中唯一锚点；
8. 点击接受，只生成一条真实 WPS 批注；
9. 正文内容、段落格式、图片、链接不变；
10. 非目标文档无建议、无批注；
11. WPS 原生撤销后，侧栏能正确对账；
12. 重开 WPS 后旧 runtime handle 不被错误复用。

### H3. 失败矩阵

至少覆盖：

- WPS 未安装；
- WPS 已运行但插件未加载；
- `authaddin.json` 缺失/损坏/禁用；
- 17531 被其他程序占用；
- bridge 被杀死；
- Windows 登录后 Node 路径失效；
- 文档已修改导致 revision mismatch；
- 重复锚点无法唯一定位；
- WPS API 返回成功但批注数量未增加；
- WPS 信任后又把 `authaddin.enable` 重写为 false；
- 生成 `jsaddinblockhost.ini`；
- Windows x64 系统上的 x86 与 x64 WPS 行为不一致；
- ARM64 WPS 不支持时能明确阻止错误发布声明；
- Windows Defender/企业策略阻止本地脚本或自启动；
- 路径含空格、中文、括号、`&`；
- 标准用户无管理员权限。

任何失败都必须在 doctor 或侧栏给出具体层级，不得只显示“操作失败”。

---

## 7. 测试执行顺序

Luna 必须按以下顺序推进，每阶段先写失败测试：

```text
1. Windows 路径解析测试
2. Windows 文件事务测试
3. WPS 配置安装/卸载测试
4. WPS 发现和进程解析测试
5. bridge PID/实例身份测试
6. Windows CLI shim 测试
7. Windows 自启动测试
8. setup.cmd 隔离 HOME/APPDATA 安装测试
9. doctor Windows 测试
10. GitHub Actions windows-latest
11. release ZIP Windows 干净安装
12. 用户允许后的真实 WPS 验收
```

每完成一个阶段都运行：

```bash
npm test
npm run validate:agent-contract
npm run validate:skill-pressure
npm run github:preflight
```

macOS 回归还要运行：

```bash
npm run doctor
npm run validate:release-install
npm run acceptance:audit
```

不要为了让 Windows CI 变绿而跳过现有 macOS 测试。平台特定测试可以按平台跳过，但跨平台核心测试不得降级。

---

## 8. 预计文件变更

### 新增

```text
setup.cmd
.gitattributes
src/platform/index.mjs
src/platform/paths.mjs
src/platform/commands.mjs
src/platform/processInspector.mjs
src/platform/autostart.mjs
src/platform/macos/wpsDiscovery.mjs
src/platform/macos/launchAgent.mjs
src/platform/windows/wpsDiscovery.mjs
src/platform/windows/startupTask.mjs
src/platform/windows/commandShim.mjs
scripts/install-autostart.mjs
scripts/build-wps-publish.mjs
scripts/validate-windows-install.mjs
scripts/validate-windows-startup.mjs
test/platform-paths.test.mjs
test/file-transaction.test.mjs
test/process-control-windows.test.mjs
test/wps-plugin-config-windows.test.mjs
test/wps-diagnostics-windows.test.mjs
test/mcp-config-windows.test.mjs
test/local-install-windows.test.mjs
test/setup-windows.test.mjs
docs/WINDOWS_INSTALL.md
```

### 修改

```text
package.json
README.md
AGENTS.md
config/product-manifest.json
.github/workflows/ci.yml
src/wps/pluginConfig.mjs
src/wps/pluginAuth.mjs
src/wps/diagnostics.mjs
src/bridge/server.mjs
src/bridge/processControl.mjs
src/install/agentToken.mjs
src/install/mcpConfig.mjs
src/install/localInstall.mjs
src/install/doctor.mjs
scripts/setup.mjs
scripts/build-release.mjs
scripts/validate-release-install.mjs
src/acceptance/audit.mjs
src/acceptance/manualEvidence.mjs
docs/WPS_INSTALL.md
docs/ACCEPTANCE.md
docs/RELEASE.md
docs/WPS_API_NOTES.md
```

不得一次性重写上述全部文件。按阶段提交小改动，每个提交有对应测试证据。

---

## 9. Stop-ship 门禁

任一条件成立，都不得发布 Windows Beta：

- 需要管理员权限才能完成普通安装；
- 需要修改 `oem.ini` 或 WPS 安装目录；
- 安装器会覆盖其他 WPS 插件或其他 MCP；
- bridge 可被伪造 pid 文件诱导误杀其他进程；
- Windows 登录后出现常驻黑色控制台窗口；
- setup 失败后留下半套配置；
- Windows CI 未通过；
- macOS 基线回归；
- 真实 Windows WPS 无法定位或创建批注；
- 浏览器 mock 被当成真实 WPS 证据；
- Windows 验收事件没有平台和构建身份；
- 新手无协助安装未完成却标记 production。

---

## 10. 完成定义

Windows 适配只有同时满足以下条件才算“Windows Beta 完成”：

1. macOS 原有测试和安装链路通过；
2. Windows CI 通过；
3. Windows 干净标准用户账户从 release ZIP 安装成功；
4. setup、doctor、卸载、重装均通过；
5. 登录后 bridge 自动恢复且无长期可见控制台；
6. Codex/Claude 至少一个真实 MCP 接入通过；
7. 多文档读取、定位、真实批注闭环通过；
8. 正文未被修改；
9. 失败遥测能区分安装、连接、激活、定位和批注层；
10. `acceptance:audit` 显示 Windows 平台证据，而不是复用 macOS 或 mock；
11. 一位未参与开发的 Windows 用户完成无协助安装；
12. release manifest 仍为 Beta，Word/PDF 能力仍 disabled。

完成后建议发布：

```text
v0.3.0-beta.1
```

不要直接发布 `1.0.0`。

---

## 11. 给 Luna 的首次执行指令

```text
先读取 AGENTS.md、本 Windows 执行文档和现有安装/诊断/进程控制代码。
不要直接开始改 setup 或 WPS 配置。
第一阶段只完成 Windows 实机探针、平台耦合清单和测试基线；输出探针证据后，再按 A -> H 顺序实施。
全程保持 macOS 回归，不启动或操控当前用户的 WPS。
Windows 真实 WPS 验收必须等用户在 Windows 测试机上明确允许。
每个阶段给出：改动文件、测试命令、测试结果、仍未验证的边界。
没有真实证据，不得声称 Windows 已适配完成。
```

---

## 12. 本轮执行记录（2026-07-15）

本轮已完成 A -> G 的后台/安装工程落地，并把 H 的新手安装证据契约接入 recorder/audit；H 的真实 Windows WPS 实机步骤仍待 Luna 在 Windows 测试机执行。以下记录只描述已取得的证据，不替代 Windows 实机验收。

### 已落地

- 增加统一平台适配层：`src/platform.mjs`，集中处理 Windows 用户目录、WPS `jsaddons` 目录、产品数据目录、稳定安装目录和 Windows 原子文件替换。
- WPS 配置在 Windows 走 `publish.xml` 发布路径；不会写入或覆盖 `jsplugins.xml`，也不会修改 `oem.ini`、WPS 安装目录或 `authaddin.json`。
- bridge 进程控制增加 Windows `netstat`/`tasklist`/`taskkill` 路径，并以运行实例身份校验 PID，拒绝误杀复用 PID 或非本产品监听器。
- Windows 自启动使用当前用户 Task Scheduler 任务，不要求管理员权限；增加 `setup.cmd` 新手入口。
- MCP CLI、token、doctor、URL consistency、release installer 和诊断均已接入平台参数；Windows token 使用用户级 ACL 语义，不把 POSIX mode 当作验收条件。
- 增加 `test/windows-platform.test.mjs`、`test/setup-windows.test.mjs`、`test/wps-publish.test.mjs` 和 Windows CI job；CI job 在 `windows-latest` 上执行平台、setup、publish、MCP 配置、自启动 fixture、WPS 诊断测试和静态语法检查。
- 增加 Windows 稳定目录事务：`app.next`/`app.previous` 交换、失败回滚和用户级目录 fixture 验证；Task Scheduler 改为调用受控 `wps-bridge-control.mjs start`，保持运行实例身份链。
- `setup.cmd` 现在实际检查 Node 20+，`scripts/setup.mjs` 在安装后运行 doctor；增加 `autostart:*`、Windows 安装/自启动验证命令和 `wps:publish` 官方工具适配器。
- Windows 验收事件和人工证据增加 `platform`、OS/WPS 架构及 `runtimeInstanceId` 字段；audit 明确区分后台就绪、平台前台验收、新手安装和可晋级状态。
- 新增 `src/acceptance/noviceInstallEvidence.mjs`、`scripts/record-novice-install.mjs` 和 `npm run acceptance:record-novice`；Windows 的 `completed` 不再依赖硬编码布尔值，而是要求独立标准用户、无协助、非管理员完成 8 个安装/信任/自启动/MCP/卸载/重装/特殊路径步骤，并为每步提供可读证明文件。

### 已验证

```text
npm test                                  283 passed, 0 failed
npm run validate:release-install          ok: true
npm run validate:windows-install          ok: true
npm run validate:windows-autostart         ok: true
npm run check:url-consistency              5/5 passed
npm run acceptance:audit -- --platform win32
                                          backgroundReady=true; platformForegroundAccepted=false;
                                          noviceInstallAccepted=false; completed=false; manualRequired=2
GitHub Actions run 29390058972            verify / Windows Node 20 / Windows Node 22 / macOS all passed
git diff --check                          passed
node --check（全部修改的 .mjs）            passed
```

当前 release artifact 证据（每次 release 构建都会重新生成哈希）：

```text
version: 0.2.0
channel: beta
productionReady: false
fileCount: 124
sha256: 0c9942b9f674f4299918931e5e84ea17f85e8bd11dcf39e1930fd4f8e73e17b2
```

### 尚未验证、不得宣称完成

- 本机是 macOS，未在 Windows 标准用户账户上执行真实安装、卸载、重装和登录自启动。
- GitHub Actions run `29390132067` 已在 `windows-latest` 的 Node 20/22 矩阵通过，并同时通过 Ubuntu release-install 与 macOS runtime regression；这仍不能替代真实 WPS 实机验收。
- 未在 Windows WPS 实机中完成真实 TaskPane 加载、目标定位、原生批注创建、撤销恢复和多文档切换。
- 尚未收到独立测试者的 `output/novice-install-acceptance.json`；因此 Windows `acceptance:audit --platform win32` 仍应保持 `noviceInstallAccepted=false`，不能宣称无协助新手安装门禁通过。
- `wps:publish` 已提供锁定 `wpsjs@2.2.3` 的调用适配和 `publishReady/trustPending` 状态，但本机未安装/运行真实 `wpsjs publish`，因此没有把 `publish.html` 当作已信任证据。
- 未验证不同 WPS Windows 版本、ARM/x86 架构和企业策略环境；这些属于发布前矩阵。
- 当前 release manifest 必须继续保持 `beta`，Word 修订和 PDF 复刻仍为 `disabled`。

### 交给 Luna 的下一步

1. 在干净 Windows 标准账户解压 release ZIP，运行 `setup.cmd`，保存完整终端输出。
2. 先运行只读探针 `npm run windows:probe`，将 `output/windows-probe/<date>/probe.json` 作为机器事实附件。
3. 运行 `npm run doctor`，确认 Task Scheduler、MCP、publish 资源和 URL consistency 均通过。
4. 由用户明确允许后，按 `docs/ACCEPTANCE.md` 完成 WPS 实机侧栏、定位、批注、撤销和多文档验收。
5. 将 Windows CI、实机 acceptance events 和 `acceptance:audit` 输出附到 release 记录；在所有 Stop-ship 门禁通过前不得晋级 production。
