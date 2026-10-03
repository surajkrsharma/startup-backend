param(
  [Parameter(Mandatory = $true)][string]$Script,
  [int]$TimeoutSec = 420
)

<#
  Runs an e2e script and waits for it to finish, instead of polling in 30s slices.
  The job runs detached so an aborted tool call cannot kill it; we block on its
  exit code and then print the summary plus any failures.
#>

$name = [System.IO.Path]::GetFileNameWithoutExtension($Script)
$out = Join-Path $env:TEMP ('opencode\run-' + $name + '.out.log')

New-Item -ItemType Directory -Path (Split-Path $out) -Force | Out-Null
Remove-Item $out -ErrorAction SilentlyContinue

$job = Start-Job -ScriptBlock {
  param($dir, $s, $o)
  Set-Location $dir
  & npx tsx $s *>&1 | Out-File -FilePath $o -Encoding utf8
} -ArgumentList $PWD.Path, $Script, $out

$done = Wait-Job $job -Timeout $TimeoutSec

if (-not $done) {
  Write-Output ('TIMEOUT after ' + $TimeoutSec + 's - still running')
  Stop-Job $job -ErrorAction SilentlyContinue
}

Remove-Job $job -Force -ErrorAction SilentlyContinue

Write-Output ('===== ' + $name + ' =====')
$lines = Get-Content $out -ErrorAction SilentlyContinue
$lines | Select-String -Pattern 'checks passed' | ForEach-Object { $_.Line }
$lines | Select-String -Pattern '^FAIL' | ForEach-Object { $_.Line }

if (-not ($lines | Select-String -Pattern 'checks passed')) {
  Write-Output '--- last lines ---'
  $lines | Select-Object -Last 6
}