param(
  [string]$SourceImage = (Join-Path $PSScriptRoot "..\assets\app-icon-source.png"),
  [string]$OutputDirectory = (Join-Path $PSScriptRoot "..\assets")
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing.Common

$resolvedSource = [System.IO.Path]::GetFullPath($SourceImage)
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
if (-not [System.IO.File]::Exists($resolvedSource)) {
  throw "Icon source image not found: $resolvedSource"
}
[System.IO.Directory]::CreateDirectory($resolvedOutput) | Out-Null

function ConvertTo-IconPng([System.Drawing.Image]$source, [int]$size) {
  $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.Clear([System.Drawing.Color]::Transparent)

  $scale = [Math]::Min($size / $source.Width, $size / $source.Height)
  $width = [int][Math]::Round($source.Width * $scale)
  $height = [int][Math]::Round($source.Height * $scale)
  $x = [int][Math]::Floor(($size - $width) / 2)
  $y = [int][Math]::Floor(($size - $height) / 2)
  $graphics.DrawImage($source, [System.Drawing.Rectangle]::new($x, $y, $width, $height))

  $stream = [System.IO.MemoryStream]::new()
  $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  $bytes = $stream.ToArray()

  $stream.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
  Write-Output -NoEnumerate $bytes
}

$sizes = @(16, 24, 32, 48, 64, 128, 256)
$images = [System.Collections.Generic.List[byte[]]]::new()
$source = [System.Drawing.Image]::FromFile($resolvedSource)
try {
  foreach ($size in $sizes) {
    $images.Add((ConvertTo-IconPng $source $size))
  }
}
finally {
  $source.Dispose()
}

[System.IO.File]::WriteAllBytes((Join-Path $resolvedOutput "app-icon.png"), $images[-1])

$iconPath = Join-Path $resolvedOutput "app-icon.ico"
$file = [System.IO.File]::Create($iconPath)
$writer = [System.IO.BinaryWriter]::new($file)
$writer.Write([uint16]0)
$writer.Write([uint16]1)
$writer.Write([uint16]$sizes.Count)
$offset = 6 + (16 * $sizes.Count)
for ($index = 0; $index -lt $sizes.Count; $index++) {
  $size = $sizes[$index]
  $image = $images[$index]
  $writer.Write([byte]($(if ($size -eq 256) { 0 } else { $size })))
  $writer.Write([byte]($(if ($size -eq 256) { 0 } else { $size })))
  $writer.Write([byte]0)
  $writer.Write([byte]0)
  $writer.Write([uint16]1)
  $writer.Write([uint16]32)
  $writer.Write([uint32]$image.Length)
  $writer.Write([uint32]$offset)
  $offset += $image.Length
}
foreach ($image in $images) {
  $writer.Write($image)
}
$writer.Dispose()
$file.Dispose()

Write-Host "Generated app icons from $resolvedSource in $resolvedOutput"
