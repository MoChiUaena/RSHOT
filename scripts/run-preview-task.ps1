$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskLog = Join-Path $taskRoot '.data/logs/preview-publication.log'
Set-Location -LiteralPath $taskRoot
New-Item -ItemType Directory -Path (Split-Path -Parent $taskLog) -Force | Out-Null
try {
    $taskNode = (Get-Command node -ErrorAction Stop).Source
    & $taskNode 'scripts/publish-preview.ts' '--live' *>> $taskLog
    exit $LASTEXITCODE
} catch {
    Add-Content -LiteralPath $taskLog -Value 'task-wrapper-failed' -Encoding utf8
    exit 1
}
