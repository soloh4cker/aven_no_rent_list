#requires -version 5.1

$ErrorActionPreference = 'Stop'

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdministrator)) {
    $arguments = @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', ('"{0}"' -f $PSCommandPath)
    )
    Start-Process -FilePath 'powershell.exe' -ArgumentList ($arguments -join ' ') -Verb RunAs
    exit
}

$installRoot = Join-Path $env:ProgramData 'DaysInn\AvenNoRent'
$extensionDirectory = Join-Path $installRoot 'Extension'
$hostDirectory = Join-Path $installRoot 'NativeHost'
$registryPath = 'HKLM:\SOFTWARE\Google\Chrome\NativeMessagingHosts\com.daysinn.aven_no_rent'

if (Test-Path -LiteralPath $registryPath) {
    Remove-Item -LiteralPath $registryPath -Recurse -Force
}

if (Test-Path -LiteralPath $extensionDirectory) {
    Remove-Item -LiteralPath $extensionDirectory -Recurse -Force
}

if (Test-Path -LiteralPath $hostDirectory) {
    Remove-Item -LiteralPath $hostDirectory -Recurse -Force
}

Write-Host ''
Write-Host 'Aven No-Rent shared-storage registration and application files were removed.' -ForegroundColor Green
Write-Host 'The shared data file and extension key were preserved in:' -ForegroundColor Yellow
Write-Host $installRoot
Write-Host ''
Write-Host 'Remove the Aven extension manually from each Chrome Windows login.' -ForegroundColor Yellow
Write-Host ''
Read-Host 'Press Enter to close'
