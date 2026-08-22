# Keep this script UTF-8 with BOM so Windows PowerShell 5.1 reads the release filenames correctly.
param(
    [Parameter(Mandatory = $true)]
    [string] $Server,

    [Parameter(Mandatory = $true)]
    [string] $Output
)

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$serverPath = [IO.Path]::GetFullPath($Server)
$outputPath = [IO.Path]::GetFullPath($Output)
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$tempPrefix = $tempRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$stageRoot = Join-Path $tempRoot ('MoYuQi-package-' + [Guid]::NewGuid().ToString('N'))
$outputCreated = $false

if (-not (Test-Path -LiteralPath $serverPath -PathType Leaf)) {
    throw "Portable packaging tool not found: $serverPath"
}
if (Test-Path -LiteralPath $outputPath) {
    throw "Output already exists: $outputPath"
}

function Add-StagedFile([string] $sourcePath, [string] $destinationPath) {
    $parent = Split-Path -Parent $destinationPath
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
        [void](New-Item -ItemType Directory -Path $parent -Force)
    }
    try {
        [void](New-Item -ItemType HardLink -Path $destinationPath -Target $sourcePath -ErrorAction Stop)
    } catch {
        Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
    }
}

function Add-StagedTree([string] $relativeDirectory) {
    $sourceRoot = Join-Path $projectRoot $relativeDirectory
    if (-not (Test-Path -LiteralPath $sourceRoot -PathType Container)) {
        throw "Required release directory is missing: $sourceRoot"
    }
    Get-ChildItem -LiteralPath $sourceRoot -Recurse -Force -File | ForEach-Object {
        $relative = $_.FullName.Substring($projectRoot.Length).TrimStart('\', '/')
        Add-StagedFile $_.FullName (Join-Path $stageRoot $relative)
    }
}

try {
    [void](New-Item -ItemType Directory -Path $stageRoot)
    Add-StagedTree 'Assert'
    Add-StagedTree 'run'

    $rootFiles = @(
        '启动游戏.bat',
        '启动游戏.command',
        '生成跨平台分享包.bat',
        '使用说明.txt',
        'THIRD_PARTY_NOTICES.txt'
    )
    foreach ($relative in $rootFiles) {
        $source = Join-Path $projectRoot $relative
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
            throw "Required release file is missing: $source"
        }
        Add-StagedFile $source (Join-Path $stageRoot $relative)
    }

    $stagedServer = Join-Path $stageRoot ('run\' + [IO.Path]::GetFileName($serverPath))
    & $stagedServer -root $stageRoot -package $outputPath
    $packagerExitCode = $LASTEXITCODE
    $outputCreated = Test-Path -LiteralPath $outputPath -PathType Leaf
    if ($packagerExitCode -ne 0) {
        throw "Portable packager exited with code $packagerExitCode."
    }
    if (-not $outputCreated) {
        throw 'Portable packager did not create the requested ZIP.'
    }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($outputPath)
    try {
        $entries = @($archive.Entries)
        $unsafeEntries = @($entries | Where-Object {
            $name = $_.FullName
            $segments = @($name -split '/')
            $name.Contains('\') -or
                $name.StartsWith('/') -or
                $name -match '^[A-Za-z]:' -or
                $segments -contains '.' -or
                $segments -contains '..'
        })
        if ($unsafeEntries.Count) {
            throw 'Release ZIP contains an unsafe entry path.'
        }

        $fileEntries = @($entries | Where-Object { -not $_.FullName.EndsWith('/') })
        $names = @($fileEntries | ForEach-Object { $_.FullName })
        $duplicateNames = @($names | Group-Object | Where-Object { $_.Count -gt 1 })
        if ($duplicateNames.Count) {
            throw 'Release ZIP contains duplicate or case-colliding entry paths.'
        }
        if (-not $names.Count) {
            throw 'Release ZIP contains no files.'
        }

        $rootSeparatorIndex = $names[0].IndexOf('/')
        if ($rootSeparatorIndex -le 0) {
            throw 'Release ZIP must contain one top-level game directory.'
        }
        $archiveRoot = $names[0].Substring(0, $rootSeparatorIndex)
        $archivePrefix = $archiveRoot + '/'
        $outsideRoot = @($entries | Where-Object {
            -not $_.FullName.StartsWith($archivePrefix, [StringComparison]::Ordinal)
        })
        if ($outsideRoot.Count) {
            throw 'Release ZIP contains entries outside its top-level game directory.'
        }
        $relativeNames = @($names | ForEach-Object { $_.Substring($archivePrefix.Length) })

        $expectedNames = @(Get-ChildItem -LiteralPath $stageRoot -Recurse -Force -File |
            ForEach-Object {
                $_.FullName.Substring($stageRoot.Length).TrimStart('\', '/').Replace('\', '/')
            })
        $manifestDifference = @(Compare-Object -ReferenceObject $expectedNames -DifferenceObject $relativeNames -CaseSensitive)
        if ($manifestDifference.Count) {
            $differenceSummary = ($manifestDifference | Select-Object -First 10 |
                ForEach-Object { "$( $_.SideIndicator ) $( $_.InputObject )" }) -join '; '
            throw "Release ZIP does not match the staged whitelist: $differenceSummary"
        }

        $forbidden = @($relativeNames | Where-Object {
            $_ -match '(^|/)(room-visual-candidates|collision-candidates)(/|$)'
        })
        if ($forbidden.Count) {
            throw 'Release ZIP unexpectedly contains candidate or audit files.'
        }

        foreach ($required in @(
            '启动游戏.bat',
            '启动游戏.command',
            '生成跨平台分享包.bat',
            '使用说明.txt',
            'run/game-server-windows-amd64.exe',
            'run/game-server-windows-arm64.exe',
            'run/game-server-macos-amd64',
            'run/game-server-macos-arm64',
            'run/serve.ps1',
            'run/package.ps1',
            'run/main_pro.html',
            'run/game-shell.js',
            'run/dream-flow.js',
            'run/dream-theme.css',
            'run/vendor/playcanvas-2.21.3.min.js',
            'run/voxel-collision.js',
            'run/upside-room/index.html',
            'run/upside-room/styles.css',
            'run/upside-room/integration.js',
            'run/upside-room/src/boot.js',
            'run/upside-room/src/app.js',
            'run/upside-room/vendor/playcanvas.min.js',
            'run/upside-room/vendor/ammo.wasm.js',
            'run/upside-room/vendor/ammo.wasm.wasm',
            'run/upside-room/vendor/ammo.js',
            'run/upside-room/vendor/LICENSE-playcanvas.txt',
            'run/upside-room/vendor/LICENSE-ammojs.txt',
            'run/upside-room/assets/replicacad/Baked_sc0_staging_00.uncompressed.glb',
            'run/upside-room/assets/replicacad/Baked_sc0_staging_00.collision.glb',
            'run/upside-room/assets/replicacad/Baked_sc0_staging_00.navigation-mask.json',
            'run/upside-room/assets/replicacad/Baked_sc1_staging_01.playcanvas.glb',
            'run/upside-room/assets/replicacad/Baked_sc1_staging_01.collision.glb',
            'run/upside-room/assets/replicacad/Baked_sc1_staging_01.navigation-mask.json',
            'run/greenhouse/index.html',
            'run/greenhouse/demo.bundle.js',
            'run/greenhouse/integration.js',
            'run/greenhouse/styles.css',
            'run/greenhouse/assets/Door_02.glb',
            'run/greenhouse/assets/Door_LowPoly_CC0.glb',
            'run/greenhouse/assets/Flower01.glb',
            'run/greenhouse/assets/Flower04.glb',
            'run/greenhouse/assets/Flower07.glb',
            'run/greenhouse/assets/Grass01.glb',
            'run/greenhouse/assets/JungleVine.png',
            'run/greenhouse/assets/JungleVine_03.png',
            'run/greenhouse/assets/JungleVine_04.png',
            'run/greenhouse/assets/JungleVine_05.png',
            'run/greenhouse/assets/JungleVine_07.png',
            'run/greenhouse/assets/Pot_Plant.glb',
            'run/greenhouse/assets/PUSHILIN_sunflower.png',
            'run/greenhouse/assets/Stage_Structure_Skylight.glb',
            'run/greenhouse/assets/sunflower.bin',
            'run/greenhouse/assets/sunflower.gltf',
            'run/greenhouse/assets/Table_Round_01.glb',
            'run/greenhouse/assets/Window_01.glb',
            'Assert/npc/black_cat_walk_game.glb',
            'Assert/ui/endless-dream-entry.jpg',
            'Assert/scene/MoYuQi.sog',
            'Assert/scene/MoYuQi_environment.png',
            'Assert/scene/MoYuQi_pano.webp',
            'Assert/collision/MoYuQi.collision.glb',
            'Assert/collision/MoYuQi.voxel.bin',
            'Assert/collision/MoYuQi.voxel.json',
            'Assert/跑步机.glb',
            'THIRD_PARTY_NOTICES.txt'
        )) {
            if (-not ($relativeNames -ccontains $required)) {
                throw "Release ZIP is missing: $required"
            }
        }

        foreach ($executable in @(
            '启动游戏.command',
            'run/game-server-macos-amd64',
            'run/game-server-macos-arm64'
        )) {
            $archiveExecutable = $archivePrefix + $executable
            $entry = $fileEntries | Where-Object { $_.FullName -ceq $archiveExecutable } | Select-Object -First 1
            $unixMode = ($entry.ExternalAttributes -shr 16) -band 0xFFFF
            if (($unixMode -band 0x0FFF) -ne 0x01ED) {
                throw "Release ZIP did not preserve 0755 mode for: $executable"
            }
        }
    } finally {
        $archive.Dispose()
    }

    $size = (Get-Item -LiteralPath $outputPath).Length
    Write-Host "Verified release package: $outputPath ($size bytes)"
} catch {
    if ($outputCreated -and (Test-Path -LiteralPath $outputPath -PathType Leaf)) {
        Remove-Item -LiteralPath $outputPath -Force
    }
    throw
} finally {
    $resolvedStage = [IO.Path]::GetFullPath($stageRoot)
    if ($resolvedStage.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase) -and
        $resolvedStage -ne $tempRoot -and
        (Test-Path -LiteralPath $resolvedStage -PathType Container)) {
        Remove-Item -LiteralPath $resolvedStage -Recurse -Force
    }
}
