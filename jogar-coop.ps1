# Sobe o servidor e o cliente e imprime as quatro URLs do teste de co-op.
#
# Uso:  .\jogar-coop.ps1
#
# Por que um script e nao "roda dois comandos": os dois processos precisam ficar VIVOS ao mesmo
# tempo, em janelas separadas, e a sala so junta os quatro jogadores se todos usarem a MESMA
# semente -- `FarmRoom` e registrada com `filterBy(['seed'])`, entao semente diferente cria sala
# diferente e o teste falharia por motivo nenhum.

$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
$node = 'C:\Users\Dariox\AppData\Local\Temp\claude\rdf\tools\node'
if (Test-Path $node) { $env:Path = "$node;$env:Path" }

# Semente fixa por execucao. Mesma semente = mesma sala para os quatro.
$seed = -join ((1..16) | ForEach-Object { '0123456789abcdef'[(Get-Random -Maximum 16)] })

Write-Host ''
Write-Host '  Subindo servidor (Colyseus) e cliente (Vite)...' -ForegroundColor Cyan

Start-Process powershell -ArgumentList '-NoExit','-Command',"cd '$repo'; `$env:Path='$node;'+`$env:Path; npm run server" -WindowStyle Normal
Start-Process powershell -ArgumentList '-NoExit','-Command',"cd '$repo'; `$env:Path='$node;'+`$env:Path; npm run dev"    -WindowStyle Normal

# O Vite costuma responder em poucos segundos; o Colyseus e mais rapido. Espero pela porta do
# cliente porque e ela que a janela do navegador precisa.
$pronto = $false
foreach ($i in 1..40) {
  Start-Sleep -Milliseconds 500
  try {
    $c = New-Object Net.Sockets.TcpClient
    $c.Connect('127.0.0.1', 5173)
    $c.Close()
    $pronto = $true
    break
  } catch { }
}

$url = "http://localhost:5173/?online=1&seed=$seed"

Write-Host ''
if ($pronto) { Write-Host '  Cliente no ar.' -ForegroundColor Green }
else { Write-Host '  Nao consegui confirmar a porta 5173 -- confira a janela do Vite.' -ForegroundColor Yellow }
Write-Host ''
Write-Host '  Abra QUATRO janelas do navegador nesta URL (a mesma para os quatro):' -ForegroundColor White
Write-Host ''
Write-Host "    $url" -ForegroundColor Yellow
Write-Host ''
Write-Host '  A semente e a mesma de proposito: e ela que coloca os quatro na MESMA sala.' -ForegroundColor DarkGray
Write-Host '  Sem ?online=1 o jogo roda single-player e o teste nao prova nada.' -ForegroundColor DarkGray
Write-Host ''

$abrir = Read-Host '  Abrir as quatro janelas agora? (s/N)'
if ($abrir -eq 's' -or $abrir -eq 'S') {
  foreach ($i in 1..4) { Start-Process $url; Start-Sleep -Milliseconds 900 }
  Write-Host '  Quatro janelas abertas. PAU NA HORDA.' -ForegroundColor Green
}
