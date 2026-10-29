# M3.7: graceful stop for the Quiver API on Windows (Task Scheduler job). Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\ops\stop-api.ps1 [-Port 8987] [-Task "QuiverApi"]  (defaults match the VPS)
# Reads OPS_TOKEN from the environment (never pass it on the command line). Falls back to schtasks /end
# only if the process did not exit on its own (that fallback is a hard kill: no flush).
param([int]$Port = 8987, [string]$Task = "QuiverApi", [int]$WaitSec = 10)
if (-not $env:OPS_TOKEN) { Write-Error "OPS_TOKEN is not set in this shell"; exit 2 }
try {
  $r = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$Port/v1/ops/shutdown" -Headers @{ Authorization = "Bearer $env:OPS_TOKEN" } -TimeoutSec 5
  Write-Host "shutdown accepted; active runs at stop: $($r.activeRuns)"
} catch { Write-Warning "shutdown request failed: $($_.Exception.Message)" }
for ($i = 0; $i -lt $WaitSec; $i++) {
  Start-Sleep -Seconds 1
  if (-not (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) { Write-Host "API stopped cleanly"; exit 0 }
}
Write-Warning "API still listening after $WaitSec s; falling back to schtasks /end (hard kill, no flush)"
schtasks /end /tn $Task
exit 1
