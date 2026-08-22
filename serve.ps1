param(
    [int] $Port = 8137,
    [switch] $NoOpen
)

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$rootPrefix = $projectRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$utf8 = [Text.UTF8Encoding]::new($false)
$ascii = [Text.Encoding]::ASCII

$mimeTypes = @{
    '.html' = 'text/html; charset=utf-8'
    '.js' = 'text/javascript; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.css' = 'text/css; charset=utf-8'
    '.wasm' = 'application/wasm'
    '.bin' = 'application/octet-stream'
    '.ply' = 'application/octet-stream'
    '.sog' = 'application/octet-stream'
    '.glb' = 'model/gltf-binary'
    '.png' = 'image/png'
    '.jpg' = 'image/jpeg'
    '.jpeg' = 'image/jpeg'
    '.webp' = 'image/webp'
    '.webm' = 'video/webm'
}

function Send-Headers($stream, [int] $statusCode, [string] $reason, $headers) {
    $builder = [Text.StringBuilder]::new()
    [void]$builder.Append("HTTP/1.1 $statusCode $reason`r`n")
    foreach ($key in $headers.Keys) {
        [void]$builder.Append("$key`: $($headers[$key])`r`n")
    }
    [void]$builder.Append("Connection: close`r`n`r`n")
    $bytes = $ascii.GetBytes($builder.ToString())
    $stream.Write($bytes, 0, $bytes.Length)
}

function Send-BodyResponse($stream, [string] $method, [int] $statusCode, [string] $reason, [string] $contentType, [byte[]] $bytes) {
    Send-Headers $stream $statusCode $reason @{
        'Content-Type' = $contentType
        'Content-Length' = $bytes.Length
        'Cache-Control' = 'no-store'
    }
    if ($method -ne 'HEAD') { $stream.Write($bytes, 0, $bytes.Length) }
}

function Send-JsonResponse($stream, [string] $method, [int] $statusCode, [string] $reason, $value) {
    $bytes = $utf8.GetBytes(($value | ConvertTo-Json -Compress -Depth 6))
    Send-BodyResponse $stream $method $statusCode $reason 'application/json; charset=utf-8' $bytes
}

function Send-TextResponse($stream, [string] $method, [int] $statusCode, [string] $reason, [string] $message) {
    $bytes = $utf8.GetBytes($message)
    Send-BodyResponse $stream $method $statusCode $reason 'text/plain; charset=utf-8' $bytes
}

function Get-CachedProps {
    $propsDir = Join-Path $projectRoot 'Assert\props'
    if (-not (Test-Path -LiteralPath $propsDir -PathType Container)) { return @() }

    return @(
        Get-ChildItem -LiteralPath $propsDir -File -Filter '*.glb' | Sort-Object Name | ForEach-Object {
            $stem = $_.BaseName
            $splitAt = $stem.LastIndexOf('_')
            $displayName = if ($splitAt -gt 0) { $stem.Substring(0, $splitAt) } else { $stem }
            $preview = Join-Path $propsDir ($stem + '_preview.png')
            $entry = [ordered]@{
                file = 'Assert/props/' + $_.Name
                name = $displayName
                size = $_.Length
            }
            if (Test-Path -LiteralPath $preview -PathType Leaf) {
                $entry.preview = 'Assert/props/' + [IO.Path]::GetFileName($preview)
            }
            [pscustomobject]$entry
        }
    )
}

function Read-HttpRequest($stream) {
    $data = [Collections.Generic.List[byte]]::new()
    $one = New-Object byte[] 1
    $terminator = [byte[]](13, 10, 13, 10)
    $matched = 0
    while ($data.Count -lt 65536) {
        $read = $stream.Read($one, 0, 1)
        if ($read -le 0) { return $null }
        $value = $one[0]
        $data.Add($value)
        if ($value -eq $terminator[$matched]) {
            $matched++
            if ($matched -eq $terminator.Length) { break }
        } else {
            $matched = if ($value -eq 13) { 1 } else { 0 }
        }
    }
    if ($matched -ne $terminator.Length) { throw 'HTTP request headers are too large.' }

    $lines = $ascii.GetString($data.ToArray()) -split "`r`n"
    $requestLine = $lines[0] -split ' '
    if ($requestLine.Length -lt 2) { throw 'Malformed HTTP request.' }
    $headers = @{}
    for ($index = 1; $index -lt $lines.Length; $index++) {
        $colon = $lines[$index].IndexOf(':')
        if ($colon -le 0) { continue }
        $headers[$lines[$index].Substring(0, $colon).Trim().ToLowerInvariant()] = $lines[$index].Substring($colon + 1).Trim()
    }
    return [pscustomobject]@{
        Method = $requestLine[0].ToUpperInvariant()
        Target = $requestLine[1]
        Headers = $headers
    }
}

function Send-StaticFile($stream, $request, [string] $filePath) {
    $file = [IO.FileInfo]::new($filePath)
    $length = $file.Length
    $start = [int64]0
    $end = [int64]($length - 1)
    $partial = $false
    $range = $request.Headers['range']

    if ($range -and $range -match '^bytes=(\d*)-(\d*)$') {
        $first = $Matches[1]
        $last = $Matches[2]
        if ($first -eq '' -and $last -ne '') {
            $suffixLength = [Math]::Min([int64]$last, $length)
            $start = $length - $suffixLength
        } elseif ($first -ne '') {
            $start = [int64]$first
            if ($last -ne '') { $end = [Math]::Min([int64]$last, $end) }
        }
        if ($start -lt 0 -or $start -ge $length -or $end -lt $start) {
            Send-Headers $stream 416 'Range Not Satisfiable' @{
                'Content-Length' = 0
                'Content-Range' = "bytes */$length"
            }
            return
        }
        $partial = $true
    }

    $count = $end - $start + 1
    $extension = $file.Extension.ToLowerInvariant()
    $contentType = if ($mimeTypes.ContainsKey($extension)) { $mimeTypes[$extension] } else { 'application/octet-stream' }
    $headers = [ordered]@{
        'Content-Type' = $contentType
        'Content-Length' = $count
        'Accept-Ranges' = 'bytes'
        'Cache-Control' = 'no-cache'
    }
    if ($partial) { $headers['Content-Range'] = "bytes $start-$end/$length" }
    Send-Headers $stream $(if ($partial) { 206 } else { 200 }) $(if ($partial) { 'Partial Content' } else { 'OK' }) $headers
    if ($request.Method -eq 'HEAD') { return }

    $fileStream = [IO.File]::Open($file.FullName, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    try {
        [void]$fileStream.Seek($start, [IO.SeekOrigin]::Begin)
        $buffer = New-Object byte[] (1024 * 1024)
        $remaining = $count
        while ($remaining -gt 0) {
            $wanted = [int][Math]::Min([int64]$buffer.Length, $remaining)
            $read = $fileStream.Read($buffer, 0, $wanted)
            if ($read -le 0) { break }
            $stream.Write($buffer, 0, $read)
            $remaining -= $read
        }
    } finally {
        $fileStream.Dispose()
    }
}

$listener = $null
$activePort = $null
foreach ($candidatePort in $Port..($Port + 20)) {
    $candidate = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $candidatePort)
    try {
        $candidate.Start()
        $listener = $candidate
        $activePort = $candidatePort
        break
    } catch {
        $candidate.Stop()
    }
}
if (-not $listener) { throw "No available localhost port in range $Port-$($Port + 20)." }

$gameUrl = "http://127.0.0.1:$activePort/run/main_pro.html"
Write-Host "Endless Dream game server: $gameUrl"
Write-Host 'Close this window or press Ctrl+C to stop.'
if (-not $NoOpen) { Start-Process $gameUrl }

try {
    while ($true) {
        $client = $listener.AcceptTcpClient()
        try {
            $client.NoDelay = $true
            $stream = $client.GetStream()
            $request = Read-HttpRequest $stream
            if (-not $request) { continue }
            $method = $request.Method
            $targetUri = [Uri]::new('http://127.0.0.1' + $request.Target)
            $urlPath = [Uri]::UnescapeDataString($targetUri.AbsolutePath)
            if ($urlPath -eq '/' -or $urlPath -eq '/main_pro.html') { $urlPath = '/run/main_pro.html' }

            if ($urlPath -eq '/api/prop/list' -and $method -eq 'GET') {
                Send-JsonResponse $stream $method 200 'OK' @{ props = @(Get-CachedProps) }
            } elseif ($urlPath -eq '/api/prop/generate') {
                Send-JsonResponse $stream $method 503 'Service Unavailable' @{ error = 'This portable build supports cached props only.' }
            } elseif ($method -ne 'GET' -and $method -ne 'HEAD') {
                Send-TextResponse $stream $method 405 'Method Not Allowed' 'Method not allowed'
            } else {
                $relative = $urlPath.TrimStart('/').Replace('/', [IO.Path]::DirectorySeparatorChar)
                $fullPath = [IO.Path]::GetFullPath((Join-Path $projectRoot $relative))
                if (-not $fullPath.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
                    Send-TextResponse $stream $method 403 'Forbidden' 'Forbidden'
                } elseif (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
                    Send-TextResponse $stream $method 404 'Not Found' 'Not found'
                } else {
                    Send-StaticFile $stream $request $fullPath
                }
            }
        } catch {
            try { Send-TextResponse $stream 'GET' 500 'Internal Server Error' 'Server error' } catch { }
        } finally {
            if ($stream) { $stream.Dispose() }
            $client.Dispose()
        }
    }
} finally {
    $listener.Stop()
}
