param([switch]$Apply)
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw '此工具只支持 Windows。' }
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskWorkspace = Split-Path -Parent $taskRoot
$taskPrivate = [System.IO.Path]::GetFullPath((Join-Path $taskWorkspace 'RSHOT-private'))
$taskOriginal = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'RSHOT/models.env'
$taskTarget = Join-Path $taskPrivate 'models.env'
$taskAccount = [Security.Principal.WindowsIdentity]::GetCurrent().Name
if (-not $taskPrivate.StartsWith($taskWorkspace+[System.IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or
    $taskPrivate.StartsWith($taskRoot+[System.IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or
    -not (Test-Path -LiteralPath $taskOriginal -PathType Leaf)) { throw '模型文件路径不符合仓库外存储要求。' }
$taskSame = (Test-Path -LiteralPath $taskTarget -PathType Leaf) -and
    ((Get-FileHash -LiteralPath $taskOriginal).Hash -eq (Get-FileHash -LiteralPath $taskTarget).Hash)
if (-not $Apply) {
    Write-Output $(if ($taskSame) { '登录任务的私有模型副本已是最新版。' } else { '准备更新仓库外的登录任务模型副本；添加 -Apply 才写入。' })
    exit 0
}
New-Item -ItemType Directory -Path $taskPrivate -Force | Out-Null
& icacls.exe $taskPrivate /grant:r "${taskAccount}:(OI)(CI)F" 'NT AUTHORITY\SYSTEM:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw '私有目录访问控制设置失败。' }
& icacls.exe $taskPrivate /inheritance:r | Out-Null
if ($LASTEXITCODE -ne 0) { throw '私有目录继承控制失败。' }
$taskDirectoryAcl = Get-Acl -LiteralPath $taskPrivate
if (-not $taskDirectoryAcl.AreAccessRulesProtected) { throw '私有目录仍继承额外访问权限。' }
if (-not $taskSame) { Copy-Item -LiteralPath $taskOriginal -Destination $taskTarget -Force -ErrorAction Stop }
& icacls.exe $taskTarget /reset | Out-Null
if ($LASTEXITCODE -ne 0) { throw '模型副本访问控制重置失败。' }
& icacls.exe $taskTarget /inheritance:r | Out-Null
if ($LASTEXITCODE -ne 0) { throw '模型副本继承控制失败。' }
& icacls.exe $taskTarget /grant:r "${taskAccount}:F" 'NT AUTHORITY\SYSTEM:F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw '模型副本访问控制设置失败。' }
$taskFileAcl = Get-Acl -LiteralPath $taskTarget
if (-not $taskFileAcl.AreAccessRulesProtected -or
    (Get-FileHash -LiteralPath $taskOriginal).Hash -ne (Get-FileHash -LiteralPath $taskTarget).Hash) {
    throw '模型副本或访问控制核验失败。'
}
Write-Output '仓库外的私有模型副本已更新；没有在 Git 仓库内保存密钥。'
