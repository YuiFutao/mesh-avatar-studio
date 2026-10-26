param(
    [switch]$NoBrowser,
    [switch]$Check
)

$ErrorActionPreference = 'Stop'
$studioRoot = Split-Path -Parent $PSScriptRoot
$projectName = 'yui-chibi03-v03-ear-twitch'
$studioPort = 5188
$studioOrigin = "http://127.0.0.1:$studioPort"
$livePath = "/live.html?project=$projectName&trackingProfile=/projects/$projectName/tracking-calibration.json&cameraPreview=0&autoStartCamera=1&autoStartMicrophone=1"
$liveUrl = "$studioOrigin$livePath"
$obsUrl = "$studioOrigin/stream.html?project=$projectName&bg=transparent&fit=contain&idle=1"
$rigPath = Join-Path $studioRoot "projects\$projectName\rig.json"
$vitePath = Join-Path $studioRoot 'node_modules\vite\bin\vite.js'

try {
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    if (-not (Test-Path -LiteralPath $rigPath -PathType Leaf)) {
        throw "The local v03 model is missing: $rigPath"
    }
    if (-not (Test-Path -LiteralPath $vitePath -PathType Leaf)) {
        throw 'Dependencies are missing. Run npm install in the repository first.'
    }
    Write-Host 'Mesh Avatar Studio - Yui v03 (ear twitch)'
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
        $matches = $false
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri "$studioOrigin/projects/$projectName/rig.json" -TimeoutSec 3
            $matches = $response.StatusCode -eq 200 -and
                $response.Content.Trim() -eq ([System.IO.File]::ReadAllText($rigPath)).Trim()
        } catch {
            $matches = $false
        }
        if (-not $matches) {
            throw "Port $studioPort is used by another service. Stop that service and retry. The OBS URL will not be changed."
        }
        Write-Host 'The v03 server is already running. Reusing the same address.'
        if (-not $NoBrowser) { Start-Process -FilePath $liveUrl }
        exit 0
    }

    Write-Host 'Keep this window open while using the avatar. Close it to stop the server.'
    Write-Host 'Camera starts automatically with its preview hidden. Allow camera access if your browser asks.'
    Write-Host 'Microphone lip sync starts automatically with the default gain. Allow microphone access if asked.'
    Push-Location -LiteralPath $studioRoot
    try {
        $viteArgs = @($vitePath, '--host', '127.0.0.1', '--port', "$studioPort", '--strictPort')
        if (-not $NoBrowser) { $viteArgs += @('--open', $livePath) }
        & $node @viteArgs
        exit $LASTEXITCODE
    } finally {
        Pop-Location
    }
} catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
