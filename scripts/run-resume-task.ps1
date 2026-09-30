param([string]$ModelFile)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskLog = Join-Path $taskRoot '.data/logs/local-resume-events.log'
Set-Location -LiteralPath $taskRoot
New-Item -ItemType Directory -Path (Split-Path -Parent $taskLog) -Force | Out-Null
try {
    if (-not $ModelFile -or -not (Test-Path -LiteralPath $ModelFile -PathType Leaf)) { throw 'model-file-unavailable' }
    $env:RSHOT_MODEL_FILE = [System.IO.Path]::GetFullPath($ModelFile)
    $taskOutput = & (Join-Path $PSScriptRoot 'resume-local.ps1') 2>&1
    if ($taskOutput) { $taskOutput | Out-File -LiteralPath $taskLog -Append -Encoding utf8 }
    exit $LASTEXITCODE
} catch {
    $taskKind = $_.Exception.GetType().Name
    $taskLine = if ($_.ScriptStackTrace -match 'resume-local\.ps1: line (\d+)') { $Matches[1] } else { 'unknown' }
    $taskReason = $_.Exception.Message
    if ($taskReason -match '(?i)(api[_-]?key|token|secret|password|sk-[a-z0-9])') { $taskReason = '[redacted]' }
    Add-Content -LiteralPath $taskLog -Value "local-resume-failed:${taskKind}:line_${taskLine}:$taskReason" -Encoding utf8
    exit 1
}
