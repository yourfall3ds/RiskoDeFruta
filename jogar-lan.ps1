# Co-op em LAN com um clique: compila a versao de producao, sobe o servidor de jogo e o site, e
# mostra o endereco que o OUTRO PC abre. Tudo na mesma sala (semente fixa "casa").
#
# Por que producao e nao `npm run dev`: o modo de desenvolvimento serve milhares de modulos soltos,
# sem compactar, e recarrega a pagina dos dois PCs a cada arquivo salvo. Para JOGAR, e a versao
# compilada (`npm run build` + `vite preview`), que carrega rapido e nao recarrega sozinha.
#
# Uso: duplo clique em JOGAR-LAN.cmd (ou .\jogar-lan.ps1).

$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
Set-Location $repo

function Porta-Ocupada([int]$porta) {
  try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1', $porta); $c.Close(); return $true } catch { return $false }
}

# O IP desta maquina na rede local (o mesmo que o servidor anuncia).
$ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -match '^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))\.' -and $_.PrefixOrigin -ne 'WellKnown' } |
  Select-Object -First 1).IPAddress
if (-not $ip) { $ip = 'localhost' }

Write-Host ''
Write-Host '  Compilando o jogo (versao de producao)...' -ForegroundColor Cyan
npm run build | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Host '  A compilacao falhou. Rode "npm run build" para ver o erro.' -ForegroundColor Red; exit 1 }

if (Porta-Ocupada 2567) { Write-Host '  Servidor de jogo ja estava no ar (porta 2567).' -ForegroundColor DarkGray }
else { Start-Process powershell -ArgumentList '-NoExit', '-Command', "cd '$repo'; npm run server" -WindowStyle Minimized }

if (Porta-Ocupada 5173) { Write-Host '  Site ja estava no ar (porta 5173).' -ForegroundColor DarkGray }
else { Start-Process powershell -ArgumentList '-NoExit', '-Command', "cd '$repo'; npm run preview -- --port 5173 --strictPort" -WindowStyle Minimized }

foreach ($i in 1..60) { if ((Porta-Ocupada 2567) -and (Porta-Ocupada 5173)) { break }; Start-Sleep -Milliseconds 500 }

$url = "http://${ip}:5173/?online=1&seed=casa"
Write-Host ''
Write-Host '  PRONTO. Os dois PCs abrem este endereco:' -ForegroundColor Green
Write-Host ''
Write-Host "      $url" -ForegroundColor Yellow
Write-Host ''
Write-Host '  (as janelas minimizadas sao o servidor e o site; feche-as para desligar)' -ForegroundColor DarkGray
Start-Process $url
