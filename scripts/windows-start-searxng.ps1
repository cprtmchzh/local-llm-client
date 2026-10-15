$ErrorActionPreference = "Stop"

$runtimeDirectory = Join-Path $env:LOCALAPPDATA "LocalLLM\SearXNG"
$settingsFile = Join-Path $runtimeDirectory "settings.yml"
$composeFile = Join-Path $runtimeDirectory "compose.yml"
$dockerCommand = (Get-Command docker -ErrorAction SilentlyContinue).Source
if (-not $dockerCommand) {
    $dockerDesktopCommand = Join-Path $env:ProgramFiles "Docker\Docker\resources\bin\docker.exe"
    if (Test-Path $dockerDesktopCommand) {
        $dockerCommand = $dockerDesktopCommand
    } else {
        throw "Docker CLI was not found. Install and start Docker Desktop first."
    }
}

New-Item -ItemType Directory -Force -Path $runtimeDirectory | Out-Null

if (-not (Test-Path $settingsFile)) {
    $randomBytes = New-Object byte[] 32
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($randomBytes)
    $secretKey = -join ($randomBytes | ForEach-Object { $_.ToString("x2") })
    @"
use_default_settings: true
general:
  instance_name: "Local LLM Search"
  enable_metrics: false
search:
  safe_search: 0
  formats:
    - html
    - json
server:
  secret_key: "$secretKey"
  limiter: false
  image_proxy: true
"@ | Set-Content -Encoding UTF8 $settingsFile
}

@"
name: local-llm-search
services:
  searxng:
    image: docker.io/searxng/searxng:latest
    container_name: local-llm-searxng
    restart: unless-stopped
    ports:
      - "127.0.0.1:8888:8080"
    environment:
      SEARXNG_BASE_URL: http://127.0.0.1:8888/
    volumes:
      - "$($settingsFile.Replace('\', '/')):/etc/searxng/settings.yml:ro"
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://127.0.0.1:8080/healthz"]
      interval: 10s
      timeout: 3s
      retries: 5
      start_period: 15s
"@ | Set-Content -Encoding UTF8 $composeFile

& $dockerCommand compose -f $composeFile up -d
if ($LASTEXITCODE -ne 0) {
    throw "Failed to start the SearXNG container. Check Docker Desktop."
}

for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try {
        Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:8888/healthz" -TimeoutSec 2 | Out-Null
        Write-Host "SearXNG is ready at http://127.0.0.1:8888"
        exit 0
    } catch {
        Start-Sleep -Seconds 1
    }
}

& $dockerCommand compose -f $composeFile logs --tail=40 searxng
throw "SearXNG did not become healthy within 30 seconds."
