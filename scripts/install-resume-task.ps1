param([switch]$Apply)
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw '此安装器只支持 Windows Task Scheduler。' }
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskName = 'RSHOT-Resume-Local'
$taskFile = Join-Path $PSScriptRoot 'run-resume-task.ps1'
$taskPwsh = (Get-Command powershell.exe -ErrorAction Stop).Source
$taskUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$taskModelFile = Join-Path (Split-Path -Parent $taskRoot) 'RSHOT-private/models.env'
if (-not (Test-Path -LiteralPath $taskModelFile -PathType Leaf)) { throw '登录任务专用的私有模型文件不存在；先运行 scripts/prepare-resume-model.ps1 -Apply。' }
$taskArgument = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy RemoteSigned -File "' + $taskFile + '" -ModelFile "' + $taskModelFile + '"'
$taskLegacyArgument = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy RemoteSigned -File "' + $taskFile + '"'
$taskOldModelFile = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'RSHOT/models.env'
$taskOldModelArgument = $taskLegacyArgument + ' -ModelFile "' + $taskOldModelFile + '"'
$taskExisting = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($taskExisting) {
    $taskAction = @($taskExisting.Actions)[0]
    $taskOwners = @($taskUser, [Environment]::UserName, [Security.Principal.WindowsIdentity]::GetCurrent().User.Value)
    if ($taskAction.Execute -ne $taskPwsh -or $taskAction.Arguments -notin @($taskArgument, $taskLegacyArgument, $taskOldModelArgument) -or
        $taskAction.WorkingDirectory -ne $taskRoot -or $taskExisting.Principal.UserId -notin $taskOwners) {
        throw '已有同名任务但配置不同；请先人工核对，不会覆盖。'
    }
    if ($taskAction.Arguments -eq $taskArgument) {
        Write-Output 'RSHOT 本机恢复任务已经存在，未改动。'
        exit 0
    }
    if (-not $Apply) {
        Write-Output '已有本项目任务；准备改为当前任务可读的仓库外模型文件路径，不会存储密钥。'
        exit 0
    }
    $taskUpdatedAction = New-ScheduledTaskAction -Execute $taskPwsh -Argument $taskArgument -WorkingDirectory $taskRoot
    Set-ScheduledTask -TaskName $taskName -Action $taskUpdatedAction | Out-Null
    Write-Output '已更新 RSHOT 本机恢复任务；只保存模型文件路径，不保存密钥内容。'
    exit 0
}
if (-not $Apply) {
    Write-Output "准备创建 $taskName：当前用户 $taskUser 登录后恢复本机 RSHOT 数据库、网页和受限 worker；不会立即重启。"
    exit 0
}
$taskAction = New-ScheduledTaskAction -Execute $taskPwsh -Argument $taskArgument -WorkingDirectory $taskRoot
$taskTrigger = New-ScheduledTaskTrigger -AtLogOn -User $taskUser
$taskSettings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -MultipleInstances IgnoreNew `
    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5)
$taskPrincipal = New-ScheduledTaskPrincipal -UserId $taskUser -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $taskTrigger -Settings $taskSettings -Principal $taskPrincipal `
    -Description 'RSHOT: resume the local development database, web, API and bounded worker after sign-in' | Out-Null
Write-Output "已创建 $taskName；只在当前用户登录后运行。"
