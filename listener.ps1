# Microphone front end: records the default input continuously and cuts it into phrases for Whisper.
#   - keeps ~0.4 s from before speech starts, so first words are never clipped
#   - a phrase ends after ~0.7 s of quiet (or at 10 s)
#   - the speech threshold follows the room's noise level, so quiet microphones still work
# Output protocol, one line each:
#   AUDIO <wav path>   a finished phrase for Whisper
#   HEAR speech        speech has started (UI feedback)
#   LEVEL <0-100>      microphone input level
$ErrorActionPreference = 'Stop'
$clipDir = Join-Path $env:TEMP 'voice-control-clips'
New-Item -ItemType Directory -Force $clipDir | Out-Null

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

public static class PhraseCapture {
  [DllImport("winmm.dll")] static extern int waveInOpen(out IntPtr h, int dev, ref WaveFormat f, IntPtr cb, IntPtr inst, int flags);
  [DllImport("winmm.dll")] static extern int waveInPrepareHeader(IntPtr h, IntPtr hdr, int size);
  [DllImport("winmm.dll")] static extern int waveInAddBuffer(IntPtr h, IntPtr hdr, int size);
  [DllImport("winmm.dll")] static extern int waveInStart(IntPtr h);

  [StructLayout(LayoutKind.Sequential)]
  struct WaveFormat { public short tag, channels; public int rate, bytesPerSec; public short align, bits, extra; }

  const int Rate = 16000, FrameMs = 30, Frame = Rate * FrameMs / 1000;            // 480 samples per frame
  const int PreRollFrames = 400 / FrameMs, EndFrames = 700 / FrameMs, MaxFrames = 10000 / FrameMs;
  const int StartFrames = 3, MinSpeechFrames = 8;                                  // 90 ms to start, 240 ms minimum
  const int HdrSize = 48, FlagsOffset = 24, Done = 1, Prepared = 2, NBuf = 16;

  static void Out(string s) { Console.Out.WriteLine(s); Console.Out.Flush(); }

  public static void Run(string clipDir) {
    var fmt = new WaveFormat { tag = 1, channels = 1, rate = Rate, bits = 16, align = 2, bytesPerSec = Rate * 2 };
    IntPtr h;
    int err = waveInOpen(out h, -1, ref fmt, IntPtr.Zero, IntPtr.Zero, 0);           // -1 = default input device
    if (err != 0) throw new Exception("Could not open the microphone (waveInOpen error " + err + ")");
    var hdrs = new IntPtr[NBuf];
    for (int i = 0; i < NBuf; i++) {
      hdrs[i] = Marshal.AllocHGlobal(HdrSize);
      for (int b = 0; b < HdrSize; b++) Marshal.WriteByte(hdrs[i], b, 0);
      Marshal.WriteIntPtr(hdrs[i], 0, Marshal.AllocHGlobal(Frame * 2));            // lpData
      Marshal.WriteInt32(hdrs[i], 8, Frame * 2);                                     // dwBufferLength
      waveInPrepareHeader(h, hdrs[i], HdrSize);
      waveInAddBuffer(h, hdrs[i], HdrSize);
    }
    waveInStart(h);
    Out("READY");

    var pre = new Queue<short[]>();
    var phrase = new List<short[]>();
    double noise = -1; bool inSpeech = false; int loud = 0, quiet = 0, speechFrames = 0, idx = 0;
    var lastLevel = DateTime.MinValue; int lastLevelVal = -1;

    while (true) {
      IntPtr hdr = hdrs[idx];
      while ((Marshal.ReadInt32(hdr, FlagsOffset) & Done) == 0) Thread.Sleep(3);
      var frame = new short[Frame];
      Marshal.Copy(Marshal.ReadIntPtr(hdr, 0), frame, 0, Frame);
      Marshal.WriteInt32(hdr, FlagsOffset, Prepared);
      waveInAddBuffer(h, hdr, HdrSize);
      idx = (idx + 1) % NBuf;

      double sum = 0; foreach (short s in frame) sum += (double)s * s;
      double rms = Math.Sqrt(sum / Frame);
      if (noise < 0) noise = rms;
      // Noise floor: drops quickly, rises slowly, and only learns outside of speech.
      if (!inSpeech) noise = rms < noise ? noise * 0.7 + rms * 0.3 : noise * 0.995 + rms * 0.005;
      double startT = noise * 3.0 + 60, endT = noise * 1.8 + 40;

      int level = (int)Math.Min(100, Math.Max(0, 20 * Math.Log10(rms + 1) - 20) * 1.6);
      if ((DateTime.UtcNow - lastLevel).TotalMilliseconds >= 120 && level != lastLevelVal) {
        Out("LEVEL " + level); lastLevel = DateTime.UtcNow; lastLevelVal = level;
      }

      if (!inSpeech) {
        pre.Enqueue(frame); if (pre.Count > PreRollFrames) pre.Dequeue();
        loud = rms > startT ? loud + 1 : 0;
        if (loud >= StartFrames) {
          inSpeech = true; quiet = 0; speechFrames = loud;
          phrase.Clear(); phrase.AddRange(pre); pre.Clear();
          Out("HEAR speech");
        }
      } else {
        phrase.Add(frame);
        if (rms > endT) { speechFrames++; quiet = 0; } else quiet++;
        if (quiet >= EndFrames || phrase.Count >= MaxFrames) {
          inSpeech = false; loud = 0;
          if (speechFrames >= MinSpeechFrames) Out("AUDIO " + Save(clipDir, phrase));
          phrase.Clear();
        }
      }
    }
  }

  static string Save(string dir, List<short[]> frames) {
    string path = Path.Combine(dir, Guid.NewGuid().ToString("N") + ".wav");
    int bytes = frames.Count * Frame * 2;
    using (var w = new BinaryWriter(File.Create(path))) {
      w.Write(new[] { 'R', 'I', 'F', 'F' }); w.Write(36 + bytes); w.Write(new[] { 'W', 'A', 'V', 'E' });
      w.Write(new[] { 'f', 'm', 't', ' ' }); w.Write(16); w.Write((short)1); w.Write((short)1);
      w.Write(Rate); w.Write(Rate * 2); w.Write((short)2); w.Write((short)16);
      w.Write(new[] { 'd', 'a', 't', 'a' }); w.Write(bytes);
      foreach (var f in frames) foreach (short s in f) w.Write(s);
    }
    return path;
  }
}
'@

[PhraseCapture]::Run($clipDir)
