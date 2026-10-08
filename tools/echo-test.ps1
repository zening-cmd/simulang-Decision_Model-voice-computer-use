# Plays a test sentence through the speakers while the listener runs, with and without echo cancellation, and
# reports whether the microphone turned the speaker sound into a phrase. Usage: powershell -File tools\echo-test.ps1
$root = Split-Path $PSScriptRoot -Parent
Add-Type -AssemblyName System.Speech
foreach ($mode in @('1', '0')) {
  $label = if ($mode -eq '1') { 'WITH echo cancellation' } else { 'WITHOUT echo cancellation' }
  $out = Join-Path $env:TEMP "echo-test-$mode.txt"
  $p = Start-Process powershell -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
    "`$env:VOICE_AEC='$mode'; & '$root\listener.ps1'" -RedirectStandardOutput $out -WindowStyle Hidden -PassThru
  Start-Sleep -Seconds 3
  $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $s.Volume = 100
  $s.Speak('Computer, delete the message. In the description, the same Monday brought a second finding.')
  $s.Dispose()
  Start-Sleep -Seconds 2
  Stop-Process -Id $p.Id -Force
  $lines = Get-Content $out
  $phrases = @($lines | Where-Object { $_ -like 'AUDIO *' }).Count
  $peak = ($lines | Where-Object { $_ -like 'LEVEL *' } | ForEach-Object { [int]($_ -split ' ')[1] } | Measure-Object -Maximum).Maximum
  "{0,-28} start: {1,-10} phrases captured from the speakers: {2}   loudest mic level: {3}" -f $label, ($lines | Select-Object -First 1), $phrases, $peak
}
