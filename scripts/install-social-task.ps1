param([switch]$Apply, [string]$Profiles)
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -eq 5) { $env:PSModulePath = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/Modules' }
try {
    if ([Environment]::OSVersion.Platform -ne 'Win32NT') { throw 'unsupported' }
    $taskRoot = Split-Path -Parent $PSScriptRoot
    $taskName = 'RSHOT-Collect-Social'
    $taskFile = Join-Path $PSScriptRoot 'run-social-task.ps1'
    $taskPwsh = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
    $taskNode = (Get-Command node -ErrorAction Stop).Source
    $taskUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $taskArguments = @((Join-Path $PSScriptRoot 'free-social.ts'), '--ready')
    if ($Profiles) {
        if (-not [IO.Path]::IsPathRooted($Profiles) -or $Profiles.Contains('"') -or $Profiles.Contains("`r") -or $Profiles.Contains("`n")) { throw 'unsafe' }
        $taskArguments += @('--profiles', $Profiles)
    }
    & $taskNode @taskArguments | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'not-ready' }
    $taskArgument = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy RemoteSigned -File "' + $taskFile + '"'
    if ($Profiles) { $taskArgument += ' -Profiles "' + $Profiles + '"' }
    $taskExisting = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($taskExisting) {
        $taskAction = @($taskExisting.Actions)
        $taskOwners = @($taskUser, [Environment]::UserName, [Security.Principal.WindowsIdentity]::GetCurrent().User.Value)
        if ($taskAction.Count -ne 1 -or $taskAction[0].Execute -ne $taskPwsh -or $taskAction[0].Arguments -ne $taskArgument -or
            $taskAction[0].WorkingDirectory -ne $taskRoot -or $taskExisting.Principal.UserId -notin $taskOwners -or
            $taskExisting.Principal.LogonType -ne 'Interactive' -or $taskExisting.Principal.RunLevel -ne 'Limited') { throw 'existing-task-mismatch' }
        $taskTimes = @($taskExisting.Triggers | ForEach-Object { ([DateTime]$_.StartBoundary).ToString('HH:mm') } | Sort-Object)
        if (($taskTimes -join ',') -ne '10:30' -or @($taskExisting.Triggers | Where-Object { $_.DaysInterval -ne 1 }).Count -gt 0 -or
            -not $taskExisting.Settings.Hidden -or $taskExisting.Settings.MultipleInstances -ne 'IgnoreNew') { throw 'existing-task-mismatch' }
        Write-Output '{"status":"already-installed"}'; exit 0
    }
    if (-not $Apply) { Write-Output '{"status":"ready-to-install","times":["10:30"]}'; exit 0 }
    $taskAction = New-ScheduledTaskAction -Execute $taskPwsh -Argument $taskArgument -WorkingDirectory $taskRoot
    $taskTriggers = @((New-ScheduledTaskTrigger -Daily -At '10:30'))
    $taskSettings = New-ScheduledTaskSettingsSet -Hidden -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -MultipleInstances IgnoreNew
    $taskPrincipal = New-ScheduledTaskPrincipal -UserId $taskUser -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $taskTriggers -Settings $taskSettings -Principal $taskPrincipal -Description 'RSHOT read-only verified social sources; existing worker processes queued material' | Out-Null
    Write-Output '{"status":"installed","times":["10:30"]}'
} catch { Write-Output '{"status":"failed","reason":"social-task-install-rejected"}'; exit 1 }
