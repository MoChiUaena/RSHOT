param([string]$Profiles)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskLog = Join-Path $taskRoot '.data/logs/social-collection.log'
try {
    Set-Location -LiteralPath $taskRoot
    New-Item -ItemType Directory -Path (Split-Path -Parent $taskLog) -Force | Out-Null
    $taskInfo = New-Object System.Diagnostics.ProcessStartInfo
    $taskInfo.FileName = (Get-Command node -ErrorAction Stop).Source
    $taskInfo.Arguments = '--env-file-if-exists=.env "scripts/free-social.ts" --apply'
    if ($Profiles) {
        if (-not [IO.Path]::IsPathRooted($Profiles) -or $Profiles.Contains('"') -or $Profiles.Contains("`r") -or $Profiles.Contains("`n")) { throw 'unsafe' }
        $taskInfo.Arguments += ' --profiles "' + $Profiles + '"'
    }
    $taskInfo.WorkingDirectory = $taskRoot
    $taskInfo.UseShellExecute = $false
    $taskInfo.CreateNoWindow = $true
    $taskInfo.RedirectStandardOutput = $true
    $taskInfo.RedirectStandardError = $true
    $taskInfo.StandardOutputEncoding = New-Object System.Text.UTF8Encoding($false)
    $taskInfo.StandardErrorEncoding = New-Object System.Text.UTF8Encoding($false)
    foreach ($taskFlag in @('MODEL_CALLS_ENABLED','COLLECT_ENABLED','FEISHU_ENABLED','FEISHU_CONTENT_PUSH_ENABLED','INDEXNOW_SUBMIT_ENABLED')) { $taskInfo.EnvironmentVariables[$taskFlag] = 'false' }
    $taskProcess = New-Object System.Diagnostics.Process
    $taskProcess.StartInfo = $taskInfo
    $taskProcess.Start() | Out-Null
    $taskOutput = $taskProcess.StandardOutput.ReadToEndAsync()
    $taskError = $taskProcess.StandardError.ReadToEndAsync()
    $taskProcess.WaitForExit()
    $taskStdout = $taskOutput.GetAwaiter().GetResult()
    $taskStderr = $taskError.GetAwaiter().GetResult()
    $taskSummary = @{
        status = if ($taskProcess.ExitCode -eq 0) { 'completed' } else { 'failed' }
        exitCode = $taskProcess.ExitCode
        stdoutBytes = [Text.Encoding]::UTF8.GetByteCount($taskStdout)
        stderrBytes = [Text.Encoding]::UTF8.GetByteCount($taskStderr)
    } | ConvertTo-Json -Compress
    Add-Content -LiteralPath $taskLog -Value $taskSummary -Encoding utf8
    exit $taskProcess.ExitCode
} catch {
    if (Test-Path -LiteralPath (Split-Path -Parent $taskLog)) { Add-Content -LiteralPath $taskLog -Value '{"status":"failed","reason":"social-task-wrapper-failed"}' -Encoding utf8 }
    exit 1
} finally { if ($taskProcess) { $taskProcess.Dispose() } }
