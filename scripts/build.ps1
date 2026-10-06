param([string]$OutputDirectory = '')
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
if (!$OutputDirectory) { $OutputDirectory = Join-Path $repoRoot 'dist' }
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (!(Test-Path -LiteralPath $compiler)) { throw 'Windows .NET Framework 4 compiler not found.' }
$references = @('/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll','/reference:System.Web.Extensions.dll')
$commonArgs = @('/nologo','/platform:x64','/optimize+','/codepage:65001') + $references
$launcher = Join-Path $OutputDirectory 'StrongholdLocalTools.exe'
& $compiler @commonArgs /target:winexe "/out:$launcher" (Join-Path $repoRoot 'src\Common.cs') (Join-Path $repoRoot 'src\Launcher.cs')
if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed.' }
$resources = @("/resource:$launcher,payload.StrongholdLocalTools.exe")
foreach ($file in @('game-api.mjs','local-tools.mjs','panel.js','server.mjs')) { $resources += '/resource:' + (Join-Path $repoRoot "payload\$file") + ',payload.' + $file }
foreach ($file in @('LICENSE','NOTICE.md')) { $resources += '/resource:' + (Join-Path $repoRoot $file) + ',payload.' + $file }
$setup = Join-Path $OutputDirectory 'Stronghold-Protocol-Trainer-Setup.exe'
& $compiler @commonArgs /target:winexe "/out:$setup" @resources (Join-Path $repoRoot 'src\Common.cs') (Join-Path $repoRoot 'src\Setup.cs')
if ($LASTEXITCODE -ne 0) { throw 'Installer compilation failed.' }
# Console build shares exactly the same installer logic for repeatable integration tests.
& $compiler @commonArgs /target:exe "/out:$OutputDirectory\Setup.Console.exe" @resources (Join-Path $repoRoot 'src\Common.cs') (Join-Path $repoRoot 'src\Setup.cs')
if ($LASTEXITCODE -ne 0) { throw 'Installer CLI compilation failed.' }
Get-Item -LiteralPath $setup | Select-Object FullName,Length
