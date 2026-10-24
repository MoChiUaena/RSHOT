$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskLog = Join-Path $taskRoot '.data/logs/preview-publication.log'
Set-Location -LiteralPath $taskRoot
New-Item -ItemType Directory -Path (Split-Path -Parent $taskLog) -Force | Out-Null
function Resume-RshotForPublication {
    $taskResume = Get-ScheduledTask -TaskName 'RSHOT-Resume-Local' -ErrorAction Stop
    $taskResumeAction = @($taskResume.Actions)[0]
    $taskResumeFile = Join-Path $taskRoot 'scripts/run-resume-task.ps1'
    if ($taskResumeAction.WorkingDirectory -ne $taskRoot -or
        -not $taskResumeAction.Arguments.Contains('"' + $taskResumeFile + '"')) {
        throw 'local-recovery-task-mismatch'
    }
    $taskPrevious = Get-ScheduledTaskInfo -TaskName 'RSHOT-Resume-Local'
    $taskAlreadyRunning = $taskResume.State -eq 'Running'
    if (-not $taskAlreadyRunning) { Start-ScheduledTask -TaskName 'RSHOT-Resume-Local' }
    $taskRecoveryDeadline = [DateTime]::UtcNow.AddMinutes(5)
    do {
        $taskCurrent = Get-ScheduledTask -TaskName 'RSHOT-Resume-Local'
        $taskCurrentInfo = Get-ScheduledTaskInfo -TaskName 'RSHOT-Resume-Local'
        if (($taskAlreadyRunning -or $taskCurrentInfo.LastRunTime -gt $taskPrevious.LastRunTime) -and
            $taskCurrent.State -ne 'Running' -and $taskCurrentInfo.LastTaskResult -ne 267009) {
            if ($taskCurrentInfo.LastTaskResult -ne 0) { throw 'local-recovery-failed' }
            return
        }
        Start-Sleep -Seconds 2
    } while ([DateTime]::UtcNow -lt $taskRecoveryDeadline)
    throw 'local-recovery-timeout'
}
$taskStage = 'recovery'
try {
    Resume-RshotForPublication
    $taskStage = 'publication'
    $taskNode = (Get-Command node -ErrorAction Stop).Source
    # Read both pipes concurrently; native stderr is data, not a PowerShell exception.
    $taskInfo = New-Object System.Diagnostics.ProcessStartInfo
    $taskInfo.FileName = $taskNode
    $taskInfo.Arguments = '"scripts/publish-preview.ts" --live'
    $taskInfo.WorkingDirectory = $taskRoot
    $taskInfo.UseShellExecute = $false
    $taskInfo.CreateNoWindow = $true
    $taskInfo.RedirectStandardOutput = $true
    $taskInfo.RedirectStandardError = $true
    $taskInfo.StandardOutputEncoding = New-Object System.Text.UTF8Encoding($false)
    $taskInfo.StandardErrorEncoding = New-Object System.Text.UTF8Encoding($false)
    $taskProcess = New-Object System.Diagnostics.Process
    $taskProcess.StartInfo = $taskInfo
    $taskProcess.Start() | Out-Null
    $taskOutput = $taskProcess.StandardOutput.ReadToEndAsync()
    $taskError = $taskProcess.StandardError.ReadToEndAsync()
    $taskProcess.WaitForExit()
    foreach ($taskStream in @($taskOutput, $taskError)) {
        $taskText = $taskStream.GetAwaiter().GetResult()
        if ($taskText) { Add-Content -LiteralPath $taskLog -Value $taskText.TrimEnd() -Encoding utf8 }
    }
    exit $taskProcess.ExitCode
} catch {
    $taskReason = if ($_.Exception.Message -match '^local-recovery-[a-z-]+$') { $_.Exception.Message } else { 'task-wrapper-failed' }
    $taskFailure = @{status='failed';stage=$taskStage;reason=$taskReason;errorType=$_.Exception.GetType().Name;secretsPrinted=$false}
    Add-Content -LiteralPath $taskLog -Value ($taskFailure | ConvertTo-Json -Compress) -Encoding utf8
    exit 1
} finally {
    if ($taskProcess) { $taskProcess.Dispose() }
}
