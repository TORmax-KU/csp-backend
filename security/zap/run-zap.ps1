# OWASP ZAP API scan (DAST) of the running backend.
# Prerequisite: the stack is up from the root folder (docker compose up -d --build).
# Usage (from csp-backend):  .\security\zap\run-zap.ps1
# Output: security/zap/reports/zap-backend-report.html (+ .json), gitignored.

$ErrorActionPreference = "Stop"
$zapDir = $PSScriptRoot
$compose = Join-Path $zapDir "..\..\..\docker-compose.yaml"

$backend = docker compose -f $compose ps -q backend
if (-not $backend) { throw "Backend container is not running. Run 'docker compose up -d --build' from the root folder first." }

New-Item -ItemType Directory -Force (Join-Path $zapDir "reports") | Out-Null

# --network container:<backend> lets ZAP reach the API at localhost:5000 inside the backend container.
# zap-api-scan.py imports the OpenAPI spec, runs the passive scan, then an active scan (real attack payloads).
# Only run it against your local Docker stack, never against production.
# ZAP logs to stderr; Windows PowerShell 5.1 would treat that as a fatal error under "Stop".
$ErrorActionPreference = "Continue"
docker run --rm `
  --network "container:$backend" `
  -v "${zapDir}:/zap/wrk:rw" `
  ghcr.io/zaproxy/zaproxy:stable `
  zap-api-scan.py `
  -t /zap/wrk/openapi-public.yaml `
  -f openapi `
  -O http://localhost:5000 `
  -r reports/zap-backend-report.html `
  -J reports/zap-backend-report.json `
  -I

# Exit codes: 0 = no alerts at FAIL level, 1 = FAIL alerts, 3 = ZAP error. Warnings never fail (-I).
Write-Host "ZAP exit code: $LASTEXITCODE"
Write-Host "Report: $(Join-Path $zapDir 'reports\zap-backend-report.html')"
