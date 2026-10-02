param([string]$PrivateRoot)
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -eq 5) { $env:PSModulePath = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/Modules' }
try {
    if ([Environment]::OSVersion.Platform -ne 'Win32NT') { throw 'unsupported' }
    $taskRepo = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
    if (-not $PrivateRoot) { $PrivateRoot = Join-Path (Split-Path -Parent $taskRepo) 'RSHOT-private' }
    if (-not [IO.Path]::IsPathRooted($PrivateRoot)) { throw 'unsafe' }
    $taskPrivate = [IO.Path]::GetFullPath($PrivateRoot).TrimEnd('\')
    if ($taskPrivate -eq $taskRepo -or $taskPrivate.StartsWith($taskRepo + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'unsafe' }
    $taskCursor = $taskPrivate
    while ($taskCursor) {
        if (Test-Path -LiteralPath $taskCursor) {
            if ((Get-Item -LiteralPath $taskCursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'unsafe' }
        }
        $taskParent = Split-Path -Parent $taskCursor
        if ($taskParent -eq $taskCursor) { break }; $taskCursor = $taskParent
    }
    $taskSocial = Join-Path $taskPrivate 'social'
    if ((Test-Path -LiteralPath $taskSocial) -and ((Get-Item -LiteralPath $taskSocial -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'unsafe' }
    $taskCreatedPrivate = -not (Test-Path -LiteralPath $taskPrivate)
    New-Item -ItemType Directory -Path $taskSocial -Force | Out-Null
    $taskUserSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $taskSystemSid = New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
    $taskAcl = New-Object Security.AccessControl.DirectorySecurity
    $taskAcl.SetAccessRuleProtection($true, $false)
    foreach ($taskSid in @($taskUserSid, $taskSystemSid)) {
        $taskRule = New-Object Security.AccessControl.FileSystemAccessRule($taskSid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $taskAcl.AddAccessRule($taskRule)
    }
    [IO.Directory]::SetAccessControl($taskSocial, $taskAcl)
    if ($taskCreatedPrivate) { [IO.Directory]::SetAccessControl($taskPrivate, $taskAcl) }
    $taskCollectors = Join-Path $taskSocial 'collectors.env'
    $taskWeRSS = Join-Path $taskSocial 'werss.env'
    $taskProfiles = Join-Path $taskSocial 'profiles.json'
    foreach ($taskFile in @($taskCollectors, $taskWeRSS, $taskProfiles)) {
        if ((Test-Path -LiteralPath $taskFile) -and ((Get-Item -LiteralPath $taskFile -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'unsafe' }
    }
    foreach ($taskFile in @($taskCollectors, $taskWeRSS)) {
        if (-not (Test-Path -LiteralPath $taskFile)) { [IO.File]::WriteAllText($taskFile, '', (New-Object Text.UTF8Encoding($false))) }
    }
    if (-not (Test-Path -LiteralPath $taskProfiles)) {
        $taskCatalog = Get-Content -LiteralPath (Join-Path $taskRepo 'industry/social-sources.json') -Encoding UTF8 -Raw | ConvertFrom-Json
        $taskProfile = @{ version = 1; twitter = @{executable = (Join-Path $taskPrivate 'twitter-venv/Scripts/twitter.exe'); credentialsFile = $taskCollectors}; werss = @{credentialsFile = $taskWeRSS}; sources = @($taskCatalog.sources | ForEach-Object { @{sourceId=$_.id;verified=$false} }) }
        [IO.File]::WriteAllText($taskProfiles, ($taskProfile | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding($false)))
    }
    # Existing files retain their bytes but receive the same restricted ACL.
    foreach ($taskFile in @($taskCollectors, $taskWeRSS, $taskProfiles)) {
        $taskFileAcl = New-Object Security.AccessControl.FileSecurity
        $taskFileAcl.SetAccessRuleProtection($true, $false)
        foreach ($taskSid in @($taskUserSid, $taskSystemSid)) { $taskFileAcl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($taskSid, 'FullControl', 'Allow'))) }
        [IO.File]::SetAccessControl($taskFile, $taskFileAcl)
    }
    # certifi is public CA material. Move its bytes to a fixed ASCII home path for curl_cffi on Windows.
    $taskCaSource = Join-Path $taskPrivate 'twitter-venv/Lib/site-packages/certifi/cacert.pem'
    if (Test-Path -LiteralPath $taskCaSource) {
        $taskCaDirectory = Join-Path $env:USERPROFILE '.rshot-social-public'
        $taskCaTarget = Join-Path $taskCaDirectory 'cacert.pem'
        if ($taskCaTarget -match '[^\x20-\x7e]' -or $taskCaTarget.StartsWith($taskRepo + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'unsafe' }
        foreach ($taskCaPath in @($taskCaSource,$taskCaTarget)) {
            $taskCursor = $taskCaPath
            while ($taskCursor) {
                if ((Test-Path -LiteralPath $taskCursor) -and ((Get-Item -LiteralPath $taskCursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'unsafe' }
                $taskParent = Split-Path -Parent $taskCursor; if ($taskParent -eq $taskCursor) {break}; $taskCursor=$taskParent
            }
        }
        $taskCaBytes = [IO.File]::ReadAllBytes($taskCaSource)
        if ($taskCaBytes.Length -gt 2097152) { throw 'unsafe' }
        $taskCaMatch = [regex]::Match([Text.Encoding]::UTF8.GetString($taskCaBytes), '-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----')
        if (-not $taskCaMatch.Success) {throw 'unsafe'}
        $taskCertificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new([Convert]::FromBase64String($taskCaMatch.Groups[1].Value))
        $taskCertificate.Dispose()
        New-Item -ItemType Directory -Path $taskCaDirectory -Force | Out-Null
        [IO.Directory]::SetAccessControl($taskCaDirectory, $taskAcl)
        [IO.File]::WriteAllBytes($taskCaTarget,$taskCaBytes)
        [IO.File]::SetAccessControl($taskCaTarget,$taskFileAcl)
    }
    Write-Output '{"status":"prepared","verified":false}'
} catch { Write-Output '{"status":"failed","reason":"social-preparation-rejected"}'; exit 1 }
