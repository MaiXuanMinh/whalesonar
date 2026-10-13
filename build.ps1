# Build WhaleSonar: tạo icon (Desktop + web/PWA), launcher chạy ngầm và shortcut ngoài Desktop
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Add-Type -AssemblyName System.Drawing

function P([double]$x, [double]$y, [int]$s, [double]$ox = 0, [double]$oy = 0, [double]$k = 1) {
  New-Object System.Drawing.PointF -ArgumentList ([single](($ox + $x * $k) * $s)), ([single](($oy + $y * $k) * $s))
}

# Vẽ icon: đuôi cá voi trồi khỏi mặt nước + sóng sonar phía trên
function New-IconBitmap([int]$s, [bool]$maskable = $false) {
  $bmp = New-Object System.Drawing.Bitmap $s, $s
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $p1 = New-Object System.Drawing.PointF -ArgumentList 0, 0
  $p2 = New-Object System.Drawing.PointF -ArgumentList 0, ([single]$s)
  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush -ArgumentList $p1, $p2, ([System.Drawing.Color]::FromArgb(18, 74, 140)), ([System.Drawing.Color]::FromArgb(8, 22, 48))
  if ($maskable) {
    $g.FillRectangle($bg, 0, 0, $s, $s)
    $k = 0.72; $ox = 0.14; $oy = 0.15   # thu nhỏ vào vùng an toàn
  } else {
    $r = $s * 0.22; $d = [single]($r * 2); $e = [single]($s - 1)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc(0, 0, $d, $d, 180, 90); $path.AddArc($e - $d, 0, $d, $d, 270, 90)
    $path.AddArc($e - $d, $e - $d, $d, $d, 0, 90); $path.AddArc(0, $e - $d, $d, $d, 90, 90); $path.CloseFigure()
    $g.FillPath($bg, $path)
    $k = 1.0; $ox = 0; $oy = 0
  }

  # sóng sonar (cung tròn đồng tâm)
  $alphas = 235, 165, 95
  $radii = 0.17, 0.27, 0.37
  for ($i = 0; $i -lt 3; $i++) {
    $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb($alphas[$i], 94, 214, 255)), ([single]([Math]::Max(1.2, $s * 0.038 * $k)))
    $pen.StartCap = 'Round'; $pen.EndCap = 'Round'
    $rr = $radii[$i] * $k * $s
    $cx = ($ox + 0.5 * $k) * $s; $cy = ($oy + 0.50 * $k) * $s
    $g.DrawArc($pen, [single]($cx - $rr), [single]($cy - $rr), [single]($rr * 2), [single]($rr * 2), 215, 110)
  }

  # đuôi cá voi
  $t = New-Object System.Drawing.Drawing2D.GraphicsPath
  $t.AddBezier((P 0.455 0.80 $s $ox $oy $k), (P 0.468 0.72 $s $ox $oy $k), (P 0.476 0.67 $s $ox $oy $k), (P 0.472 0.635 $s $ox $oy $k))
  $t.AddBezier((P 0.472 0.635 $s $ox $oy $k), (P 0.38 0.625 $s $ox $oy $k), (P 0.27 0.585 $s $ox $oy $k), (P 0.205 0.465 $s $ox $oy $k))
  $t.AddBezier((P 0.205 0.465 $s $ox $oy $k), (P 0.31 0.45 $s $ox $oy $k), (P 0.42 0.475 $s $ox $oy $k), (P 0.5 0.545 $s $ox $oy $k))
  $t.AddBezier((P 0.5 0.545 $s $ox $oy $k), (P 0.58 0.475 $s $ox $oy $k), (P 0.69 0.45 $s $ox $oy $k), (P 0.795 0.465 $s $ox $oy $k))
  $t.AddBezier((P 0.795 0.465 $s $ox $oy $k), (P 0.73 0.585 $s $ox $oy $k), (P 0.62 0.625 $s $ox $oy $k), (P 0.528 0.635 $s $ox $oy $k))
  $t.AddBezier((P 0.528 0.635 $s $ox $oy $k), (P 0.524 0.67 $s $ox $oy $k), (P 0.532 0.72 $s $ox $oy $k), (P 0.545 0.80 $s $ox $oy $k))
  $t.CloseFigure()
  $g.FillPath([System.Drawing.Brushes]::White, $t)

  # mặt nước
  $wpen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(200, 94, 214, 255)), ([single]([Math]::Max(1.2, $s * 0.034 * $k)))
  $wpen.StartCap = 'Round'; $wpen.EndCap = 'Round'
  $wave = New-Object System.Drawing.Drawing2D.GraphicsPath
  $wave.AddBezier((P 0.24 0.80 $s $ox $oy $k), (P 0.32 0.76 $s $ox $oy $k), (P 0.40 0.84 $s $ox $oy $k), (P 0.5 0.80 $s $ox $oy $k))
  $wave.AddBezier((P 0.5 0.80 $s $ox $oy $k), (P 0.60 0.76 $s $ox $oy $k), (P 0.68 0.84 $s $ox $oy $k), (P 0.76 0.80 $s $ox $oy $k))
  $g.DrawPath($wpen, $wave)

  $g.Dispose()
  return $bmp
}

function Get-PngBytes($bmp) {
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  return ,$ms.ToArray()
}

# ---- 1. Icon ----
$iconDir = Join-Path $root 'public\icons'
New-Item -ItemType Directory -Force $iconDir | Out-Null
foreach ($sz in 180, 192, 512) {
  $b = New-IconBitmap $sz; $b.Save((Join-Path $iconDir "icon-$sz.png"), [System.Drawing.Imaging.ImageFormat]::Png); $b.Dispose()
}
$b = New-IconBitmap 512 $true; $b.Save((Join-Path $iconDir 'maskable-512.png'), [System.Drawing.Imaging.ImageFormat]::Png); $b.Dispose()

$sizes = 16, 24, 32, 48, 64, 128, 256
$pngs = foreach ($sz in $sizes) { $b = New-IconBitmap $sz; ,(Get-PngBytes $b); $b.Dispose() }
$icoPath = Join-Path $root 'WhaleSonar.ico'
$fs = [System.IO.File]::Create($icoPath); $bw = New-Object System.IO.BinaryWriter $fs
$bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $sz = $sizes[$i]; $len = $pngs[$i].Length; $dim = $(if ($sz -ge 256) { 0 } else { $sz })
  $bw.Write([byte]$dim); $bw.Write([byte]$dim)
  $bw.Write([byte]0); $bw.Write([byte]0); $bw.Write([UInt16]1); $bw.Write([UInt16]32)
  $bw.Write([UInt32]$len); $bw.Write([UInt32]$offset); $offset += $len
}
foreach ($p in $pngs) { $bw.Write($p) }
$bw.Close()
Copy-Item $icoPath (Join-Path $root 'public\favicon.ico') -Force
Write-Host "Icon: $icoPath"

# ---- 2. Launcher chạy ngầm (không hiện cửa sổ console) ----
$node = (Get-Command node -ErrorAction Stop).Source
$vbs = @"
' WhaleSonar launcher - chạy server ngầm rồi mở cửa sổ app
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
sh.Environment("PROCESS")("WS_AUTO_EXIT") = "1"
nodeExe = "$node"
If Not fso.FileExists(nodeExe) Then nodeExe = "node"
sh.Run """" & nodeExe & """ """ & dir & "\server.js""", 0, False
WScript.Sleep 1200
On Error Resume Next
sh.Run "msedge.exe --app=http://localhost:3939 --window-size=1440,920", 1, False
If Err.Number <> 0 Then
  Err.Clear
  sh.Run "http://localhost:3939", 1, False
End If
"@
Set-Content -Path (Join-Path $root 'WhaleSonar.vbs') -Value $vbs -Encoding Unicode
Write-Host "Launcher: $(Join-Path $root 'WhaleSonar.vbs')"

# ---- 3. Shortcut ngoài Desktop ----
$desktop = [Environment]::GetFolderPath('Desktop')
foreach ($old in 'zToken.lnk') { Remove-Item (Join-Path $desktop $old) -ErrorAction SilentlyContinue }
foreach ($old in 'zToken.vbs', 'zToken.ico') { Remove-Item (Join-Path $root $old) -ErrorAction SilentlyContinue }
$lnk = Join-Path $desktop 'WhaleSonar.lnk'
$sh = New-Object -ComObject WScript.Shell
$sc = $sh.CreateShortcut($lnk)
$sc.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
$sc.Arguments = '"' + (Join-Path $root 'WhaleSonar.vbs') + '"'
$sc.WorkingDirectory = $root
$sc.IconLocation = "$icoPath,0"
$sc.Description = 'WhaleSonar - soi token on-chain'
$sc.Save()
Write-Host "Shortcut: $lnk"
