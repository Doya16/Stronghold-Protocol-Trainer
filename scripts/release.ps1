param([string]$Version = '0.2.0')
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
& (Join-Path $PSScriptRoot 'build.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
$dist=Join-Path $repoRoot 'dist'
$bundle=Join-Path $dist ('Stronghold-Protocol-Trainer-v'+$Version+'-win-x64')
New-Item -ItemType Directory -Path $bundle -Force | Out-Null
foreach($file in @('README.md','LICENSE','NOTICE.md','CHANGELOG.md')) { Copy-Item -LiteralPath (Join-Path $repoRoot $file) -Destination $bundle -Force }
Copy-Item -LiteralPath (Join-Path $dist 'Stronghold-Protocol-Trainer-Setup.exe') -Destination $bundle -Force
Copy-Item -LiteralPath (Join-Path $repoRoot 'docs') -Destination $bundle -Recurse -Force
$zip=$bundle+'.zip'
Compress-Archive -LiteralPath $bundle -DestinationPath $zip -Force
$hash=(Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText((Join-Path $dist 'SHA256SUMS.txt'),$hash+'  '+[IO.Path]::GetFileName($zip)+[Environment]::NewLine)
Get-Item -LiteralPath $zip | Select-Object FullName,Length
