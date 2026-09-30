param([switch]$Apply)
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw '此安装器只支持 Windows Task Scheduler。' }
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskName = 'RSHOT-Publish-Preview'
$taskFile = Join-Path $PSScriptRoot 'run-preview-task.ps1'
$taskPwsh = (Get-Command pwsh -ErrorAction Stop).Source
$taskUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$taskOffset = [TimeZoneInfo]::Local.GetUtcOffset([DateTime]::Now).TotalHours
if ($taskOffset -ne 8) { throw '本机时区不是北京时间；请先设置正确时区，再安装每日 08:30 的任务。' }
$taskArgument = '-NoProfile -NonInteractive -WindowStyle Hidden -File "' + $taskFile + '"'
$taskExisting = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($taskExisting) {
    $taskAction = @($taskExisting.Actions)[0]
    if ($taskAction.Execute -ne $taskPwsh -or $taskAction.Arguments -ne $taskArgument -or $taskAction.WorkingDirectory -ne $taskRoot) {
        throw '已有同名任务但配置不同；请先人工核对，不会覆盖。'
    }
    Write-Output 'RSHOT 预览发布任务已经存在，未改动。'
    exit 0
}
if (-not $Apply) {
    Write-Output "准备创建 $taskName：每天北京时间 08:30，当前用户 $taskUser 登录且电脑运行时执行。不会运行发布。"
    exit 0
}
$taskAction = New-ScheduledTaskAction -Execute $taskPwsh -Argument $taskArgument -WorkingDirectory $taskRoot
$taskTrigger = New-ScheduledTaskTrigger -Daily -At '08:30'
$taskSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 3) -MultipleInstances IgnoreNew
$taskPrincipal = New-ScheduledTaskPrincipal -UserId $taskUser -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $taskTrigger -Settings $taskSettings -Principal $taskPrincipal `
    -Description 'RSHOT: publish the validated public Pages snapshot after the Beijing daily report' | Out-Null
Write-Output "已创建 $taskName；下次计划运行时间：$((Get-ScheduledTaskInfo -TaskName $taskName).NextRunTime.ToString('o'))"
