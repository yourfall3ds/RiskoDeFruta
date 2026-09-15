$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$runtimeTemporary = Join-Path $PSScriptRoot '.temp'
New-Item -ItemType Directory -Path $runtimeTemporary -Force | Out-Null
$env:TEMP = $runtimeTemporary
$env:TMP = $runtimeTemporary
$env:npm_config_cache = Join-Path $PSScriptRoot '.npm-cache'
npm run dev
