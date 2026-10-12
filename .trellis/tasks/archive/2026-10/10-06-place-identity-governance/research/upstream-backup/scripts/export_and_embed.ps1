# 一键：导出城市地点库 → 导入 tripweaver → 回填 embedding
# 用法（在 xhs-travel-pipeline 根目录）：
#   .\scripts\export_and_embed.ps1 -City 北京
#   .\scripts\export_and_embed.ps1 -City 北京,成都
#   .\scripts\export_and_embed.ps1 -City 成都 -Tables places
#   .\scripts\export_and_embed.ps1 -City 杭州 -WithImages   # 附带导出景点封面图
param(
    [Parameter(Mandatory = $true)]
    [string[]]$City,
    [ValidateSet('places', 'evidence', 'both')]
    [string]$Tables = 'both',
    # 全量重建：先清 source='xhs' 数据再导（用于剔除旧垃圾语料；会重算全部向量，慢）
    [switch]$Purge,
    # 附带导出景点封面图（webp → tripweaver/data/media）并写入 payload.coverImage
    [switch]$WithImages
)

$ErrorActionPreference = 'Stop'
$Pipeline = 'D:\Project\xhs-travel-pipeline'
$Server = 'D:\Project\tripweaver\apps\server'
$Py = Join-Path $Pipeline '.venv\Scripts\python.exe'
$ImportDir = 'D:\Project\tripweaver\import'

if (-not (Test-Path $Py)) { throw "找不到 $Py" }

$env:PYTHONIOENCODING = 'utf-8'
$cities = @($City | ForEach-Object { $_ -split '[,，]' } | Where-Object { $_ })
$purgePending = [bool]$Purge
foreach ($c in $cities) {
    $out = Join-Path $ImportDir "xhs-places-$c.json"
    Write-Host "== 导出 $c =="
    $env:CITY = $c
    & $Py (Join-Path $Pipeline 'scripts\export_to_tripweaver.py') --out $out
    if ($LASTEXITCODE -ne 0) { throw "导出失败: $c" }

    Write-Host "== 入库 $c =="
    Push-Location $Server
    try {
        $seedArgs = @('scripts/seed-xhs-places.ts', '--input', $out)
        if ($purgePending) {
            $seedArgs += '--purge'
            $purgePending = $false
        }
        npx --yes tsx @seedArgs
        if ($LASTEXITCODE -ne 0) { throw "入库失败: $c" }
    }
    finally { Pop-Location }

    if ($WithImages) {
        Write-Host "== 导出景点封面图 $c =="
        $imgManifest = Join-Path $ImportDir "xhs-place-images-$c.json"
        & $Py (Join-Path $Pipeline 'scripts\export_place_images.py') --city $c --out $imgManifest
        if ($LASTEXITCODE -ne 0) { throw "图片导出失败: $c" }

        Write-Host "== 封面 key 入库 $c =="
        Push-Location $Server
        try {
            # 必须在上面 seed-xhs-places 之后：地点行不存在就无处写 key
            npx --yes tsx scripts/seed-xhs-place-images.ts --input $imgManifest
            if ($LASTEXITCODE -ne 0) { throw "封面入库失败: $c" }
        }
        finally { Pop-Location }
    }
}

Write-Host '== 回填向量 =='
Push-Location $Server
try {
    if ($Tables -eq 'both') {
        npx --yes tsx scripts/embed-backfill.ts
    }
    else {
        npx --yes tsx scripts/embed-backfill.ts --tables $Tables
    }
    if ($LASTEXITCODE -ne 0) { throw '向量回填失败' }
}
finally { Pop-Location }

Write-Host '完成：地点、语料、向量已对齐'
