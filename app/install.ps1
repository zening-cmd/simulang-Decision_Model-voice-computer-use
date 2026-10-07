# Draws the microphone icon and puts a "Voice Control" shortcut on the Desktop.
Add-Type -AssemblyName System.Drawing
$here = $PSScriptRoot
$ico = Join-Path $here 'mic.ico'

$bmp = New-Object System.Drawing.Bitmap 64, 64
$g = [System.Drawing.Graphics]::FromImage($bmp); $g.SmoothingMode = 'AntiAlias'; $g.Clear([System.Drawing.Color]::Transparent)
$g.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(110, 220, 60))), 0, 0, 63, 63)
$white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(24, 26, 32))
$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(24, 26, 32)), 4
$g.FillRectangle($white, 25, 12, 14, 22); $g.FillEllipse($white, 25, 6, 14, 14); $g.FillEllipse($white, 25, 27, 14, 14)
$g.DrawArc($pen, 17, 18, 30, 26, 0, 180); $g.DrawLine($pen, 32, 44, 32, 52); $g.DrawLine($pen, 24, 53, 40, 53)
$g.Dispose()
$icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
$fs = [System.IO.File]::Create($ico); $icon.Save($fs); $fs.Close()

$desktop = [Environment]::GetFolderPath('Desktop')
$sh = New-Object -ComObject WScript.Shell
$lnk = $sh.CreateShortcut((Join-Path $desktop 'Voice Control.lnk'))
$lnk.TargetPath = "$env:WINDIR\System32\wscript.exe"
$lnk.Arguments = '"' + (Join-Path $here 'launch.vbs') + '"'
$lnk.WorkingDirectory = $here
$lnk.IconLocation = $ico
$lnk.Description = 'Voice control for this PC (Simulang + Jev)'
$lnk.Save()
"Shortcut created: $(Join-Path $desktop 'Voice Control.lnk')"
