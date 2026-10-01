$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskLog = Join-Path $taskRoot '.data/logs/preview-publication.log'
Set-Location -LiteralPath $taskRoot
New-Item -ItemType Directory -Path (Split-Path -Parent $taskLog) -Force | Out-Null
try {
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
    $taskFailure = @{status='failed';stage='wrapper';reason='task-wrapper-failed';errorType=$_.Exception.GetType().Name;secretsPrinted=$false}
    Add-Content -LiteralPath $taskLog -Value ($taskFailure | ConvertTo-Json -Compress) -Encoding utf8
    exit 1
} finally {
    if ($taskProcess) { $taskProcess.Dispose() }
}
