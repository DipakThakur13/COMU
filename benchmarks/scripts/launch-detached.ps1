<#
.SYNOPSIS
Starts a benchmark run that outlives the shell that launched it.

.DESCRIPTION
B0 died at 31 of 75 cells and B1 at 2 of 15, each with the shell that started it. A process started
from a shell, including one started hidden with Start-Process, is that shell's descendant and is
killed with it. This asks WMI (Win32_Process.Create) to start the run instead: the process is
created by the WMI provider host, so it has no parent in the launching shell's tree and nothing
that ends the shell reaches it.

Verified on this machine on 2026-09-24 against the three candidates: a node parent spawned a shell,
the shell started one heartbeat by each method, and the shell's tree and then the node parent were
killed. The Start-Process heartbeat died with them; the WMI and scheduled-task heartbeats kept
writing. WMI is used because it leaves nothing registered behind.

The run's output goes to results\<Label>.console.log. Sleep is switched off for the run and
restored to the values found at launch when the run ends, however it ends, because the restore is
done by the detached wrapper and not by the run. The provider key is read by the benchmark from
benchmarks\.env.local; it is never on this command line or in the wrapper.

.EXAMPLE
powershell -File benchmarks\scripts\launch-detached.ps1 -Label B1 -Bench "--reps 1 --model nvidia/nemotron-3.5-lightning-30b-a3b --limits-file results\B0.limits.json --concurrency 2 --redo-provider-failures"

Then, from any shell: pnpm --filter @comu/benchmark bench --status --label B1 --reps 1

The benchmark's own arguments go in one string, split on whitespace: under -File, PowerShell reads
a bare "--" as a parameter name, so they cannot follow as loose arguments.
#>
param(
  [Parameter(Mandatory = $true)] [string] $Label,
  [string] $Bench = ""
)
$ErrorActionPreference = "Stop"
$BenchArgs = @($Bench -split '\s+' | Where-Object { $_ })

$bench = Split-Path -Parent $PSScriptRoot
$results = Join-Path $bench "results"
$log = Join-Path $results "$Label.console.log"
$wrapper = Join-Path $results "$Label.launch.cmd"
$node = (Get-Command node).Source
$tsx = Join-Path $bench "node_modules\tsx\dist\cli.mjs"
if (-not (Test-Path $tsx)) { throw "tsx is not installed under $bench; run pnpm install first." }

if ($Label -notmatch '^[A-Za-z0-9._-]+$') { throw "Label '$Label' must be letters, digits, dot, dash or underscore." }

# The arguments are written into a .cmd file, so they must hold nothing cmd would interpret and
# nothing that could be a credential: a key in the wrapper is a key on disk.
foreach ($arg in $BenchArgs) {
  if ($arg -match '["%^&|<>!]') { throw "Argument '$arg' contains a character cmd would interpret. Pass a budget with --limits-file, not --limits." }
  if ($arg -match '(nvapi-|sk-|exp-)[A-Za-z0-9_-]{16,}' -or $arg -match '^--(api-?key|key|token|secret)') {
    throw "An argument looks like a credential. The benchmark reads its key from benchmarks\.env.local."
  }
}

function Get-StandbySeconds([string] $Power) {
  $line = powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE | Select-String "Current $Power Power Setting Index"
  return [Convert]::ToInt32(($line.ToString() -split ':')[-1].Trim(), 16)
}
$acMinutes = [int][Math]::Round((Get-StandbySeconds "AC") / 60)
$dcMinutes = [int][Math]::Round((Get-StandbySeconds "DC") / 60)
if ($acMinutes -eq 0 -and $dcMinutes -eq 0) {
  Write-Warning "Sleep is already off (AC 0, DC 0). That is what will be restored; a previous run may have died before restoring it."
}

$quoted = $BenchArgs -join ' '
$lines = @(
  '@echo off',
  "cd /d `"$bench`"",
  "echo [launcher] %DATE% %TIME% started, sleep off for the run >> `"$log`"",
  'powercfg /change standby-timeout-ac 0',
  'powercfg /change standby-timeout-dc 0',
  "`"$node`" `"$tsx`" --conditions=development src/cli.ts --label $Label $quoted >> `"$log`" 2>&1",
  'set CODE=%ERRORLEVEL%',
  "powercfg /change standby-timeout-ac $acMinutes",
  "powercfg /change standby-timeout-dc $dcMinutes",
  "echo [launcher] %DATE% %TIME% bench exited %CODE%, sleep restored to AC $acMinutes min, DC $dcMinutes min >> `"$log`"",
  'exit /b %CODE%'
)
Set-Content -Path $wrapper -Value $lines -Encoding ascii

$created = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
  CommandLine = "cmd.exe /d /c `"$wrapper`""
  CurrentDirectory = $bench
}
if ($created.ReturnValue -ne 0) { throw "Win32_Process.Create returned $($created.ReturnValue); nothing was started." }

Write-Output "Started '$Label' detached: wrapper pid $($created.ProcessId), created by WMI, outside this shell's tree."
Write-Output "Log:    $log"
Write-Output "Status: pnpm --filter @comu/benchmark bench --status --label $Label (plus the run's --reps, --tier or --fixture)"
Write-Output "Sleep is off while it runs and returns to AC $acMinutes min, DC $dcMinutes min when it ends."
