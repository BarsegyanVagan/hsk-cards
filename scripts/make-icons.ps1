# Generates PNG icons into icons/ (Windows, uses built-in System.Drawing).
# Run: powershell -ExecutionPolicy Bypass -File scripts\make-icons.ps1
#   icon-192.png, icon-512.png  - rounded square (manifest, purpose "any")
#   icon-maskable-512.png       - full-bleed, glyph inside the safe zone (Android)
#   apple-touch-icon.png        - 180x180 full-bleed (iOS rounds the corners itself)

Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'

$root  = Split-Path -Parent $PSScriptRoot
$out   = Join-Path $root 'icons'
New-Item -ItemType Directory -Force $out | Out-Null

$glyph = [string][char]0x5B66   # the character "xue" (to study)
$fontName = 'Microsoft YaHei'
if (-not ((New-Object System.Drawing.Text.InstalledFontCollection).Families.Name -contains $fontName)) { $fontName = 'SimHei' }

function New-RoundedRect([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

function New-Icon([int]$size, [string]$file, [bool]$rounded, [float]$glyphScale) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode     = 'AntiAlias'
  $g.InterpolationMode = 'HighQualityBicubic'
  $g.PixelOffsetMode   = 'HighQuality'
  $g.Clear([System.Drawing.Color]::Transparent)

  $rect = New-Object System.Drawing.RectangleF 0, 0, $size, $size
  $c1 = [System.Drawing.Color]::FromArgb(255, 99, 102, 241)   # indigo
  $c2 = [System.Drawing.Color]::FromArgb(255, 168, 85, 247)   # violet
  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, $c1, $c2, 45.0

  if ($rounded) {
    $shape = New-RoundedRect 0 0 ($size - 1) ($size - 1) ($size * 0.22)
    $g.FillPath($bg, $shape)
  } else {
    $g.FillRectangle($bg, $rect)
  }

  # soft highlight in the upper part
  $hl = New-Object System.Drawing.Drawing2D.GraphicsPath
  $hl.AddEllipse(-$size * 0.3, -$size * 0.75, $size * 1.6, $size * 1.15)
  $hlBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(28, 255, 255, 255))
  if ($rounded) { $g.SetClip($shape) }
  $g.FillPath($hlBrush, $hl)
  $g.ResetClip()

  # glyph, centered by its real outline bounds
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $family = New-Object System.Drawing.FontFamily $fontName
  $path.AddString($glyph, $family, [int][System.Drawing.FontStyle]::Bold, [float]($size * $glyphScale), (New-Object System.Drawing.PointF 0, 0), [System.Drawing.StringFormat]::GenericTypographic)
  $b = $path.GetBounds()
  $m = New-Object System.Drawing.Drawing2D.Matrix
  $m.Translate(($size - $b.Width) / 2 - $b.X, ($size - $b.Height) / 2 - $b.Y)
  $path.Transform($m)

  $shadow = $path.Clone()
  $sm = New-Object System.Drawing.Drawing2D.Matrix
  $sm.Translate(0, $size * 0.012)
  $shadow.Transform($sm)
  $g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(45, 30, 20, 90))), $shadow)
  $g.FillPath([System.Drawing.Brushes]::White, $path)

  $g.Dispose()
  $bmp.Save((Join-Path $out $file), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "icons/$file"
}

New-Icon 192 'icon-192.png'          $true  0.62
New-Icon 512 'icon-512.png'          $true  0.62
New-Icon 512 'icon-maskable-512.png' $false 0.50
New-Icon 180 'apple-touch-icon.png'  $false 0.58
New-Icon 64  'favicon-64.png'        $true  0.66
