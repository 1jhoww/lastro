# Invoke the npm CLI beside node without changing global npm configuration.
# Prefer a supported PATH runtime; never silently reuse an obsolete portable runtime.
$taskSystemNodePath = (Get-Command node -ErrorAction Stop).Source
$taskBackendRoot = Split-Path -Parent $PSScriptRoot
$taskRepoRoot = Split-Path -Parent $taskBackendRoot
$taskMinimum = [version](Get-Content -LiteralPath (Join-Path $taskBackendRoot '.node-version') -Raw).Trim()
$taskNodeCandidates = @(
  $taskSystemNodePath,
  (Join-Path $taskRepoRoot "frontend\.local\saneamento\node24\node-v$taskMinimum-win-x64\node.exe"),
  (Join-Path $taskBackendRoot '.cache\runtime\node.exe')
)
$taskNodePath = $null
foreach ($taskCandidate in $taskNodeCandidates) {
  if (-not (Test-Path -LiteralPath $taskCandidate)) { continue }
  $taskVersionText = & $taskCandidate -p 'process.versions.node'
  $taskVersion = $null
  if ([version]::TryParse($taskVersionText, [ref]$taskVersion) -and
      $taskVersion.Major -eq $taskMinimum.Major -and $taskVersion -ge $taskMinimum) {
    $taskNodePath = $taskCandidate
    break
  }
}
if (-not $taskNodePath) { throw "Instale Node >=$taskMinimum <25 no PATH. Runtime portátil antigo não será usado." }
$taskNpmCandidates = @(
  (Join-Path (Split-Path -Parent $taskNodePath) 'node_modules\npm\bin\npm-cli.js'),
  (Join-Path (Split-Path -Parent $taskSystemNodePath) 'node_modules\npm\bin\npm-cli.js')
)
$taskNpmCli = $taskNpmCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $taskNpmCli) { throw 'npm CLI não encontrado. Instale Node LTS com npm.' }
$env:Path = (Split-Path -Parent $taskNodePath) + [IO.Path]::PathSeparator + $env:Path
& $taskNodePath $taskNpmCli @args
exit $LASTEXITCODE
