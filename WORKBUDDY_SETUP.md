# WorkBuddy 自助安装与使用入口

把本页链接交给 WorkBuddy 后，让它严格按本页执行。不要让它自行猜测安装目录、MCP 名称或批注接口。

## 目标

安装并配置 `agent-wps-reviewer`，让 WorkBuddy 可以：

1. 识别已打开的 WPS 文档；
2. 按连接码、标题或完整路径选择目标文章；
3. 分段读取文章并核对数据、口径、来源和历史风格；
4. 把用户确认后的意见投递到 WPS 侧边栏；
5. 由用户在侧边栏点击“接受”后生成真实批注。

当前不允许自动替换正文，也不允许生成所谓正式 Word 红线稿或 PDF 复刻稿。

数据证据字段与能力边界见 `docs/DATA_ALIGNMENT_INTERFACE.md`。外部数据必须来自用户提供或明确授权的来源，不能只因为接口里存在一个编号就宣称数据已经核真。

## 执行前检查

- 先识别操作系统，只下载对应平台包；
- 确认已安装 WPS Office、Node.js 20 或更高版本；
- 确认 GitHub CLI `gh` 已登录，并且当前账号对私有仓库 `ismailaolveira-crypto/agent-wps-reviewer` 有读取权限；
- 不索要、展示或复制仓库 Token；没有权限时停止并请用户添加 GitHub 协作者权限。

## macOS

下载最新预发布版中的 `*-macos.zip`，安装到用户目录中的版本化文件夹：

```bash
gh auth status
release_tag="$(gh release view --repo ismailaolveira-crypto/agent-wps-reviewer --json tagName --jq .tagName)"
install_root="$HOME/Applications/Agent WPS Reviewer/$release_tag"
mkdir -p "$install_root"
gh release download "$release_tag" --repo ismailaolveira-crypto/agent-wps-reviewer --pattern '*-macos.zip' --dir "$install_root" --clobber
gh release download "$release_tag" --repo ismailaolveira-crypto/agent-wps-reviewer --pattern '*-macos-manifest.json' --dir "$install_root" --clobber
zip_file="$(find "$install_root" -maxdepth 1 -name '*-macos.zip' -print -quit)"
manifest_file="$(find "$install_root" -maxdepth 1 -name '*-macos-manifest.json' -print -quit)"
expected_hash="$(node -e 'const fs=require("fs"); console.log(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).sha256)' "$manifest_file")"
actual_hash="$(shasum -a 256 "$zip_file" | awk '{print $1}')"
test "$actual_hash" = "$expected_hash" || { echo "SHA-256 校验失败"; exit 1; }
unzip -o "$install_root"/*-macos.zip -d "$install_root"
cd "$install_root"
bash setup.command
npm run doctor
```

只有 `npm run doctor` 返回 `ok: true`，并且 `mcpConfig.configured` 中包含 `workbuddy`，才算自动配置完成。

## Windows

在 PowerShell 中下载最新预发布版中的 `*-windows-x64.zip`：

```powershell
gh auth status
$ReleaseTag = gh release view --repo ismailaolveira-crypto/agent-wps-reviewer --json tagName --jq .tagName
$InstallRoot = Join-Path $env:LOCALAPPDATA "Agent WPS Reviewer\downloads\$ReleaseTag"
New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
gh release download $ReleaseTag --repo ismailaolveira-crypto/agent-wps-reviewer --pattern "*-windows-x64.zip" --dir $InstallRoot --clobber
gh release download $ReleaseTag --repo ismailaolveira-crypto/agent-wps-reviewer --pattern "*-windows-x64-manifest.json" --dir $InstallRoot --clobber
$Zip = Get-ChildItem $InstallRoot -Filter "*-windows-x64.zip" | Select-Object -First 1
$ManifestFile = Get-ChildItem $InstallRoot -Filter "*-windows-x64-manifest.json" | Select-Object -First 1
$ExpectedHash = (Get-Content $ManifestFile.FullName -Raw | ConvertFrom-Json).sha256
$ActualHash = (Get-FileHash $Zip.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
if ($ActualHash -ne $ExpectedHash.ToLowerInvariant()) { throw "SHA-256 校验失败" }
Expand-Archive -Path $Zip.FullName -DestinationPath $InstallRoot -Force
Set-Location $InstallRoot
cmd /c setup.cmd
npm run doctor
```

Windows 首次加载插件需要完成 WPS 官方 publish/trust 信任步骤。不得直接修改 `authaddin.json`。完成信任后重新运行 `npm run doctor`。

## WorkBuddy MCP 兜底配置

安装器会优先使用 WorkBuddy 官方 CodeBuddy CLI 配置 MCP：

```text
codebuddy mcp get agent-wps-reviewer
```

如果本机没有 `codebuddy` 命令，或上面的检查失败，停止自动配置并请用户在 WorkBuddy 中打开：

```text
Settings -> MCP -> Add MCP Server
```

添加本地 stdio server：

```text
名称：agent-wps-reviewer
命令：当前 Node.js 的绝对路径
参数：安装目录/bin/wps-reviewer-mcp.mjs
```

这是 WorkBuddy 官方支持的人工兜底路径。没有从 WorkBuddy 读回连接成功状态前，不得声称配置完成。

## 开始使用

配置成功后，先让用户打开目标 WPS 文档和“Agent 审阅”侧边栏，复制其中的 `WPS-XXXX-XXXX` 连接码。然后严格执行：

1. `get_wps_document_by_code`：用连接码绑定唯一文档；没有连接码时才调用 `list_wps_documents`；
2. `read_wps_document`：一次读取一个小节；
3. 对数据检查口径、分母、时间范围、来源和结论边界；数据意见必须带 `evidenceIds`；
4. 在聊天中提供 3–7 条候选意见，等待用户选择；
5. 对入选意见重读上下文，删除被上下文推翻的意见；
6. 展示最终批注文本并再次确认；
7. 只调用 `submit_wps_suggestions` 投递；
8. 调用 `list_wps_suggestions` 核对投递状态；
9. 明确提醒用户：只有在 WPS 侧边栏点击“接受”后，才会生成真实批注。

严禁调用开发兼容入口 `submit_wps_suggestion`。

## 完成标准

WorkBuddy 必须向用户报告以下结果，缺一项都不能称为完成：

- 下载的平台包名称和 Release tag；
- ZIP 哈希校验结果；
- `npm run doctor` 是否通过；
- `agent-wps-reviewer` MCP 是否从 WorkBuddy 读回为已配置；
- WPS 插件是否已安装/信任；
- Bridge 是否运行在 `127.0.0.1:17531`；
- 当前能否识别目标 WPS 文档；
- 仍需用户完成的 WPS 前台动作。
