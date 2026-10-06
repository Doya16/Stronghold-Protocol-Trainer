param([Parameter(Mandatory=$true)][string]$GameRoot)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$GameRoot = (Resolve-Path -LiteralPath $GameRoot).Path
$setup = Join-Path $repoRoot 'dist\Setup.Console.exe'
$testBase = Join-Path $repoRoot 'test-output'
$target = Join-Path $testBase ('安装 空格 & test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $target -Force | Out-Null
$keep = Join-Path $target 'keep-user-file.txt'
[IO.File]::WriteAllText($keep,'must survive')
function Invoke-Setup([string]$Action, [int]$Expected=0) {
    $output = & $setup "--$Action" $target 2>&1
    if ($LASTEXITCODE -ne $Expected) { throw "Unexpected installer exit for ${Action}: $LASTEXITCODE $output" }
}
try {
    Invoke-Setup 'install' 1
    if (Test-Path -LiteralPath (Join-Path $target 'sp-local-tools')) { throw 'Invalid target was modified' }
    # Minimal copied fixture tests installer operations; live launcher is tested against the real game separately.
    foreach($rel in @('package.json','server\index.js','server\match\PlayerState.js','shared\constants.js','public\index.html','public\js\ui\assetUrls.js','data\items.json','data\chess.json','data\assets.json','node_modules\ws\package.json','runtime\node.exe')) {
        $dest=Join-Path $target $rel
        New-Item -ItemType Directory -Path (Split-Path -Parent $dest) -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $GameRoot $rel) -Destination $dest
    }
    New-Item -ItemType Directory -Path (Join-Path $target 'public\assets') -Force | Out-Null
    $addon=Join-Path $target 'sp-local-tools'
    Invoke-Setup 'install'
    if (!(Test-Path -LiteralPath (Join-Path $addon 'StrongholdLocalTools.exe'))) { throw 'Missing launcher' }
    Invoke-Setup 'install'
    Invoke-Setup 'disable'
    if (!(Test-Path -LiteralPath (Join-Path $addon 'disabled'))) { throw 'Disable marker missing' }
    Invoke-Setup 'install'
    if (Test-Path -LiteralPath (Join-Path $addon 'disabled')) { throw 'Enable failed' }
    [IO.File]::WriteAllText((Join-Path $addon 'user-added.txt'),'keep')
    Invoke-Setup 'uninstall' 1
    if (!(Test-Path -LiteralPath (Join-Path $addon 'user-added.txt'))) { throw 'User-added file removed' }
    Remove-Item -LiteralPath (Join-Path $addon 'user-added.txt')
    Invoke-Setup 'uninstall'
    if (Test-Path -LiteralPath $addon) { throw 'Uninstall left addon' }
    if ([IO.File]::ReadAllText($keep) -ne 'must survive') { throw 'Touched original file' }
    if (!(Test-Path -LiteralPath (Join-Path $target 'server\index.js'))) { throw 'Touched game source' }
    # A similarly named directory without our marker must never be overwritten.
    New-Item -ItemType Directory -Path $addon | Out-Null
    [IO.File]::WriteAllText((Join-Path $addon 'foreign.txt'),'foreign')
    Invoke-Setup 'install' 1
    if ([IO.File]::ReadAllText((Join-Path $addon 'foreign.txt')) -ne 'foreign') { throw 'Foreign directory changed' }
    Write-Output 'PASS: invalid path, Unicode/space/& path, install, repeat install, disable, enable, uninstall, user file preservation, foreign directory rejection.'
}
finally {
    $resolved=[IO.Path]::GetFullPath($target)
    if (!$resolved.StartsWith([IO.Path]::GetFullPath($testBase)+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Cleanup path outside test-output' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
