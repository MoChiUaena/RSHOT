$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskLogDir = Join-Path $taskRoot '.data/logs'
Set-Location -LiteralPath $taskRoot
New-Item -ItemType Directory -Path $taskLogDir -Force | Out-Null
if (-not (Test-Path -LiteralPath '.env') -or -not (Test-Path -LiteralPath 'apps/web/build/server/index.js')) {
    throw 'RSHOT 本地配置或网页构建不存在。'
}

# Touch only this project's previously named development database.
$taskInspect = & docker.exe container inspect rshot-dev-db 2>$null
if ($LASTEXITCODE -ne 0) { throw 'rshot-dev-db 不存在或 Docker Desktop 尚未启动。' }
$taskDb = @($taskInspect | ConvertFrom-Json)[0]
$taskBindings = @($taskDb.HostConfig.PortBindings.'5432/tcp')
if ($taskDb.Config.Image -notmatch '^postgres:1[67](\.\d+)?-alpine$' -or $taskBindings.Count -ne 1 -or
    $taskBindings[0].HostIp -ne '127.0.0.1' -or $taskBindings[0].HostPort -ne '18777') {
    throw 'rshot-dev-db 的镜像或端口与本项目记录不符。'
}
if (-not $taskDb.State.Running) {
    & docker.exe start rshot-dev-db | Out-Null
    if ($LASTEXITCODE -ne 0) { throw '本地数据库未能启动。' }
}
$taskDeadline = [DateTime]::UtcNow.AddSeconds(50)
$taskDbReady = $false
while ([DateTime]::UtcNow -lt $taskDeadline) {
    & docker.exe exec rshot-dev-db pg_isready -U postgres -d rshot_dev 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $taskDbReady = $true; break }
    Start-Sleep -Seconds 2
}
if (-not $taskDbReady) { throw '本地数据库未在 50 秒内就绪。' }

$taskRecordFile = Join-Path $taskRoot '.data/local-processes.json'
$taskRecord = if (Test-Path -LiteralPath $taskRecordFile) { Get-Content -LiteralPath $taskRecordFile -Encoding UTF8 -Raw | ConvertFrom-Json } else { $null }
function Test-OwnedService([int]$taskPort, [int]$taskExpectedId, [string]$taskExpectedCommand) {
    $taskOwners = @(Get-NetTCPConnection -State Listen -LocalPort $taskPort -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
    if ($taskOwners.Count -eq 0) { return $false }
    if ($taskOwners.Count -ne 1 -or -not $taskRecord -or $taskRecord.root -ne $taskRoot -or $taskOwners[0] -ne $taskExpectedId) {
        throw "端口 $taskPort 存在非本项目进程，未改动。"
    }
    $taskProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$taskExpectedId"
    if (-not $taskProcess -or $taskProcess.CommandLine -notmatch [regex]::Escape($taskExpectedCommand)) {
        throw "端口 $taskPort 的进程命令不符，未改动。"
    }
    return $true
}
$taskApi = Test-OwnedService 3001 ([int]$taskRecord.api) 'apps/api/src/main.ts'
$taskWeb = Test-OwnedService 3000 ([int]$taskRecord.web) '--env-file=../../.env server.ts'
$taskNode = (Get-Command node.exe -ErrorAction Stop).Source
if (-not $taskApi -and -not $taskWeb) {
    & (Join-Path $PSScriptRoot 'start-local.ps1') | Out-Null
    if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw '本地网页和 API 启动失败。' }
} elseif (-not $taskApi -or -not $taskWeb) {
    if (-not $taskRecord -or $taskRecord.root -ne $taskRoot) { throw '缺少本项目服务进程记录。' }
    if (-not $taskApi) {
        $taskStarted = Start-Process -FilePath $taskNode -ArgumentList '--env-file=.env','apps/api/src/main.ts' -WorkingDirectory $taskRoot `
            -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskLogDir 'api-autostart.log') `
            -RedirectStandardError (Join-Path $taskLogDir 'api-autostart-error.log')
        $taskRecord.api = $taskStarted.Id
    }
    if (-not $taskWeb) {
        $taskStarted = Start-Process -FilePath $taskNode -ArgumentList '--env-file=../../.env','server.ts' `
            -WorkingDirectory (Join-Path $taskRoot 'apps/web') -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput (Join-Path $taskLogDir 'web-autostart.log') `
            -RedirectStandardError (Join-Path $taskLogDir 'web-autostart-error.log')
        $taskRecord.web = $taskStarted.Id
    }
    $taskRecord.startedAt = (Get-Date).ToString('o')
    $taskRecord | ConvertTo-Json | Set-Content -LiteralPath $taskRecordFile -Encoding utf8
}
$taskDeadline = [DateTime]::UtcNow.AddSeconds(30)
$taskSiteReady = $false
while ([DateTime]::UtcNow -lt $taskDeadline) {
    try {
        $taskResponse = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3000/api/health' -TimeoutSec 3
        if ($taskResponse.StatusCode -eq 200) { $taskSiteReady = $true; break }
    } catch { }
    Start-Sleep -Seconds 2
}
if (-not $taskSiteReady) { throw '本地网页未在 30 秒内就绪。' }

$taskWorkerFile = Join-Path $taskRoot '.data/updates-worker.json'
$taskWorkerRecord = if (Test-Path -LiteralPath $taskWorkerFile) { Get-Content -LiteralPath $taskWorkerFile -Encoding UTF8 -Raw | ConvertFrom-Json } else { $null }
$taskOwnedWorker = $false
if ($taskWorkerRecord -and $taskWorkerRecord.root -eq $taskRoot) {
    $taskChild = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$taskWorkerRecord.pid)"
    $taskParent = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$taskWorkerRecord.launcherPid)"
    $taskOwnedWorker = $taskChild -and $taskParent -and $taskChild.ParentProcessId -eq $taskParent.ProcessId -and
        $taskChild.CommandLine -match 'apps/worker/src/main.ts' -and $taskParent.CommandLine -match 'scripts/start-updates.ts --live --fast'
}
if ($taskOwnedWorker) {
    $taskStatus = & $taskNode '--env-file=.env' 'scripts/updates-status.ts' | ConvertFrom-Json
    if (-not $taskStatus.worker.active) { throw 'worker 仍在运行但心跳不活跃，未启动第二个 worker。' }
    Write-Output 'RSHOT 服务和 worker 已运行，未重复启动。'
    exit 0
}
$taskDeadline = [DateTime]::UtcNow.AddMinutes(3)
while ([DateTime]::UtcNow -lt $taskDeadline) {
    $taskStatus = & $taskNode '--env-file=.env' 'scripts/updates-status.ts' | ConvertFrom-Json
    if (-not $taskStatus.worker.active) { break }
    Start-Sleep -Seconds 5
}
if ($taskStatus.worker.active) { throw '数据库仍显示旧 worker 心跳；未启动第二个 worker。' }
$taskLauncher = Start-Process -FilePath $taskNode -ArgumentList 'scripts/start-updates.ts','--live','--fast' -WorkingDirectory $taskRoot `
    -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskLogDir 'updates-autostart.log') `
    -RedirectStandardError (Join-Path $taskLogDir 'updates-autostart-error.log')
$taskDeadline = [DateTime]::UtcNow.AddSeconds(35)
while ([DateTime]::UtcNow -lt $taskDeadline) {
    Start-Sleep -Seconds 2
    $taskLauncher.Refresh()
    if ($taskLauncher.HasExited) { throw 'worker 启动器已退出；请查看本地日志。' }
    $taskState = Get-Content -LiteralPath $taskWorkerFile -Encoding UTF8 -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json
    if ($taskState -and $taskState.launcherPid -eq $taskLauncher.Id) {
        $taskStatus = & $taskNode '--env-file=.env' 'scripts/updates-status.ts' | ConvertFrom-Json
        if ($taskStatus.worker.active) {
            Write-Output 'RSHOT 数据库、网页、API 和受限 worker 已恢复。'
            exit 0
        }
    }
}
throw 'worker 未在 35 秒内写入活跃心跳。'
