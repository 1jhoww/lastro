# Invoke the npm CLI beside node without changing global npm configuration.
# Use the verified backend-local runtime when present, without changing global installations.
$taskSystemNodePath = (Get-Command node -ErrorAction Stop).Source
$taskPortableNodePath = Join-Path (Split-Path -Parent $PSScriptRoot) '.cache\runtime\node.exe'
$taskNodePath = if (Test-Path -LiteralPath $taskPortableNodePath) { $taskPortableNodePath } else { $taskSystemNodePath }
$taskNpmCandidates = @(
  (Join-Path (Split-Path -Parent $taskNodePath) 'node_modules\npm\bin\npm-cli.js'),
  (Join-Path (Split-Path -Parent $taskSystemNodePath) 'node_modules\npm\bin\npm-cli.js')
)
$taskNpmCli = $taskNpmCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $taskNpmCli) { throw 'npm CLI não encontrado. Instale Node LTS com npm.' }
$env:Path = (Split-Path -Parent $taskNodePath) + [IO.Path]::PathSeparator + $env:Path
& $taskNodePath $taskNpmCli @args
exit $LASTEXITCODE
