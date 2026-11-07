# Install kc for Windows x64 from the newest GitHub release (pre-releases included).
$ErrorActionPreference = 'Stop'
$repo = 'aikongen/knowledge-capsules'
$asset = 'kc-windows-x64.exe'
$dir = Join-Path $env:LOCALAPPDATA 'kc'
$tmp = Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid())
New-Item -ItemType Directory -Force -Path $tmp, $dir | Out-Null
if (Get-Command gh -ErrorAction SilentlyContinue) {
  # "latest" on GitHub skips pre-releases, so resolve the newest tag including them.
  $tag = (gh release list --repo $repo --limit 1 --json tagName --jq '.[0].tagName').Trim()
  gh release download $tag --repo $repo --pattern $asset --pattern SHA256SUMS --dir $tmp
} else {
  $tag = (Invoke-RestMethod "https://api.github.com/repos/$repo/releases?per_page=1")[0].tag_name
  $base = "https://github.com/$repo/releases/download/$tag"
  Invoke-WebRequest "$base/$asset" -OutFile (Join-Path $tmp $asset)
  Invoke-WebRequest "$base/SHA256SUMS" -OutFile (Join-Path $tmp 'SHA256SUMS')
}
$expected = ((Get-Content (Join-Path $tmp 'SHA256SUMS')) | Where-Object { $_ -match [regex]::Escape($asset) + '$' }) -split '\s+' | Select-Object -First 1
$actual = (Get-FileHash (Join-Path $tmp $asset) -Algorithm SHA256).Hash.ToLower()
if ($expected -ne $actual) { throw "kc: checksum mismatch for $asset" }
Copy-Item (Join-Path $tmp $asset) (Join-Path $dir 'kc.exe') -Force
Remove-Item -Recurse -Force $tmp
Write-Host "kc installed to $dir\kc.exe. Add that folder to your PATH, then run: kc --help"
