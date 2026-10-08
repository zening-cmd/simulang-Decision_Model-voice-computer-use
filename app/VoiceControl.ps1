# Voice Control desktop app: tray icon + floating status badge around the Simulang voice engine (voice.ts).
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\SimulangVoiceControl', [ref]$created)
if (-not $created) { exit } # already running

$root = Split-Path $PSScriptRoot -Parent
$startupLink = Join-Path ([Environment]::GetFolderPath('Startup')) 'Voice Control.lnk'
$desktopLink = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Voice Control.lnk'

# ---------- floating badge ----------
# The badge must never take keyboard focus: key commands ("new tab", "go back") go to the focused window.
Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @'
public class BadgeForm : System.Windows.Forms.Form {
  protected override bool ShowWithoutActivation { get { return true; } }
  protected override System.Windows.Forms.CreateParams CreateParams {
    get { var p = base.CreateParams; p.ExStyle |= 0x08000000 | 0x00000080 | 0x00000008; return p; } // NOACTIVATE | TOOLWINDOW | TOPMOST
  }
}
'@
$badge = New-Object BadgeForm
$badge.Text = 'Voice Control badge'
$badge.FormBorderStyle = 'None'; $badge.ShowInTaskbar = $false; $badge.TopMost = $true
$badge.StartPosition = 'Manual'; $badge.Size = New-Object System.Drawing.Size(360, 64)
$badge.BackColor = [System.Drawing.Color]::FromArgb(24, 26, 32); $badge.Opacity = 0.93
$wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$badge.Location = New-Object System.Drawing.Point(($wa.Right - 380), ($wa.Bottom - 84))
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$r = 22; $w = $badge.Width; $h = $badge.Height
$path.AddArc(0, 0, $r, $r, 180, 90); $path.AddArc($w - $r, 0, $r, $r, 270, 90)
$path.AddArc($w - $r, $h - $r, $r, $r, 0, 90); $path.AddArc(0, $h - $r, $r, $r, 90, 90); $path.CloseFigure()
$badge.Region = New-Object System.Drawing.Region($path)

$dot = New-Object System.Windows.Forms.Label
$dot.Size = New-Object System.Drawing.Size(14, 14); $dot.Location = New-Object System.Drawing.Point(16, 25)
$dotPath = New-Object System.Drawing.Drawing2D.GraphicsPath; $dotPath.AddEllipse(0, 0, 14, 14)
$dot.Region = New-Object System.Drawing.Region($dotPath)
$status = New-Object System.Windows.Forms.Label
$status.ForeColor = [System.Drawing.Color]::White; $status.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 10)
$status.Location = New-Object System.Drawing.Point(40, 10); $status.Size = New-Object System.Drawing.Size(310, 22)
$detail = New-Object System.Windows.Forms.Label
$detail.ForeColor = [System.Drawing.Color]::FromArgb(170, 178, 190); $detail.Font = New-Object System.Drawing.Font('Segoe UI', 9)
$detail.Location = New-Object System.Drawing.Point(40, 33); $detail.Size = New-Object System.Drawing.Size(310, 20)
# live microphone level bar along the bottom edge
$levelTrack = New-Object System.Windows.Forms.Panel
$levelTrack.BackColor = [System.Drawing.Color]::FromArgb(45, 48, 56)
$levelTrack.Location = New-Object System.Drawing.Point(40, 56); $levelTrack.Size = New-Object System.Drawing.Size(300, 4)
$levelBar = New-Object System.Windows.Forms.Panel
$levelBar.BackColor = [System.Drawing.Color]::LimeGreen; $levelBar.Size = New-Object System.Drawing.Size(0, 4)
$levelTrack.Controls.Add($levelBar)
$badge.Size = New-Object System.Drawing.Size(360, 68)
$badge.Controls.AddRange(@($dot, $status, $detail, $levelTrack))

# Yes / No buttons for approvals, in case a spoken answer isn't heard.
function New-AnswerButton($text, $x, $color) {
  $b = New-Object System.Windows.Forms.Button
  $b.Text = $text; $b.Size = New-Object System.Drawing.Size(52, 24); $b.Location = New-Object System.Drawing.Point($x, 8)
  $b.FlatStyle = 'Flat'; $b.FlatAppearance.BorderSize = 0; $b.ForeColor = [System.Drawing.Color]::White
  $b.BackColor = [System.Drawing.Color]::FromName($color); $b.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 9)
  $b.Visible = $false; $b.TabStop = $false
  $badge.Controls.Add($b); $b.BringToFront(); $b
}
$btnYes = New-AnswerButton 'Yes' 240 'SeaGreen'
$btnNo = New-AnswerButton 'No' 298 'Firebrick'
function Show-Answer($show) { $btnYes.Visible = $show; $btnNo.Visible = $show; $status.Width = $(if ($show) { 195 } else { 310 }) }
function Send-Answer($a) {
  Show-Answer $false
  if ($script:proc -and -not $script:proc.HasExited) { $script:proc.StandardInput.WriteLine("ANSWER $a"); $script:proc.StandardInput.Flush() }
}
$btnYes.Add_Click({ Send-Answer 'yes' })
$btnNo.Add_Click({ Send-Answer 'no' })

# drag the badge anywhere
$script:drag = $null
foreach ($c in @($badge, $status, $detail, $dot)) {
  $c.Add_MouseDown({ $script:drag = [System.Windows.Forms.Cursor]::Position - [System.Drawing.Size]$badge.Location })
  $c.Add_MouseMove({ if ($script:drag -and [System.Windows.Forms.Control]::MouseButtons -eq 'Left') { $badge.Location = [System.Windows.Forms.Cursor]::Position - [System.Drawing.Size]$script:drag } })
  $c.Add_MouseUp({ $script:drag = $null })
}

function Set-Status($text, $sub, $color) {
  $status.Text = $text; $detail.Text = $sub
  $dot.BackColor = [System.Drawing.Color]::FromName($color)
}

# ---------- tray ----------
$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = New-Object System.Drawing.Icon (Join-Path $PSScriptRoot 'mic.ico')
$tray.Text = 'Voice Control'; $tray.Visible = $true
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$miPause = $menu.Items.Add('Pause listening')
$miBadge = $menu.Items.Add('Hide status badge')
$menu.Items.Add('Edit commands...').Add_Click({ Start-Process notepad (Join-Path $root 'commands.json') }) | Out-Null
$miStartup = New-Object System.Windows.Forms.ToolStripMenuItem 'Start with Windows'
$miStartup.Checked = Test-Path $startupLink
$menu.Items.Add($miStartup) | Out-Null
$menu.Items.Add('-') | Out-Null
$miQuit = $menu.Items.Add('Quit')
$tray.ContextMenuStrip = $menu

# ---------- engine process ----------
$script:proc = $null
# Engine output (minus level ticks) is kept in engine.log for troubleshooting; reset each launch.
$logFile = Join-Path $PSScriptRoot 'engine.log'
Set-Content -Path $logFile -Value ("{0:yyyy-MM-dd HH:mm:ss} app started" -f (Get-Date))
$script:queue =[System.Collections.Concurrent.ConcurrentQueue[string]]::new()
function Start-Engine {
  $psi = New-Object System.Diagnostics.ProcessStartInfo 'cmd.exe', '/c simulang run voice.ts 2>&1'
  $psi.WorkingDirectory = $root; $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true; $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
  $psi.RedirectStandardInput = $true # Yes/No button answers go to the engine
  $psi.EnvironmentVariables['RUST_LOG'] = 'warn'
  $key = [Environment]::GetEnvironmentVariable('OPENROUTER_API_KEY', 'User')
  if ($key) { $psi.EnvironmentVariables['OPENROUTER_API_KEY'] = $key }
  $p = New-Object System.Diagnostics.Process; $p.StartInfo = $psi; $p.EnableRaisingEvents = $true
  $p.Start() | Out-Null
  # Read output on a background runspace; the UI timer drains the queue.
  $rs = [runspacefactory]::CreateRunspace(); $rs.Open()
  $rs.SessionStateProxy.SetVariable('p', $p); $rs.SessionStateProxy.SetVariable('q', $script:queue)
  $reader = [powershell]::Create(); $reader.Runspace = $rs
  $reader.AddScript({ while ($null -ne ($l = $p.StandardOutput.ReadLine())) { $q.Enqueue($l) } }) | Out-Null
  $reader.BeginInvoke() | Out-Null
  $script:proc = $p
  Set-Status 'Starting...' 'Loading apps and the speech recognizer' 'Orange'
}
function Stop-Engine {
  if ($script:proc -and -not $script:proc.HasExited) { & taskkill /PID $script:proc.Id /T /F 2>$null | Out-Null }
  $script:proc = $null
}

# Pump engine output into the UI on the UI thread.
$timer = New-Object System.Windows.Forms.Timer; $timer.Interval = 60
$timer.Add_Tick({
  $line = $null
  while ($script:queue.TryDequeue([ref]$line)) {
    $l = $line.Trim([char]0xFEFF).TrimEnd()
    if ($l -notmatch '^LEVEL ') { try { Add-Content -Path $logFile -Value ("{0:HH:mm:ss.fff} {1}" -f (Get-Date), $l) } catch {} }
    if ($l -match '^LEVEL (\d+)$') { $levelBar.Width = [int](3 * [Math]::Min(100, [int]$Matches[1] * 2)) }
    # Windows' live word guesses are too rough to show; just signal that speech is coming in.
    elseif ($l -match '^HEAR ') { if ($detail.Text -ne 'hearing you...' -and -not $btnYes.Visible) { Set-Status 'Listening...' 'hearing you...' 'Gold' } }
    elseif ($l -eq 'THINK') { $detail.Text = 'transcribing...'; $dot.BackColor = [System.Drawing.Color]::Gold }
    elseif ($l -match '^HEARD (.*)$') { $status.Text = '"' + $Matches[1] + '"' }
    elseif ($l -match '^MISS (.+)$') { Set-Status ('"' + $Matches[1] + '"') 'heard it, but not a command' 'Gray' }
    elseif ($l -like 'Listening.*') { Set-Status 'Listening' 'Say "open google", "search for ...", "computer ..."' 'LimeGreen' }
    elseif ($l -match '^> (.+?)\s+\[(\d+) ms\]$') { Set-Status ('"' + $Matches[1] + '"') ("done in $($Matches[2]) ms") 'DeepSkyBlue' }
    elseif ($l -match '^> (.+?)\s+failed: (.+)$') { Set-Status ('"' + $Matches[1] + '"') ("failed: " + $Matches[2]) 'OrangeRed' }
    elseif ($l -match '^\s+\(no command for "(.+)"\)') { Set-Status ('"' + $Matches[1] + '"') 'not a command' 'Gray' }
    elseif ($l -match '^ASK (.+)$') { Set-Status ($Matches[1].Substring(0, [Math]::Min(48, $Matches[1].Length)) + '?') 'Say "yes" or "no" - or click' 'Orange'; Show-Answer $true }
    elseif ($l -match '^ANSWER (.+)$') {
      # Short version on the badge; the full answer (e.g. a list of names) as a Windows notification.
      $ans = $Matches[1]
      Set-Status ($ans.Substring(0, [Math]::Min(48, $ans.Length)) + $(if ($ans.Length -gt 48) { '...' } else { '' })) 'answer - full text in the notification' 'DeepSkyBlue'
      $tray.BalloonTipTitle = 'Voice Control'; $tray.BalloonTipText = $ans.Substring(0, [Math]::Min(250, $ans.Length)); $tray.ShowBalloonTip(15000)
    }
    elseif ($l -match '^ASKTEXT (.+)$') { Set-Status $Matches[1] 'Say the text now (or "cancel")' 'Orange' }
    elseif ($l -match '^\s+(approved|declined|task stopped|stopped.*|done.*|task failed.*)$') { Show-Answer $false; $detail.Text = $Matches[1].Substring(0, [Math]::Min(60, $Matches[1].Length)) }
    elseif ($l -match '^\s+(task started|plan: .*|step \d+: .*|working in: .*|done.*|stopped.*|task failed.*|approved|declined|confirmed|\(waiting for yes or no\)|task stopped)$') { $detail.Text = $Matches[1].Substring(0, [Math]::Min(60, $Matches[1].Length)) }
    elseif ($l -like 'stopped: you said*') { $script:userStopped = $true }
    elseif ($l -match '^\s+\(microphone capture stopped') { $detail.Text = 'microphone hiccup - restarting it' }
  }
  if ($script:proc -and $script:proc.HasExited -and $miPause.Text -eq 'Pause listening') {
    $script:proc = $null
    if ($script:userStopped) {
      # Only when the user actually said "stop listening".
      $script:userStopped = $false
      Set-Status 'Stopped' 'You said "stop listening" - click tray > Resume' 'Gray'; $miPause.Text = 'Resume listening'
    } else {
      # Anything else (a crash, an audio device error) restarts voice control automatically.
      Add-Content -Path $logFile -Value ("{0:HH:mm:ss.fff} (engine stopped unexpectedly - restarting)" -f (Get-Date))
      Start-Engine
    }
  }
})

$miPause.Add_Click({
  if ($miPause.Text -eq 'Pause listening') { Stop-Engine; $miPause.Text = 'Resume listening'; Set-Status 'Paused' 'Tray icon > Resume listening' 'Gray' }
  else { Start-Engine; $miPause.Text = 'Pause listening' }
})
$miBadge.Add_Click({
  if ($badge.Visible) { $badge.Hide(); $miBadge.Text = 'Show status badge' } else { $badge.Show(); $miBadge.Text = 'Hide status badge' }
})
$miStartup.Add_Click({
  if (Test-Path $startupLink) { Remove-Item $startupLink } else { Copy-Item $desktopLink $startupLink }
  $miStartup.Checked = Test-Path $startupLink
})
$miQuit.Add_Click({ Stop-Engine; $tray.Visible = $false; [System.Windows.Forms.Application]::Exit() })
$tray.Add_DoubleClick({ $miBadge.PerformClick() })

# Reload the engine automatically when its code or commands change, so updates never need a manual restart.
$watcher = New-Object System.IO.FileSystemWatcher $root
$watcher.IncludeSubdirectories = $false; $watcher.NotifyFilter = 'LastWrite, FileName'
$watcher.SynchronizingObject = $badge # raise events on the UI thread (PowerShell handlers can't run on pool threads)
$watcher.EnableRaisingEvents = $true
$script:reloadAt = $null
$onChange = { param($s, $e) if ($e.Name -match '\.(ts|ps1|json)$') { $script:reloadAt = (Get-Date).AddSeconds(1.5) } }
$watcher.add_Changed($onChange); $watcher.add_Created($onChange); $watcher.add_Renamed($onChange)
$reloadTimer = New-Object System.Windows.Forms.Timer; $reloadTimer.Interval = 500
$reloadTimer.Add_Tick({
  if ($script:reloadAt -and (Get-Date) -ge $script:reloadAt -and $miPause.Text -eq 'Pause listening') {
    $script:reloadAt = $null
    Add-Content -Path $logFile -Value ("{0:HH:mm:ss.fff} (code changed - reloading engine)" -f (Get-Date))
    Stop-Engine; Start-Engine
  }
})

Start-Engine
$timer.Start()
$reloadTimer.Start()
$badge.Show()
[System.Windows.Forms.Application]::Run()
Stop-Engine; $tray.Dispose(); $mutex.ReleaseMutex()
