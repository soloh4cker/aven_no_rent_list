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

function Write-Utf8NoBom([string]$Path, [string]$Text) {
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Text, $encoding)
}

function Get-ExtensionId([byte[]]$PublicKeyBytes) {
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hash = $sha256.ComputeHash($PublicKeyBytes)
    }
    finally {
        $sha256.Dispose()
    }

    $builder = New-Object System.Text.StringBuilder
    for ($index = 0; $index -lt 16; $index++) {
        $high = ($hash[$index] -shr 4) -band 15
        $low = $hash[$index] -band 15
        [void]$builder.Append([char]([int][char]'a' + $high))
        [void]$builder.Append([char]([int][char]'a' + $low))
    }
    return $builder.ToString()
}

$sourceRoot = Split-Path -Parent $PSScriptRoot
$installRoot = Join-Path $env:ProgramData 'DaysInn\AvenNoRent'
$extensionDirectory = Join-Path $installRoot 'Extension'
$hostDirectory = Join-Path $installRoot 'NativeHost'
$dataDirectory = Join-Path $installRoot 'Data'
$dataPath = Join-Path $dataDirectory 'no-rent-list.json'
$keyPath = Join-Path $installRoot 'extension-key.txt'
$hostExecutable = Join-Path $hostDirectory 'AvenNoRentHost.exe'
$hostManifestPath = Join-Path $hostDirectory 'com.daysinn.aven_no_rent.json'
$hostConfigPath = Join-Path $hostDirectory 'config.json'
$registryPath = 'HKLM:\SOFTWARE\Google\Chrome\NativeMessagingHosts\com.daysinn.aven_no_rent'

Write-Host ''
Write-Host 'Installing Aven No-Rent Alert Version 2.0...' -ForegroundColor Cyan
Write-Host ''

New-Item -ItemType Directory -Path $extensionDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $hostDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $dataDirectory -Force | Out-Null

$extensionFiles = @(
    'manifest.json',
    'background.js',
    'content.js',
    'content.css',
    'popup.html',
    'popup.js',
    'popup.css',
    'diagnostic.css'
)

foreach ($relativePath in $extensionFiles) {
    $sourcePath = Join-Path $sourceRoot $relativePath
    if (-not (Test-Path -LiteralPath $sourcePath)) {
        throw "Required extension file is missing: $sourcePath"
    }
    Copy-Item -LiteralPath $sourcePath -Destination (Join-Path $extensionDirectory $relativePath) -Force
}

$keyUtilitySource = @'
using System;
using System.Collections.Generic;
using System.Security.Cryptography;

public static class AvenExtensionKeyUtility
{
    public static byte[] GenerateSubjectPublicKeyInfo()
    {
        using (RSACryptoServiceProvider rsa = new RSACryptoServiceProvider(2048))
        {
            RSAParameters parameters = rsa.ExportParameters(false);
            byte[] rsaPublicKey = Sequence(
                Integer(parameters.Modulus),
                Integer(parameters.Exponent)
            );

            byte[] algorithmIdentifier = Sequence(
                new byte[] { 0x06, 0x09, 0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x01, 0x01 },
                new byte[] { 0x05, 0x00 }
            );

            byte[] bitStringContent = Concat(new byte[] { 0x00 }, rsaPublicKey);
            return Sequence(algorithmIdentifier, Tagged(0x03, bitStringContent));
        }
    }

    private static byte[] Integer(byte[] value)
    {
        int firstNonZero = 0;
        while (firstNonZero < value.Length - 1 && value[firstNonZero] == 0)
        {
            firstNonZero++;
        }

        byte[] trimmed = new byte[value.Length - firstNonZero];
        Buffer.BlockCopy(value, firstNonZero, trimmed, 0, trimmed.Length);
        if ((trimmed[0] & 0x80) != 0)
        {
            trimmed = Concat(new byte[] { 0x00 }, trimmed);
        }
        return Tagged(0x02, trimmed);
    }

    private static byte[] Sequence(params byte[][] values)
    {
        return Tagged(0x30, Concat(values));
    }

    private static byte[] Tagged(byte tag, byte[] value)
    {
        return Concat(new byte[] { tag }, EncodeLength(value.Length), value);
    }

    private static byte[] EncodeLength(int length)
    {
        if (length < 128)
        {
            return new byte[] { (byte)length };
        }

        List<byte> bytes = new List<byte>();
        int remaining = length;
        while (remaining > 0)
        {
            bytes.Insert(0, (byte)(remaining & 0xFF));
            remaining >>= 8;
        }
        bytes.Insert(0, (byte)(0x80 | bytes.Count));
        return bytes.ToArray();
    }

    private static byte[] Concat(params byte[][] arrays)
    {
        int total = 0;
        foreach (byte[] array in arrays)
        {
            if (array != null) total += array.Length;
        }

        byte[] result = new byte[total];
        int offset = 0;
        foreach (byte[] array in arrays)
        {
            if (array == null) continue;
            Buffer.BlockCopy(array, 0, result, offset, array.Length);
            offset += array.Length;
        }
        return result;
    }
}
'@

if (-not ('AvenExtensionKeyUtility' -as [type])) {
    Add-Type -TypeDefinition $keyUtilitySource -Language CSharp
}

if (Test-Path -LiteralPath $keyPath) {
    $manifestKey = (Get-Content -LiteralPath $keyPath -Raw).Trim()
    $publicKeyBytes = [Convert]::FromBase64String($manifestKey)
}
else {
    $publicKeyBytes = [AvenExtensionKeyUtility]::GenerateSubjectPublicKeyInfo()
    $manifestKey = [Convert]::ToBase64String($publicKeyBytes)
    Write-Utf8NoBom -Path $keyPath -Text $manifestKey
}

$extensionId = Get-ExtensionId -PublicKeyBytes $publicKeyBytes

$installedManifestPath = Join-Path $extensionDirectory 'manifest.json'
$manifest = Get-Content -LiteralPath $installedManifestPath -Raw | ConvertFrom-Json
$manifest | Add-Member -MemberType NoteProperty -Name 'key' -Value $manifestKey -Force
$manifestJson = $manifest | ConvertTo-Json -Depth 20
Write-Utf8NoBom -Path $installedManifestPath -Text $manifestJson

$sourceHostPath = Join-Path $sourceRoot 'native-host\AvenNoRentHost.cs'
if (-not (Test-Path -LiteralPath $sourceHostPath)) {
    throw "Native host source is missing: $sourceHostPath"
}

$cscCandidates = @(
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
)
$cscPath = $cscCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $cscPath) {
    throw 'The Windows .NET Framework C# compiler was not found. Enable .NET Framework 4.8 and run the installer again.'
}

if (Test-Path -LiteralPath $hostExecutable) {
    Remove-Item -LiteralPath $hostExecutable -Force
}

& $cscPath /nologo /target:exe /optimize+ /out:$hostExecutable /reference:System.Web.Extensions.dll $sourceHostPath
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $hostExecutable)) {
    throw 'The native shared-storage helper could not be compiled.'
}

$managerIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$managerSid = $managerIdentity.User.Value
$managerAccount = $managerIdentity.Name

$hostConfig = [ordered]@{
    dataPath = $dataPath
    managerSid = $managerSid
    managerAccount = $managerAccount
}
Write-Utf8NoBom -Path $hostConfigPath -Text ($hostConfig | ConvertTo-Json -Depth 5)

if (-not (Test-Path -LiteralPath $dataPath)) {
    $database = [ordered]@{
        format = 'aven-no-rent-shared-list'
        version = 2
        lastUpdatedUtc = ''
        guests = @()
    }
    Write-Utf8NoBom -Path $dataPath -Text ($database | ConvertTo-Json -Depth 10)
}

$nativeHostManifest = [ordered]@{
    name = 'com.daysinn.aven_no_rent'
    description = 'Days Inn Aven No-Rent shared local storage'
    path = $hostExecutable
    type = 'stdio'
    allowed_origins = @("chrome-extension://$extensionId/")
}
Write-Utf8NoBom -Path $hostManifestPath -Text ($nativeHostManifest | ConvertTo-Json -Depth 5)

New-Item -Path $registryPath -Force | Out-Null
Set-Item -Path $registryPath -Value $hostManifestPath

# Lock the application files against changes by standard front-desk accounts.
# The exact Windows account that runs this installer receives Modify permission.
& icacls.exe $installRoot /inheritance:r | Out-Null
& icacls.exe $installRoot /grant:r `
    '*S-1-5-18:(OI)(CI)F' `
    '*S-1-5-32-544:(OI)(CI)F' `
    ("*$managerSid`:(OI)(CI)M") `
    '*S-1-5-32-545:(OI)(CI)RX' | Out-Null

$installInformation = @"
Aven No-Rent Alert Version 2.0

Extension folder:
$extensionDirectory

Extension ID:
$extensionId

Shared data file:
$dataPath

Manager Windows account:
$managerAccount

For every Windows login:
1. Open Chrome.
2. Go to chrome://extensions
3. Turn on Developer mode.
4. Remove any older Aven No-Rent Alert installation.
5. Click Load unpacked.
6. Select: $extensionDirectory
7. Reload the Aven page.

Only $managerAccount can add, edit, delete, or import records.
Other Windows accounts have read-only access and still receive warnings.
"@
Write-Utf8NoBom -Path (Join-Path $installRoot 'INSTALL_INFO.txt') -Text $installInformation

Write-Host 'Installation completed successfully.' -ForegroundColor Green
Write-Host ''
Write-Host "Manager account: $managerAccount"
Write-Host "Extension ID:    $extensionId"
Write-Host "Extension folder: $extensionDirectory"
Write-Host "Shared data file: $dataPath"
Write-Host ''
Write-Host 'Next: load the unpacked extension from the Extension folder in every Windows login.' -ForegroundColor Yellow
Write-Host 'The same folder must be selected from every login.' -ForegroundColor Yellow
Write-Host ''

Start-Process explorer.exe -ArgumentList ('"{0}"' -f $installRoot)
Read-Host 'Press Enter to close this installer'
