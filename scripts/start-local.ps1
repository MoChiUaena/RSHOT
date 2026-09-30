$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot
if (-not (Test-Path -LiteralPath (Join-Path $taskRoot '.env'))) { throw '先运行 node scripts/init-env.ts 并配置本地数据库。' }
if (-not (Test-Path -LiteralPath (Join-Path $taskRoot 'apps/web/build/server/index.js'))) { throw '先运行 npm run build -w @aihot/web。' }
$taskPorts = Get-NetTCPConnection -State Listen -LocalPort 3000,3001 -ErrorAction SilentlyContinue
if ($taskPorts) { throw '3000 或 3001 已有进程监听；请先检查已启动的 RSHOT 服务。' }
$taskLogDir = Join-Path $taskRoot '.data/logs'
New-Item -ItemType Directory -Path $taskLogDir -Force | Out-Null
$taskNode = (Get-Command node).Source
$taskApi = Start-Process -FilePath $taskNode -ArgumentList '--env-file=.env','apps/api/src/main.ts' -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskLogDir 'api.log') -RedirectStandardError (Join-Path $taskLogDir 'api-error.log')
$taskWeb = Start-Process -FilePath $taskNode -ArgumentList '--env-file=../../.env','server.ts' -WorkingDirectory (Join-Path $taskRoot 'apps/web') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskLogDir 'web.log') -RedirectStandardError (Join-Path $taskLogDir 'web-error.log')
@{ api = $taskApi.Id; web = $taskWeb.Id; startedAt = (Get-Date).ToString('o'); root = $taskRoot } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskRoot '.data/local-processes.json') -Encoding utf8
$taskDeadline = [DateTime]::UtcNow.AddSeconds(20)
$taskReady = $false
while ([DateTime]::UtcNow -lt $taskDeadline) {
    $taskApi.Refresh(); $taskWeb.Refresh()
    if ($taskApi.HasExited -or $taskWeb.HasExited) { throw '服务已退出，请查看 .data/logs/ 中的错误日志。' }
    try { $taskResponse = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3000/api/health' -TimeoutSec 2; if ($taskResponse.StatusCode -eq 200) { $taskReady = $true; break } } catch { }
    Start-Sleep -Milliseconds 200
}
if (-not $taskReady) { throw '启动未在20秒内就绪，请查看 .data/logs/。' }
Write-Output 'RSHOT 已启动：http://localhost:3000。日志在 .data/logs/。'
