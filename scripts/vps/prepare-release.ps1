#requires -Version 7.0
<#
Build the prepared Quiver source on its Windows VPS, without switching services.
Run from PowerShell 7. No credentials or global package-manager install required.
The source commit and archive digest are fixed, independently of branch updates.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

if (-not $IsWindows) { throw 'This preparation script requires Windows and PowerShell 7.' }

$sourceCommit = '6bf2906bf46b8745ee14dc3601fc5f6d1a7cb261'
$archiveSha256 = '0e273f5aee424e6482d2905bf3ef0d292a17b78e0dd697c0f953deced1c2800b'
$projectRoot = 'C:\sites\quiver'
if (-not (Test-Path -LiteralPath $projectRoot -PathType Container)) {
    throw 'Expected the existing Quiver folder C:\sites\quiver. Preparation stopped.'
}

$runId = '{0}-{1}' -f (Get-Date -Format 'yyyyMMdd-HHmmss'), ([guid]::NewGuid().ToString('N').Substring(0, 8))
$workRoot = Join-Path $projectRoot "up\prepare-$runId"
$releaseRoot = Join-Path $projectRoot "releases\r-$runId-6bf2906b"
$logRoot = Join-Path $workRoot 'logs'
$reportPath = Join-Path $workRoot 'result.json'
$stage = 'preflight'
$nodeExe = $null
$savedEnvironment = @{}
$environment = @{
    PATH = $env:PATH
    NODE_ENV = 'production'
    NEXT_TELEMETRY_DISABLED = '1'
    NEXT_PUBLIC_API_MODE = 'live'
    NEXT_PUBLIC_API_BASE = '/v1'
    NEXT_PUBLIC_DEV_LOGIN = '0'
    PUBLIC_BASE_URL = 'http://91.107.243.172:8091'
    QUIVER_API_INTERNAL = $null
    NODE_OPTIONS = $null
    SITES_PNPM_SHARED_STORE = $null
    CI = 'true'
}

New-Item -ItemType Directory -Path $logRoot -Force | Out-Null

function Invoke-QuiverBuildStep {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$Directory,
        [Parameter(Mandatory)][string[]]$NativeArguments
    )
    if (-not (Test-Path -LiteralPath $Directory -PathType Container)) {
        throw "Missing working directory for $Name."
    }
    $script:stage = $Name
    Write-Host "QUIVER_STEP $Name"
    Push-Location -LiteralPath $Directory
    try {
        & $script:nodeExe @NativeArguments 2>&1 |
            Tee-Object -FilePath (Join-Path $script:logRoot "$Name.log")
        $nativeExitCode = $LASTEXITCODE
        if ($nativeExitCode -ne 0) {
            throw "$Name failed with exit code $nativeExitCode. See its log under $script:logRoot."
        }
    }
    finally { Pop-Location }
}

try {
    $nodeCandidates = @('C:\sites\node\current\node.exe')
    $nodeCommand = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue
    if ($nodeCommand) { $nodeCandidates += $nodeCommand.Source }
    foreach ($candidate in $nodeCandidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { $nodeExe = $candidate; break }
    }
    if (-not $nodeExe) { throw 'Node.js was not found at the existing VPS path or on PATH.' }
    $nodeVersionText = (& $nodeExe --version).Trim()
    if ($LASTEXITCODE -ne 0 -or $nodeVersionText -notmatch '^v(\d+)\.') {
        throw 'Could not read the Node.js version.'
    }
    if ([int]$Matches[1] -lt 24) {
        throw "Node.js 24 or newer is required by this backend build; found $nodeVersionText."
    }
    $nodeDirectory = Split-Path -Parent $nodeExe
    $npmCli = Join-Path $nodeDirectory 'node_modules\npm\bin\npm-cli.js'
    if (-not (Test-Path -LiteralPath $npmCli -PathType Leaf)) {
        throw 'The existing Node.js installation does not include npm. Preparation stopped.'
    }
    $environment.PATH = "$nodeDirectory;$env:PATH"
    foreach ($key in $environment.Keys) {
        $savedEnvironment[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
        [Environment]::SetEnvironmentVariable($key, $environment[$key], 'Process')
    }

    $stage = 'source-download'
    Write-Host "QUIVER_STEP $stage ($sourceCommit)"
    $archivePath = Join-Path $workRoot 'source.zip'
    Invoke-WebRequest -Uri "https://codeload.github.com/mamadmisaghi/Quiver/zip/$sourceCommit" `
        -OutFile $archivePath -TimeoutSec 180 -MaximumRetryCount 2
    $actualDigest = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualDigest -ne $archiveSha256) { throw 'Source archive SHA256 mismatch. No source was executed.' }

    $stage = 'source-extract'
    $extractRoot = Join-Path $workRoot 'source'
    Expand-Archive -LiteralPath $archivePath -DestinationPath $extractRoot
    $extractedProject = Join-Path $extractRoot "Quiver-$sourceCommit"
    foreach ($relativeFile in @('package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'services\backend\package-lock.json')) {
        if (-not (Test-Path -LiteralPath (Join-Path $extractedProject $relativeFile) -PathType Leaf)) {
            throw "The pinned archive is missing $relativeFile."
        }
    }
    if (Test-Path -LiteralPath $releaseRoot) { throw 'The new release directory already exists.' }
    New-Item -ItemType Directory -Path (Split-Path -Parent $releaseRoot) -Force | Out-Null
    Move-Item -LiteralPath $extractedProject -Destination $releaseRoot

    # Install the pinned package manager into this run's private tools directory.
    $toolsRoot = Join-Path $workRoot 'tools'
    New-Item -ItemType Directory -Path $toolsRoot | Out-Null
    Invoke-QuiverBuildStep -Name '01-package-manager' -Directory $toolsRoot -NativeArguments @(
        $npmCli, 'install', '--prefix', $toolsRoot, '--ignore-scripts', '--package-lock=false',
        '--include=dev', '--include=optional', '--no-audit', '--no-fund', 'pnpm@11.25.0'
    )
    $pnpmRoot = Join-Path $toolsRoot 'node_modules\pnpm'
    $pnpmPackage = Get-Content -LiteralPath (Join-Path $pnpmRoot 'package.json') -Raw | ConvertFrom-Json
    if ($pnpmPackage.version -ne '11.25.0') { throw 'The installed pnpm version does not match the pin.' }
    $pnpmCli = Join-Path $pnpmRoot $pnpmPackage.bin.pnpm
    if (-not (Test-Path -LiteralPath $pnpmCli -PathType Leaf)) { throw 'Pinned pnpm entry point was not installed.' }

    Invoke-QuiverBuildStep -Name '02-web-dependencies' -Directory $releaseRoot -NativeArguments @(
        $pnpmCli, 'install', '--frozen-lockfile', '--prod=false', '--reporter=append-only'
    )
    $backendRoot = Join-Path $releaseRoot 'services\backend'
    Invoke-QuiverBuildStep -Name '03-backend-dependencies' -Directory $backendRoot -NativeArguments @(
        $npmCli, 'ci', '--include=dev', '--include=optional', '--no-audit', '--no-fund'
    )
    Invoke-QuiverBuildStep -Name '04-contract-dependencies' -Directory (Join-Path $backendRoot 'contracts') -NativeArguments @(
        $npmCli, 'ci', '--include=dev', '--include=optional', '--no-audit', '--no-fund'
    )
    Invoke-QuiverBuildStep -Name '05-backend-types' -Directory $backendRoot -NativeArguments @(
        $npmCli, 'run', 'typecheck'
    )
    Invoke-QuiverBuildStep -Name '06-backend-build' -Directory $backendRoot -NativeArguments @(
        $npmCli, 'run', 'build'
    )
    Invoke-QuiverBuildStep -Name '07-preview-checks' -Directory $releaseRoot -NativeArguments @(
        '--import', './services/backend/node_modules/tsx/dist/loader.mjs', 'scripts/check-preview.ts'
    )
    # next build generates its route types and performs the frontend type check.
    Invoke-QuiverBuildStep -Name '08-web-build' -Directory $releaseRoot -NativeArguments @(
        $npmCli, 'run', 'build:vps'
    )
    foreach ($relativeFile in @('.next\BUILD_ID', 'services\backend\dist\main.js')) {
        if (-not (Test-Path -LiteralPath (Join-Path $releaseRoot $relativeFile) -PathType Leaf)) {
            throw "Build output is missing: $relativeFile."
        }
    }

    $stage = 'complete'
    $result = [ordered]@{
        result = 'QUIVER_PREPARE_OK'
        sourceCommit = $sourceCommit
        archiveSha256 = $actualDigest
        releaseDirectory = $releaseRoot
        nodeVersion = $nodeVersionText
        webBuildId = (Get-Content -LiteralPath (Join-Path $releaseRoot '.next\BUILD_ID') -Raw).Trim()
        logs = $logRoot
        builtOnly = $true
        activated = $false
        buildOrigin = $environment.PUBLIC_BASE_URL
        productionConfiguration = 'pending: database, provider secrets and verified HTTPS origin'
    }
    $result | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $reportPath -Encoding utf8
    Write-Host ''
    Write-Host 'QUIVER_PREPARE_OK' -ForegroundColor Green
    $result | ConvertTo-Json -Depth 4 | Write-Host
}
catch {
    $failure = [ordered]@{
        result = 'QUIVER_PREPARE_FAILED'
        stage = $stage
        error = $_.Exception.Message
        releaseDirectory = $releaseRoot
        logs = $logRoot
        activated = $false
    }
    $failure | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $reportPath -Encoding utf8
    Write-Host ($failure | ConvertTo-Json -Depth 4) -ForegroundColor Red
    throw
}
finally {
    foreach ($key in $savedEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($key, $savedEnvironment[$key], 'Process')
    }
}
