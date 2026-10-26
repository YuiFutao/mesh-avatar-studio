param(
    [switch]$NoBrowser,
    [switch]$Stop,
    [switch]$ShowErrors,
    [switch]$Check
)

$ErrorActionPreference = 'Stop'
$studioRoot = Split-Path -Parent $PSScriptRoot
$projectName = 'yui-chibi03-v03-ear-twitch'
$studioPort = 5188
$studioOrigin = "http://127.0.0.1:$studioPort"
$livePath = "/live.html?project=$projectName&trackingProfile=/projects/$projectName/tracking-calibration.json&cameraPreview=0&autoStartCamera=1&autoStartMicrophone=1"
$livePath += '&fps=30&avatarPreview=0&trackingFps=20'
$liveUrl = "$studioOrigin$livePath"
$obsUrl = "$studioOrigin/stream.html?project=$projectName&bg=transparent&fit=contain&idle=1"
$obsUrl += '&fps=30'
$rigPath = Join-Path $studioRoot "projects\$projectName\rig.json"
$vitePath = Join-Path $studioRoot 'node_modules\vite\bin\vite.js'
$serverWork = Join-Path $studioRoot 'work'
$statePath = Join-Path $serverWork 'yui-v03-server.json'
$outputLog = Join-Path $serverWork 'yui-v03-server.log'
$errorLog = Join-Path $serverWork 'yui-v03-server-error.log'
$launchedServer = $null
$launcherMutex = $null
$mutexHeld = $false

function Get-OwnedServer {
    if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) { return $null }
    $saved = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    $server = Get-Process -Id $saved.processId -ErrorAction SilentlyContinue
    if (-not $server -or $server.StartTime.ToUniversalTime().Ticks.ToString() -ne $saved.startedTicks) { return $null }
    $details = Get-CimInstance Win32_Process -Filter "ProcessId = $($server.Id)"
    if ($server.Path -ne $node -or -not $details.CommandLine -or
        $details.CommandLine.IndexOf($vitePath, [StringComparison]::OrdinalIgnoreCase) -lt 0 -or
        $details.CommandLine -notmatch '--port\s+5188(?:\s|$)') {
        throw 'The saved server identity does not match this launcher. No process was stopped.'
    }
    return $server
}

function Test-StudioServer {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "$studioOrigin/projects/$projectName/rig.json" -TimeoutSec 1
        return $response.StatusCode -eq 200 -and
            $response.Content.Trim() -eq ([System.IO.File]::ReadAllText($rigPath)).Trim()
    } catch { return $false }
}

function Test-AutoShutdown {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "$studioOrigin/__studio/idle-shutdown" -TimeoutSec 1
        return ($response.Content | ConvertFrom-Json).timeoutMs -eq 300000
    } catch { return $false }
}

try {
    $hash = [System.Security.Cryptography.SHA256]::Create()
    try { $rootKey = [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($studioRoot.ToLowerInvariant()))).Replace('-', '') } finally { $hash.Dispose() }
    $launcherMutex = [System.Threading.Mutex]::new($false, "Local\MeshAvatarYuiV03-$rootKey")
    try { $mutexHeld = $launcherMutex.WaitOne(30000) } catch [System.Threading.AbandonedMutexException] { $mutexHeld = $true }
    if (-not $mutexHeld) { throw 'Another launcher is still starting or stopping the server. Please retry shortly.' }
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    if ($Stop) {
        $server = Get-OwnedServer
        if ($server) {
            Stop-Process -Id $server.Id -ErrorAction Stop
            $server.WaitForExit()
        }
        if (Test-Path -LiteralPath $statePath) { Remove-Item -LiteralPath $statePath }
        Write-Host 'The background Yui v03 server is stopped. Servers started manually are not affected.'
        exit 0
    }
    if (-not (Test-Path -LiteralPath $rigPath -PathType Leaf)) {
        throw "The local v03 model is missing: $rigPath"
    }
    if (-not (Test-Path -LiteralPath $vitePath -PathType Leaf)) {
        throw 'Dependencies are missing. Run npm install in the repository first.'
    }
    Write-Host 'Mesh Avatar Studio - Yui v03 (ear twitch)'
    Write-Host 'Streaming mode: avatar preview off, stream drawing capped at 30 fps, face tracking up to 20 fps.'
    Write-Host 'Update the OBS Browser Source URL below to apply its 30 fps cap.'
    Write-Host "Live: $liveUrl"
    Write-Host "OBS : $obsUrl"
    Write-Host ''
    if ($Check) { exit 0 }

    $probe = [System.Net.Sockets.TcpClient]::new()
    $occupied = $false
    try {
        $connection = $probe.ConnectAsync('127.0.0.1', $studioPort)
        $occupied = $connection.Wait(700) -and $probe.Connected
    } catch {
        $occupied = $false
    } finally {
        $probe.Dispose()
    }

    if ($occupied) {
        if (-not (Test-StudioServer)) {
            throw "Port $studioPort is used by another service. Stop that service and retry. The OBS URL will not be changed."
        }
        if (-not (Test-AutoShutdown)) {
            throw 'The existing server does not have five-minute automatic shutdown enabled. Stop it first, then launch again.'
        }
        Write-Host 'The v03 server is already running. Reusing the same address.'
        if (-not $NoBrowser) { Start-Process -FilePath $liveUrl }
        exit 0
    }

    Write-Host 'The server runs without a console window. Use Stop-Yui-v03.bat to stop it.'
    Write-Host 'It also stops automatically after five minutes without browser or OBS connections.'
    Write-Host 'Camera starts automatically with its preview hidden. Allow camera access if your browser asks.'
    Write-Host 'Microphone lip sync starts automatically with the default gain. Allow microphone access if asked.'
    New-Item -ItemType Directory -Path $serverWork -Force | Out-Null
    $viteArgs = @(('"' + $vitePath + '"'), '--host', '127.0.0.1', '--port', "$studioPort", '--strictPort')
    $previousIdleShutdown = $env:MESH_AVATAR_IDLE_SHUTDOWN
    try {
        $env:MESH_AVATAR_IDLE_SHUTDOWN = '1'
        $launchedServer = Start-Process -FilePath $node -ArgumentList $viteArgs -WorkingDirectory $studioRoot -WindowStyle Hidden -RedirectStandardOutput $outputLog -RedirectStandardError $errorLog -PassThru
    } finally { $env:MESH_AVATAR_IDLE_SHUTDOWN = $previousIdleShutdown }
    @{ processId = $launchedServer.Id; startedTicks = $launchedServer.StartTime.ToUniversalTime().Ticks.ToString() } | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
    $ready = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        if ($launchedServer.HasExited) { throw "The server exited. See $errorLog" }
        if ((Test-StudioServer) -and (Test-AutoShutdown)) { $ready = $true; break }
        Start-Sleep -Milliseconds 150
    }
    if (-not $ready) { throw "The server did not become ready. See $errorLog" }
    if (-not $NoBrowser) { Start-Process -FilePath $liveUrl }
    exit 0
} catch {
    $launchError = $_.Exception.Message
    if ($launchedServer) {
        try {
            $owned = Get-OwnedServer
            if ($owned -and $owned.Id -eq $launchedServer.Id) {
                Stop-Process -Id $owned.Id -ErrorAction SilentlyContinue
                Remove-Item -LiteralPath $statePath -ErrorAction SilentlyContinue
            }
        } catch { Write-Host 'The server could not be cleaned up automatically. See the server logs.' }
    }
    Write-Host "ERROR: $launchError" -ForegroundColor Red
    if ($ShowErrors) {
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.MessageBox]::Show($launchError, 'Mesh Avatar Studio - Yui v03', 'OK', 'Error') | Out-Null
    }
    exit 1
} finally {
    if ($mutexHeld) { $launcherMutex.ReleaseMutex() }
    if ($launcherMutex) { $launcherMutex.Dispose() }
}
