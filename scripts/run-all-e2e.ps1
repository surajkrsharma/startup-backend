param([int]$TimeoutSec = 900)

<#
  Runs every live e2e suite in sequence and prints a single pass/fail table.
  Each suite is run detached and waited on, so an aborted tool call cannot kill
  a run half way and leave the shared database dirty.
#>

$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot\..
$root = $PWD.Path

$suites = @(
  'e2e-smoke.ts',
  'e2e-user-vendor.ts',
  'e2e-product.ts',
  'e2e-catalog.ts',
  'e2e-cart.ts',
  'e2e-order.ts',
  'e2e-payment.ts',
  'e2e-review.ts',
  'e2e-shipping.ts',
  'e2e-notification.ts',
  'e2e-analytics.ts',
  'e2e-content.ts',
  'e2e-engagement.ts',
  'e2e-encryption.ts'
)

$outDir = Join-Path $env:TEMP 'opencode\all-e2e'
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

# The suites share one database, and the SUPER_ADMIN account is the login for
# every staff route, so a reset database has to be seeded first.
Write-Output 'Seeding (idempotent)...'
& npx tsx prisma/seed.ts *>&1 | Out-Null

$results = @()

foreach ($suite in $suites) {
  $name = [System.IO.Path]::GetFileNameWithoutExtension($suite)
  $log = Join-Path $outDir ($name + '.log')
  Remove-Item $log -ErrorAction SilentlyContinue

  $job = Start-Job -ScriptBlock {
    param($dir, $s, $o)
    Set-Location $dir
    & npx tsx $s *>&1 | Out-File -FilePath $o -Encoding utf8
  } -ArgumentList $root, "scripts/$suite", $log

  $done = Wait-Job $job -Timeout $TimeoutSec
  if (-not $done) {
    $results += [pscustomobject]@{ Suite = $name; Summary = "TIMEOUT ${TimeoutSec}s"; Failed = -1 }
    Stop-Job $job -ErrorAction SilentlyContinue
  }
  Remove-Job $job -Force -ErrorAction SilentlyContinue

  $lines = Get-Content $log -ErrorAction SilentlyContinue
  $passed = ($lines | Select-String -Pattern 'checks passed' | Select-Object -Last 1).Line
  $fails = @($lines | Select-String -Pattern '^FAIL')

  $summary = if ($passed) { ($passed -replace '\s+', ' ').Trim() } else { 'no summary (crashed)' }
  $results += [pscustomobject]@{ Suite = $name; Summary = $summary; Failed = $fails.Count }

  if ($fails.Count -gt 0) {
    Write-Output ''
    Write-Output "--- $name failures ---"
    $fails | ForEach-Object { Write-Output $_.Line }
  }
}

Write-Output ''
Write-Output '==================== ALL SUITES ===================='
$results | ForEach-Object { '{0,-18} {1,-28} fail={2}' -f $_.Suite, $_.Summary, $_.Failed }
Write-Output '===================================================='

$bad = @($results | Where-Object { $_.Failed -ne 0 })
if ($bad.Count -gt 0) {
  Write-Output ''
  Write-Output ("SUITES WITH FAILURES: " + $bad.Count)
  exit 1
}
Write-Output 'ALL SUITES PASSED'