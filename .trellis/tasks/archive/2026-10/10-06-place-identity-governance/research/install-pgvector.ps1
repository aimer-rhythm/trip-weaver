param([switch]$Apply)
$ErrorActionPreference = 'Stop'
$sourceRoot = [IO.Path]::GetFullPath('D:/Project/tripweaver/data/pgvector-build/pgvector-0.8.2')
$installRoot = 'C:/Program Files/PostgreSQL/16'
$files = @(
  @{ Source = Join-Path $sourceRoot 'vector.dll'; Destination = "$installRoot/lib/vector.dll" },
  @{ Source = Join-Path $sourceRoot 'vector.control'; Destination = "$installRoot/share/extension/vector.control" },
  @{ Source = Join-Path $sourceRoot 'sql/vector--0.8.2.sql'; Destination = "$installRoot/share/extension/vector--0.8.2.sql" }
)
foreach ($file in $files) {
  if (-not (Test-Path -LiteralPath $file.Source)) { throw "构建产物不存在：$($file.Source)" }
  if (Test-Path -LiteralPath $file.Destination) {
    if ((Get-FileHash -LiteralPath $file.Source).Hash -ne (Get-FileHash -LiteralPath $file.Destination).Hash) {
      throw "目标已有其他版本，停止覆盖：$($file.Destination)"
    }
  }
}
foreach ($file in $files) {
  if ($Apply -and -not (Test-Path -LiteralPath $file.Destination)) {
    Copy-Item -LiteralPath $file.Source -Destination $file.Destination
  }
  [PSCustomObject]@{ Source = $file.Source; Destination = $file.Destination; SHA256 = (Get-FileHash -LiteralPath $file.Source).Hash; Applied = [bool]$Apply }
}
