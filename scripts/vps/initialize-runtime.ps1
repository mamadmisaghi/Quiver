#requires -Version 7.0
<#
Prepare a dedicated PostgreSQL service, a TLS preparation page and a public
deployment key for Quiver. The built application is not activated by this file.
Provider secrets and Windows credentials are never requested or printed.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
if (-not $IsWindows) { throw 'Run this script in PowerShell 7 on the Windows VPS.' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Open PowerShell 7 as Administrator on the VPS.'
}

$projectRoot = 'C:\sites\quiver'
$releaseRoot = 'C:\sites\quiver\releases\r-20261029-220200-88d8bf6f-6bf2906b'
$sourceCommit = '6bf2906bf46b8745ee14dc3601fc5f6d1a7cb261'
$expectedBuildId = 'NHUMbCwCq09SoDmxtX13R'
$runtimeRoot = Join-Path $projectRoot 'production'
$privateRoot = Join-Path $runtimeRoot 'private'
$databaseData = Join-Path $runtimeRoot 'postgres-data'
$databaseBinRoot = Join-Path $runtimeRoot 'postgresql-17.11-5'
$databaseBin = Join-Path $databaseBinRoot 'pgsql\bin'
$databaseManifest = Join-Path $privateRoot 'database.json'
$databaseService = 'QuiverPostgres'
$databasePort = 55432
$publicHost = 'quiver.91.107.243.172.sslip.io'
$publicOrigin = "https://$publicHost"
$caddyRoot = 'C:\sites\caddy'
$caddyExe = Join-Path $caddyRoot 'caddy.exe'
$caddySite = Join-Path $caddyRoot 'sites\quiver-production.caddy'
$caddyMarker = '# QUIVER_MANAGED_PREPARATION_ONLY 20261029'
$runId = '{0}-{1}' -f (Get-Date -Format 'yyyyMMdd-HHmmss'), ([guid]::NewGuid().ToString('N').Substring(0, 8))
$workRoot = Join-Path $projectRoot "up\runtime-$runId"
$backupRoot = Join-Path $runtimeRoot "backups\before-activation-$runId"
$nodeExe = 'C:\sites\node\current\node.exe'
$stage = 'preflight'
$rsa = $null

function Protect-QuiverDirectory {
    param([Parameter(Mandatory)][string]$Path, [ValidateSet('none', 'read', 'write')][string]$DatabaseAccess = 'none')
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    $inherit = [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
    foreach ($sidText in @('S-1-5-18', 'S-1-5-32-544')) {
        $sid = [Security.Principal.SecurityIdentifier]::new($sidText)
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', $inherit, 'None', 'Allow'))
    }
    if ($DatabaseAccess -ne 'none') {
        $right = if ($DatabaseAccess -eq 'write') { 'FullControl' } else { 'ReadAndExecute' }
        $sid = [Security.Principal.SecurityIdentifier]::new('S-1-5-20')
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, $right, $inherit, 'None', 'Allow'))
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}

function Invoke-QuiverNative {
    param([Parameter(Mandatory)][string]$Name, [Parameter(Mandatory)][string]$Executable, [string[]]$NativeArguments = @())
    $script:stage = $Name
    Write-Host "QUIVER_STEP $Name"
    & $Executable @NativeArguments 2>&1 | Tee-Object -FilePath (Join-Path $script:workRoot "$Name.log")
    if ($LASTEXITCODE -ne 0) { throw "$Name failed with exit code $LASTEXITCODE. See the step log." }
}

function Wait-QuiverDatabaseReady {
    $deadline = [DateTime]::UtcNow.AddSeconds(45)
    do {
        & (Join-Path $script:databaseBin 'pg_isready.exe') -q -h 127.0.0.1 -p $script:databasePort -d postgres
        if ($LASTEXITCODE -eq 0) { return }
        if ((Get-Service -Name $script:databaseService).Status -eq 'Stopped') { throw 'The dedicated database service stopped during startup.' }
        Start-Sleep -Seconds 2
    } while ([DateTime]::UtcNow -lt $deadline)
    throw 'The dedicated database did not become ready within 45 seconds.'
}

try {
    foreach ($required in @($nodeExe, $caddyExe, (Join-Path $caddyRoot 'Caddyfile'), (Join-Path $releaseRoot 'services\backend\dist\main.js'))) {
        if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Missing required file: $required" }
    }
    $buildId = (Get-Content -LiteralPath (Join-Path $releaseRoot '.next\BUILD_ID') -Raw).Trim()
    if ($buildId -ne $expectedBuildId) { throw 'The prepared Windows web build does not match the reported build ID.' }
    $mainCaddy = Get-Content -LiteralPath (Join-Path $caddyRoot 'Caddyfile') -Raw
    if ($mainCaddy -notmatch '(?m)^\s*import\s+sites[/\\]\*\.caddy\s*$') {
        throw 'The expected Caddy sites import was not found. No Caddy configuration was changed.'
    }
    if (Test-Path -LiteralPath $caddySite -PathType Leaf) {
        if (-not ([IO.File]::ReadAllText($caddySite)).StartsWith($caddyMarker)) {
            throw 'The production Caddy file is not an inactive preparation file. Runtime initialization will not run over an activated deployment.'
        }
    }
    $priorContextPath = Join-Path $privateRoot 'deployment-context.json'
    if (Test-Path -LiteralPath $priorContextPath -PathType Leaf) {
        $priorContext = Get-Content -LiteralPath $priorContextPath -Raw | ConvertFrom-Json
        if ($priorContext.activated) { throw 'This release has already been activated; initialization will not restart its database.' }
    }
    foreach ($launcher in @('api-start.bat', 'web-start.bat')) {
        $launcherPath = Join-Path $projectRoot $launcher
        if (Test-Path -LiteralPath $launcherPath -PathType Leaf) {
            if (([IO.File]::ReadAllText($launcherPath)).Contains($releaseRoot, [StringComparison]::OrdinalIgnoreCase)) {
                throw 'An existing launcher already points at the new release. Initialization stopped before changing its runtime.'
            }
        }
    }

    Protect-QuiverDirectory -Path $workRoot
    Protect-QuiverDirectory -Path $runtimeRoot
    # NetworkService may traverse this directory, but does not inherit access to private/.
    $runtimeAcl = Get-Acl -LiteralPath $runtimeRoot
    $runtimeAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
        [Security.Principal.SecurityIdentifier]::new('S-1-5-20'), 'ReadAndExecute', 'Allow'))
    Set-Acl -LiteralPath $runtimeRoot -AclObject $runtimeAcl
    Protect-QuiverDirectory -Path $privateRoot
    Protect-QuiverDirectory -Path $backupRoot

    $stage = 'private-backup'
    foreach ($name in @('api-start.bat', 'web-start.bat')) {
        $existing = Join-Path $projectRoot $name
        if (-not (Test-Path -LiteralPath $existing -PathType Leaf)) { throw "Expected existing launcher is missing: $name" }
        Copy-Item -LiteralPath $existing -Destination (Join-Path $backupRoot $name)
    }
    foreach ($name in @('QuiverApi', 'QuiverWeb')) {
        Export-ScheduledTask -TaskName $name | Set-Content -LiteralPath (Join-Path $backupRoot "$name.xml") -Encoding unicode
    }
    Copy-Item -LiteralPath (Join-Path $caddyRoot 'Caddyfile') -Destination (Join-Path $backupRoot 'Caddyfile.snapshot')
    Copy-Item -LiteralPath (Join-Path $caddyRoot 'sites\quiver.caddy') -Destination (Join-Path $backupRoot 'quiver.caddy')
    if (Test-Path -LiteralPath (Join-Path $projectRoot 'env') -PathType Container) {
        Copy-Item -LiteralPath (Join-Path $projectRoot 'env') -Destination (Join-Path $backupRoot 'previous-env') -Recurse
    }
    # The live legacy state file is intentionally copied only after a clean stop during activation.

    $stage = 'deployment-public-key'
    $privateKeyPath = Join-Path $privateRoot 'deployment-private-key.pem'
    $rsa = [Security.Cryptography.RSA]::Create(3072)
    if (Test-Path -LiteralPath $privateKeyPath -PathType Leaf) {
        $rsa.ImportFromPem([IO.File]::ReadAllText($privateKeyPath))
    }
    else { [IO.File]::WriteAllText($privateKeyPath, $rsa.ExportPkcs8PrivateKeyPem()) }
    $publicKeyBytes = $rsa.ExportSubjectPublicKeyInfo()
    $publicKeySpki = [Convert]::ToBase64String($publicKeyBytes)
    $keyFingerprint = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($publicKeyBytes)).ToLowerInvariant()

    $stage = 'database-binaries'
    Protect-QuiverDirectory -Path $databaseBinRoot -DatabaseAccess read
    $pgCtl = Join-Path $databaseBin 'pg_ctl.exe'
    $binaryMarker = Join-Path $databaseBinRoot 'verified-archive.sha256'
    if (-not (Test-Path -LiteralPath $binaryMarker -PathType Leaf)) {
        if (Get-Service -Name $databaseService -ErrorAction SilentlyContinue) {
            throw 'A database service already exists but its verified binary marker is missing. Binaries will not be replaced while a service may use them.'
        }
        $archive = Join-Path $workRoot 'postgresql-17.11-5-windows-x64-binaries.zip'
        Write-Host 'QUIVER_STEP download-postgresql (about 382 MB)'
        Invoke-WebRequest -Uri 'https://get.enterprisedb.com/postgresql/postgresql-17.11-5-windows-x64-binaries.zip' `
            -OutFile $archive -TimeoutSec 600 -MaximumRetryCount 2
        $digest = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
        if ($digest -ne '80379b2c04d51c30225532e0ae04509899141e9957ed096fe749d7fd9df8f82f') {
            throw 'PostgreSQL archive checksum differs from the publisher checksum. Nothing was executed.'
        }
        Expand-Archive -LiteralPath $archive -DestinationPath $databaseBinRoot -Force
        [IO.File]::WriteAllText($binaryMarker, $digest.ToLowerInvariant())
    }
    Invoke-QuiverNative -Name 'postgresql-version' -Executable $pgCtl -NativeArguments @('--version')

    $stage = 'dedicated-database'
    $existingService = Get-CimInstance Win32_Service -Filter "Name='$databaseService'"
    if ($existingService -and ($existingService.PathName -notlike "*$pgCtl*" -or $existingService.PathName -notlike "*$databaseData*")) {
        throw 'A service named QuiverPostgres exists with a different executable or data directory.'
    }
    $listener = @(Get-NetTCPConnection -LocalPort $databasePort -State Listen -ErrorAction SilentlyContinue)
    if ($listener.Count -and (-not $existingService -or -not (Test-Path -LiteralPath $databaseManifest -PathType Leaf))) {
        throw 'The dedicated database port is in use by an unrecognized instance.'
    }
    if (-not (Test-Path -LiteralPath $databaseManifest -PathType Leaf)) {
        if (Test-Path -LiteralPath (Join-Path $databaseData 'PG_VERSION')) {
            throw 'A database cluster exists without this deployment manifest. It will not be reinitialized.'
        }
        $dbSettings = [ordered]@{
            host = '127.0.0.1'; port = $databasePort; database = 'quiver'
            adminUser = 'quiver_admin'; appUser = 'quiver_app'
            adminPassword = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
            appPassword = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
            releaseDirectory = $releaseRoot
        }
        $dbSettings | ConvertTo-Json | Set-Content -LiteralPath $databaseManifest -Encoding utf8
    }
    $dbSettings = Get-Content -LiteralPath $databaseManifest -Raw | ConvertFrom-Json
    if ($dbSettings.host -ne '127.0.0.1' -or $dbSettings.port -ne $databasePort -or $dbSettings.database -ne 'quiver' -or
        $dbSettings.adminUser -ne 'quiver_admin' -or $dbSettings.appUser -ne 'quiver_app' -or
        $dbSettings.adminPassword -notmatch '^[0-9a-f]{64}$' -or $dbSettings.appPassword -notmatch '^[0-9a-f]{64}$') {
        throw 'The existing private database manifest has unexpected settings.'
    }
    Protect-QuiverDirectory -Path $databaseData -DatabaseAccess write
    if (-not (Test-Path -LiteralPath (Join-Path $databaseData 'PG_VERSION') -PathType Leaf)) {
        $passwordFile = Join-Path $privateRoot 'initdb-password.tmp'
        try {
            [IO.File]::WriteAllText($passwordFile, $dbSettings.adminPassword)
            Invoke-QuiverNative -Name 'database-init' -Executable (Join-Path $databaseBin 'initdb.exe') -NativeArguments @(
                '-D', $databaseData, '--username=quiver_admin', "--pwfile=$passwordFile", '--encoding=UTF8',
                '--locale=C', '--auth=scram-sha-256', '--data-checksums'
            )
        }
        finally { if (Test-Path -LiteralPath $passwordFile) { Remove-Item -LiteralPath $passwordFile -Force } }
    }
    Protect-QuiverDirectory -Path $databaseData -DatabaseAccess write
    $pgConfig = Join-Path $databaseData 'postgresql.conf'
    $pgConfigText = Get-Content -LiteralPath $pgConfig -Raw
    if ($pgConfigText -notmatch '(?m)^include_if_exists\s*=\s*''quiver-runtime.conf''') {
        Add-Content -LiteralPath $pgConfig -Value "`ninclude_if_exists = 'quiver-runtime.conf'" -Encoding utf8
    }
    @"
listen_addresses = '127.0.0.1'
port = $databasePort
max_connections = 30
shared_buffers = '128MB'
password_encryption = 'scram-sha-256'
logging_collector = on
log_directory = 'log'
log_filename = 'postgres-%Y-%m-%d.log'
log_rotation_age = '1d'
"@ | Set-Content -LiteralPath (Join-Path $databaseData 'quiver-runtime.conf') -Encoding utf8
    if (-not $existingService) {
        Invoke-QuiverNative -Name 'database-service-register' -Executable $pgCtl -NativeArguments @(
            'register', '-D', $databaseData, '-N', $databaseService, '-U', 'NT AUTHORITY\NetworkService', '-S', 'auto'
        )
    }
    Set-Service -Name $databaseService -StartupType Automatic
    Invoke-QuiverNative -Name 'database-service-recovery' -Executable "$env:SystemRoot\System32\sc.exe" -NativeArguments @(
        'failure', $databaseService, 'reset=', '86400', 'actions=', 'restart/60000/restart/60000/restart/60000'
    )
    Start-Service -Name $databaseService
    (Get-Service -Name $databaseService).WaitForStatus('Running', [TimeSpan]::FromSeconds(45))
    Wait-QuiverDatabaseReady

    $databaseHelper = Join-Path $workRoot 'database-bootstrap.mjs'
    @'
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const [manifest, phase] = process.argv.slice(2);
const c = JSON.parse(fs.readFileSync(manifest, 'utf8').replace(/^\uFEFF/, ''));
if (c.host !== '127.0.0.1' || c.port !== 55432 || c.database !== 'quiver' || c.adminUser !== 'quiver_admin' || c.appUser !== 'quiver_app' || !/^[a-f0-9]{64}$/.test(c.appPassword)) throw new Error('Unexpected database manifest');
const require = createRequire(path.join(c.releaseDirectory, 'services', 'backend', 'package.json'));
const { Client } = require('pg');
let db;
try {
  if (phase === 'create') {
    db = new Client({host:c.host, port:c.port, user:c.adminUser, password:c.adminPassword, database:'postgres', connectionTimeoutMillis:10000});
    await db.connect();
    if (!(await db.query("SELECT 1 FROM pg_roles WHERE rolname='quiver_app'")).rowCount) {
      await db.query(`CREATE ROLE quiver_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${c.appPassword}'`);
    }
    if (!(await db.query("SELECT 1 FROM pg_database WHERE datname='quiver'")).rowCount) await db.query('CREATE DATABASE quiver OWNER quiver_app');
    await db.end();
  }
  db = new Client({host:c.host, port:c.port, user:c.appUser, password:c.appPassword, database:c.database, connectionTimeoutMillis:10000});
  await db.connect();
  if (phase === 'create') {
    await db.query('CREATE TABLE IF NOT EXISTS quiver_deployment_probe (id integer PRIMARY KEY, value text NOT NULL)');
    await db.query("INSERT INTO quiver_deployment_probe VALUES (1, '6bf2906b') ON CONFLICT (id) DO NOTHING");
  }
  const result = await db.query('SELECT value FROM quiver_deployment_probe WHERE id=1');
  if (result.rows[0]?.value !== '6bf2906b') throw new Error('Durability probe missing');
  console.log('QUIVER_DATABASE_PROBE_OK');
} catch (e) {
  console.error('QUIVER_DATABASE_PROBE_FAILED', e.code || e.name);
  process.exitCode = 1;
} finally { if (db) await db.end().catch(() => {}); }
'@ | Set-Content -LiteralPath $databaseHelper -Encoding utf8
    Invoke-QuiverNative -Name 'database-create-and-write' -Executable $nodeExe -NativeArguments @($databaseHelper, $databaseManifest, 'create')
    # This database service is dedicated to this deployment; the application has not connected yet.
    Restart-Service -Name $databaseService
    (Get-Service -Name $databaseService).WaitForStatus('Running', [TimeSpan]::FromSeconds(45))
    Wait-QuiverDatabaseReady
    Invoke-QuiverNative -Name 'database-read-after-restart' -Executable $nodeExe -NativeArguments @($databaseHelper, $databaseManifest, 'verify')
    $dbListeners = @(Get-NetTCPConnection -LocalPort $databasePort -State Listen -ErrorAction Stop)
    if (-not $dbListeners.Count -or @($dbListeners | Where-Object LocalAddress -ne '127.0.0.1').Count) {
        throw 'The dedicated database is not listening exclusively on IPv4 loopback.'
    }

    $stage = 'https-preparation'
    $oldSite = $null
    if (Test-Path -LiteralPath $caddySite -PathType Leaf) {
        $oldSite = [IO.File]::ReadAllText($caddySite)
        if (-not $oldSite.StartsWith($caddyMarker)) { throw 'The production Caddy file is not an inactive preparation file; it will not be replaced.' }
    }
    $preparationPage = @"
$caddyMarker
$publicHost {
    @deployment_probe path /__quiver_ready
    handle @deployment_probe {
        header Cache-Control "no-store"
        respond "quiver-runtime-6bf2906b" 200
    }
    handle {
        respond "Quiver deployment is being prepared." 503
    }
}
"@
    [IO.File]::WriteAllText($caddySite, $preparationPage)
    Push-Location -LiteralPath $caddyRoot
    try {
        try {
            Invoke-QuiverNative -Name 'caddy-validate' -Executable $caddyExe -NativeArguments @('validate', '--config', 'Caddyfile', '--adapter', 'caddyfile')
            Invoke-QuiverNative -Name 'caddy-reload' -Executable $caddyExe -NativeArguments @('reload', '--config', 'Caddyfile', '--adapter', 'caddyfile')
        }
        catch {
            if ($null -eq $oldSite) { Remove-Item -LiteralPath $caddySite -Force }
            else { [IO.File]::WriteAllText($caddySite, $oldSite) }
            # Restore the prior file configuration without stopping the shared Caddy process.
            & $caddyExe reload --config Caddyfile --adapter caddyfile 2>&1 | Out-Null
            throw
        }
    }
    finally { Pop-Location }
    $httpsReady = $false
    $deadline = [DateTime]::UtcNow.AddMinutes(3)
    do {
        try {
            $probe = Invoke-WebRequest -Uri "$publicOrigin/__quiver_ready" -TimeoutSec 8 -MaximumRedirection 0
            if ($probe.StatusCode -eq 200 -and $probe.Content.Trim() -eq 'quiver-runtime-6bf2906b') { $httpsReady = $true; break }
        }
        catch { }
        Write-Host 'QUIVER_STEP waiting-for-verified-https'
        Start-Sleep -Seconds 4
    } while ([DateTime]::UtcNow -lt $deadline)

    $context = [ordered]@{
        result = $(if ($httpsReady) { 'QUIVER_RUNTIME_READY' } else { 'QUIVER_RUNTIME_PENDING_HTTPS' })
        sourceCommit = $sourceCommit
        releaseDirectory = $releaseRoot
        publicOrigin = $publicOrigin
        httpsVerified = $httpsReady
        databaseService = $databaseService
        databasePort = $databasePort
        databaseLoopbackOnly = $true
        databaseSurvivedRestart = $true
        backupDirectory = $backupRoot
        logs = $workRoot
        publicKeySpki = $publicKeySpki
        keyFingerprint = $keyFingerprint
        activated = $false
    }
    $context | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $privateRoot 'deployment-context.json') -Encoding utf8
    $context | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $workRoot 'result.json') -Encoding utf8
    Write-Host ''
    $context | ConvertTo-Json -Depth 4 | Write-Host
}
catch {
    $failure = [ordered]@{ result = 'QUIVER_RUNTIME_FAILED'; stage = $stage; error = $_.Exception.Message; logs = $workRoot; activated = $false }
    if (Test-Path -LiteralPath $workRoot -PathType Container) {
        $failure | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $workRoot 'result.json') -Encoding utf8
    }
    Write-Host ($failure | ConvertTo-Json) -ForegroundColor Red
    throw
}
finally { if ($rsa) { $rsa.Dispose() } }
