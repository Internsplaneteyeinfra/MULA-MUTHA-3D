$ErrorActionPreference = "SilentlyContinue"
$targets = @(
  "$env:LOCALAPPDATA\Temp\*.tmp",
  "$env:LOCALAPPDATA\Temp\*.log"
)
Get-ChildItem "$env:LOCALAPPDATA\Temp" -File | Where-Object { $_.Length -gt 500KB } | Remove-Item -Force
$assets = "C:\Users\Sahil.Rajankar\.cursor\projects\c-Users-Sahil-Rajankar-Desktop-Shweta-RIVEREYE\assets"
if (Test-Path $assets) {
  Get-ChildItem $assets -Recurse -File -Filter *.png | Sort-Object Length -Descending | Select-Object -First 20 | ForEach-Object {
    Write-Host ("PNG " + $_.Length + " " + $_.FullName)
  }
}
Write-Host ("FREE=" + (Get-PSDrive C).Free)
