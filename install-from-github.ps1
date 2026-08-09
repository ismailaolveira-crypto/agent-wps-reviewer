$ErrorActionPreference = "Stop"

$Repository = if ($env:AGENT_WPS_REPOSITORY) { $env:AGENT_WPS_REPOSITORY } else { "ismailaolveira-crypto/agent-wps-reviewer" }
$InstallRoot = if ($env:AGENT_WPS_INSTALL_ROOT) { $env:AGENT_WPS_INSTALL_ROOT } else { Join-Path $env:LOCALAPPDATA "Agent WPS Reviewer" }
$FetcherApi = "https://api.github.com/repos/$Repository/contents/scripts/download-latest-release.mjs?ref=main"

$Node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $Node) {
  $Candidates = @(
    (Join-Path $env:ProgramFiles "nodejs\node.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\nodejs\node.exe")
  )
  $Node = $Candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $Node) { throw "需要先安装 Node.js 20 或更高版本。" }
$Major = [int](& $Node -p 'process.versions.node.split(".")[0]')
if ($Major -lt 20) { throw "Node.js 版本不足 20。" }

New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
$InstallRoot = (Resolve-Path $InstallRoot).Path
$OwnFetcher = -not $env:AGENT_WPS_FETCHER_PATH
$Fetcher = if ($OwnFetcher) { Join-Path $env:TEMP "agent-wps-download-$PID.mjs" } else { $env:AGENT_WPS_FETCHER_PATH }

try {
  if ($OwnFetcher) {
    Invoke-WebRequest -UseBasicParsing -Uri $FetcherApi -Headers @{
      Accept = "application/vnd.github.raw+json"
      "User-Agent" = "agent-wps-reviewer-bootstrap"
    } -OutFile $Fetcher
  }
  Write-Host "正在从 GitHub 下载并校验 Agent 白皮书审阅助手……"
  $ResultText = (& $Node $Fetcher --platform windows --dir (Join-Path $InstallRoot "downloads") --repo $Repository) | Out-String
  $Result = $ResultText | ConvertFrom-Json
  $ZipPath = (Resolve-Path $Result.zipPath).Path
  if (-not $ZipPath.StartsWith($InstallRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "下载文件不在受控安装目录。"
  }
  $ReleaseDir = Split-Path -Parent $ZipPath
  Expand-Archive -Path $ZipPath -DestinationPath $ReleaseDir -Force
  $SetupPath = Join-Path $ReleaseDir "setup.cmd"
  if (-not (Test-Path $SetupPath)) { throw "下载包缺少 setup.cmd。" }

  $SetupArgs = @()
  if ($env:AGENT_WPS_SETUP_DIR) { $SetupArgs += @("--dir", $env:AGENT_WPS_SETUP_DIR) }
  if ($env:AGENT_WPS_SKILL_TARGET) { $SetupArgs += @("--skill-target", $env:AGENT_WPS_SKILL_TARGET) }
  if ($env:AGENT_WPS_PORT) { $SetupArgs += @("--port", $env:AGENT_WPS_PORT) }

  Write-Host "校验通过：$($Result.tag) / $($Result.sha256)"
  & $SetupPath @SetupArgs
  if ($LASTEXITCODE -ne 0) { throw "统一安装器未通过，请保留上方诊断信息。" }
  Write-Host "一键安装完成。已配置本机检测到的 Codex、Claude Code 或 WorkBuddy；现在打开 WPS 的“Agent 审阅”。"
}
finally {
  if ($OwnFetcher -and (Test-Path $Fetcher)) { Remove-Item -Force $Fetcher }
}
