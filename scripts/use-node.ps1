# Dot-source to use IELTiva's Node 24 in this terminal only: . .\scripts\use-node.ps1
$nodeDir = Join-Path $env:LOCALAPPDATA 'IELTiva-tools\node-v24.22.1-win-x64'
if (-not (Test-Path (Join-Path $nodeDir 'node.exe'))) { throw "Node 24 not found at $nodeDir. See README.md." }
$env:Path = "$nodeDir;$env:Path"
"Using Node $(node -v) and npm $(npm -v) in this terminal"
