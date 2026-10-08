# Microphone front end: records the default input continuously and cuts it into phrases for speech-to-text.
#   - echo cancellation: Windows' Voice Capture DSP (the one call apps use) subtracts what the speakers are playing
#     from the microphone, so a video or music is never transcribed as the user
#   - keeps ~0.4 s from before speech starts, so first words are never clipped
#   - a phrase ends after ~0.7 s of quiet (or at 10 s)
#   - the speech threshold follows the room's noise level, so quiet microphones still work
# Output protocol, one line each:
#   READY AEC | READY  capture started (with / without echo cancellation)
#   AUDIO <wav path> [SPEAKERS]   a finished phrase; SPEAKERS = recorded while sound was playing and
#                                 echo cancellation is unavailable (the microphone may be hearing the speakers)
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

// ---------- speaker level (Core Audio meter on the default output device) ----------
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCo {}
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int EnumAudioEndpoints(int flow, int mask, out IntPtr c); int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice d); }
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); }
[Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioMeterInformation { int GetPeakValue(out float v); }
public static class SpeakerMeter {
  static IAudioMeterInformation meter;
  public static float Peak() {
    try {
      if (meter == null) {
        var e = (IMMDeviceEnumerator)new MMDeviceEnumeratorCo(); IMMDevice d; e.GetDefaultAudioEndpoint(0, 0, out d);
        var g = typeof(IAudioMeterInformation).GUID; object o; d.Activate(ref g, 23, IntPtr.Zero, out o); meter = (IAudioMeterInformation)o;
      }
      float v; meter.GetPeakValue(out v); return v;
    } catch { meter = null; return 0; }
  }
}

// ---------- echo-cancelled capture: Voice Capture DSP (CLSID_CWMAudioAEC) in source mode ----------
[ComImport, Guid("745057c7-f353-4f2d-a7ee-58434477730e")] class CWMAudioAEC {}
[ComImport, Guid("d8ad0f58-5494-4102-97c5-ec798e59bcf4"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMediaObject {
  [PreserveSig] int GetStreamCount(out int i, out int o);
  [PreserveSig] int GetInputStreamInfo(int i, out int flags);
  [PreserveSig] int GetOutputStreamInfo(int i, out int flags);
  [PreserveSig] int GetInputType(int i, int t, IntPtr mt);
  [PreserveSig] int GetOutputType(int i, int t, IntPtr mt);
  [PreserveSig] int SetInputType(int i, IntPtr mt, int flags);
  [PreserveSig] int SetOutputType(int i, ref DmoMediaType mt, int flags);
  [PreserveSig] int GetInputCurrentType(int i, IntPtr mt);
  [PreserveSig] int GetOutputCurrentType(int i, IntPtr mt);
  [PreserveSig] int GetInputSizeInfo(int i, out int size, out int lookahead, out int align);
  [PreserveSig] int GetOutputSizeInfo(int i, out int size, out int align);
  [PreserveSig] int GetInputMaxLatency(int i, out long lat);
  [PreserveSig] int SetInputMaxLatency(int i, long lat);
  [PreserveSig] int Flush();
  [PreserveSig] int Discontinuity(int i);
  [PreserveSig] int AllocateStreamingResources();
  [PreserveSig] int FreeStreamingResources();
  [PreserveSig] int GetInputStatus(int i, out int flags);
  [PreserveSig] int ProcessInput(int i, IntPtr buf, int flags, long time, long len);
  [PreserveSig] int ProcessOutput(int flags, int count, IntPtr bufs, out int status);
  [PreserveSig] int Lock(int l);
}
[ComImport, Guid("59eff8b9-938c-4a26-82f2-95cb84cdc837"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMediaBuffer {
  [PreserveSig] int SetLength(int len);
  [PreserveSig] int GetMaxLength(out int len);
  [PreserveSig] int GetBufferAndLength(IntPtr ppBuffer, IntPtr pcbLength);
}
[ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPropertyStore {
  [PreserveSig] int GetCount(out int c);
  [PreserveSig] int GetAt(int i, out PropertyKey k);
  [PreserveSig] int GetValue(ref PropertyKey k, out PropVariant v);
  [PreserveSig] int SetValue(ref PropertyKey k, ref PropVariant v);
  [PreserveSig] int Commit();
}
[StructLayout(LayoutKind.Sequential)] public struct PropertyKey { public Guid fmtid; public int pid; }
[StructLayout(LayoutKind.Explicit, Size = 24)] public struct PropVariant { [FieldOffset(0)] public short vt; [FieldOffset(8)] public int intVal; }
[StructLayout(LayoutKind.Sequential)] public struct DmoMediaType {
  public Guid majortype, subtype; public int bFixedSizeSamples, bTemporalCompression, lSampleSize;
  public Guid formattype; public IntPtr pUnk; public int cbFormat; public IntPtr pbFormat;
}
[StructLayout(LayoutKind.Sequential)] public struct DmoOutputDataBuffer {
  [MarshalAs(UnmanagedType.Interface)] public IMediaBuffer pBuffer; public int dwStatus; public long rtTimestamp, rtTimelength;
}
public class MediaBuffer : IMediaBuffer {
  public readonly IntPtr Data; readonly int max; public int Length;
  public MediaBuffer(int size) { max = size; Data = Marshal.AllocHGlobal(size); }
  public int SetLength(int len) { if (len > max) return unchecked((int)0x80070057); Length = len; return 0; }
  public int GetMaxLength(out int len) { len = max; return 0; }
  public int GetBufferAndLength(IntPtr ppBuffer, IntPtr pcbLength) {
    if (ppBuffer != IntPtr.Zero) Marshal.WriteIntPtr(ppBuffer, Data);
    if (pcbLength != IntPtr.Zero) Marshal.WriteInt32(pcbLength, Length);
    return 0;
  }
}

public interface IFrameSource { short[] Next(); }

public class AecSource : IFrameSource {
  readonly IMediaObject dmo; readonly MediaBuffer buf = new MediaBuffer(16000 * 2); // 1 s of room
  readonly Queue<short> pending = new Queue<short>(); readonly int frame;
  public AecSource(int frameSamples) {
    frame = frameSamples;
    dmo = (IMediaObject)new CWMAudioAEC();
    var props = (IPropertyStore)dmo;
    var aec = new Guid("6f52c567-0360-4bd2-9617-ccbf1421c939");
    Set(props, aec, 2, 3, 0);   // SYSTEM_MODE = SINGLE_CHANNEL_AEC (echo cancellation, one microphone)
    Set(props, aec, 4, 3, -1);  // DEVICE_INDEXES = default speaker and default microphone
    var wfx = Marshal.AllocHGlobal(18);                                    // WAVEFORMATEX: 16 kHz mono 16-bit PCM
    Marshal.WriteInt16(wfx, 0, 1); Marshal.WriteInt16(wfx, 2, 1); Marshal.WriteInt32(wfx, 4, 16000);
    Marshal.WriteInt32(wfx, 8, 32000); Marshal.WriteInt16(wfx, 12, 2); Marshal.WriteInt16(wfx, 14, 16); Marshal.WriteInt16(wfx, 16, 0);
    var mt = new DmoMediaType {
      majortype = new Guid("73647561-0000-0010-8000-00AA00389B71"), subtype = new Guid("00000001-0000-0010-8000-00AA00389B71"),
      bFixedSizeSamples = 1, lSampleSize = 2, formattype = new Guid("05589f81-c356-11ce-bf01-00aa0055595a"), cbFormat = 18, pbFormat = wfx,
    };
    Check(dmo.SetOutputType(0, ref mt, 0), "SetOutputType");
    Check(dmo.AllocateStreamingResources(), "AllocateStreamingResources");
  }
  static void Set(IPropertyStore p, Guid fmt, int pid, short vt, int val) {
    var k = new PropertyKey { fmtid = fmt, pid = pid }; var v = new PropVariant { vt = vt, intVal = val };
    Check(p.SetValue(ref k, ref v), "SetValue " + pid);
  }
  static void Check(int hr, string what) { if (hr < 0) throw new Exception(what + " failed: 0x" + hr.ToString("X8")); }
  // DMO_OUTPUT_DATA_BUFFER built by hand: { IMediaBuffer* pBuffer; DWORD dwStatus; REFERENCE_TIME rtTimestamp, rtTimelength }
  // (8 + 4 + 4 padding + 8 + 8 = 32 bytes on x64). Letting the marshaler build it crashed.
  IntPtr outStruct = IntPtr.Zero;
  public short[] Next() {
    if (outStruct == IntPtr.Zero) {
      outStruct = Marshal.AllocHGlobal(32);
      for (int b = 0; b < 32; b++) Marshal.WriteByte(outStruct, b, 0);
      Marshal.WriteIntPtr(outStruct, 0, Marshal.GetComInterfaceForObject(buf, typeof(IMediaBuffer)));
    }
    int statusOffset = IntPtr.Size;
    while (pending.Count < frame) {
      // Drain greedily: each call returns about 10 ms of audio. Waiting after every call (even when audio was
      // returned) read slower than real time, so the DSP's internal buffer overflowed after ~4 s
      // ("ProcessOutput failed: 0x87CC000A"). Only wait when it had nothing to give.
      int got = 0, status;
      do {
        buf.Length = 0;
        Marshal.WriteInt32(outStruct, statusOffset, 0);
        int hr = dmo.ProcessOutput(0, 1, outStruct, out status);
        if (hr < 0) throw new Exception("ProcessOutput failed: 0x" + hr.ToString("X8"));
        int n = buf.Length / 2;
        if (n > 0) { got += n; var tmp = new short[n]; Marshal.Copy(buf.Data, tmp, 0, n); foreach (var s in tmp) pending.Enqueue(s); }
      } while ((Marshal.ReadInt32(outStruct, statusOffset) & 0x01000000) != 0); // INCOMPLETE: more output is ready
      if (got == 0 && pending.Count < frame) Thread.Sleep(5);
    }
    var f = new short[frame]; for (int i = 0; i < frame; i++) f[i] = pending.Dequeue(); return f;
  }
}

// ---------- plain capture (fallback when echo cancellation is unavailable) ----------
public class WaveInSource : IFrameSource {
  [DllImport("winmm.dll")] static extern int waveInOpen(out IntPtr h, int dev, ref WaveFormat f, IntPtr cb, IntPtr inst, int flags);
  [DllImport("winmm.dll")] static extern int waveInPrepareHeader(IntPtr h, IntPtr hdr, int size);
  [DllImport("winmm.dll")] static extern int waveInAddBuffer(IntPtr h, IntPtr hdr, int size);
  [DllImport("winmm.dll")] static extern int waveInStart(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] struct WaveFormat { public short tag, channels; public int rate, bytesPerSec; public short align, bits, extra; }
  const int HdrSize = 48, FlagsOffset = 24, Done = 1, Prepared = 2, NBuf = 16;
  readonly IntPtr h; readonly IntPtr[] hdrs = new IntPtr[NBuf]; readonly int frame; int idx;
  public WaveInSource(int frameSamples) {
    frame = frameSamples;
    var fmt = new WaveFormat { tag = 1, channels = 1, rate = 16000, bits = 16, align = 2, bytesPerSec = 32000 };
    int err = waveInOpen(out h, -1, ref fmt, IntPtr.Zero, IntPtr.Zero, 0);
    if (err != 0) throw new Exception("Could not open the microphone (waveInOpen error " + err + ")");
    for (int i = 0; i < NBuf; i++) {
      hdrs[i] = Marshal.AllocHGlobal(HdrSize);
      for (int b = 0; b < HdrSize; b++) Marshal.WriteByte(hdrs[i], b, 0);
      Marshal.WriteIntPtr(hdrs[i], 0, Marshal.AllocHGlobal(frame * 2));
      Marshal.WriteInt32(hdrs[i], 8, frame * 2);
      waveInPrepareHeader(h, hdrs[i], HdrSize); waveInAddBuffer(h, hdrs[i], HdrSize);
    }
    waveInStart(h);
  }
  public short[] Next() {
    IntPtr hdr = hdrs[idx];
    while ((Marshal.ReadInt32(hdr, FlagsOffset) & Done) == 0) Thread.Sleep(3);
    var f = new short[frame]; Marshal.Copy(Marshal.ReadIntPtr(hdr, 0), f, 0, frame);
    Marshal.WriteInt32(hdr, FlagsOffset, Prepared); waveInAddBuffer(h, hdr, HdrSize);
    idx = (idx + 1) % NBuf; return f;
  }
}

// ---------- phrase detection ----------
public static class PhraseCapture {
  const int Rate = 16000, FrameMs = 30, Frame = Rate * FrameMs / 1000;            // 480 samples per frame
  const int PreRollFrames = 400 / FrameMs, EndFrames = 700 / FrameMs, MaxFrames = 10000 / FrameMs;
  const int StartFrames = 3, MinSpeechFrames = 8;                                  // 90 ms to start, 240 ms minimum

  static void Out(string s) { Console.Out.WriteLine(s); Console.Out.Flush(); }

  // Opens echo-cancelled capture when allowed, else the plain microphone.
  static IFrameSource Open(bool tryAec, out bool aec) {
    aec = false;
    if (tryAec) {
      try { var s = new AecSource(Frame); aec = true; return s; }
      catch (Exception e) { Console.Error.WriteLine("echo cancellation unavailable: " + e.Message); }
    }
    return new WaveInSource(Frame);
  }

  public static void Run(string clipDir, bool tryAec) {
    bool aec;
    IFrameSource src = Open(tryAec, out aec);
    Out(aec ? "READY AEC" : "READY");
    int failures = 0;

    var pre = new Queue<short[]>();
    var phrase = new List<short[]>();
    double noise = -1; bool inSpeech = false; int loud = 0, quiet = 0, speechFrames = 0;
    int speakerFrames = 0, phraseFrames = 0;
    var lastLevel = DateTime.MinValue; int lastLevelVal = -1;

    while (true) {
      short[] frame;
      try { frame = src.Next(); failures = 0; }
      catch (Exception e) {
        // Audio devices hiccup (a screen recorder starts sharing, headphones connect, the default device changes):
        // reopen capture instead of quitting. After repeated failures, use the plain microphone.
        failures++;
        Console.Error.WriteLine("capture interrupted (" + e.Message + "), reopening");
        Thread.Sleep(500);
        bool wasAec = aec;
        try { src = Open(tryAec && failures < 4, out aec); } catch (Exception e2) { Console.Error.WriteLine("reopen failed: " + e2.Message); Thread.Sleep(2000); continue; }
        if (aec != wasAec) Out(aec ? "READY AEC" : "READY");
        inSpeech = false; loud = 0; pre.Clear(); phrase.Clear();
        continue;
      }
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
          inSpeech = true; quiet = 0; speechFrames = loud; speakerFrames = 0; phraseFrames = 0;
          phrase.Clear(); phrase.AddRange(pre); pre.Clear();
          Out("HEAR speech");
        }
      } else {
        phrase.Add(frame);
        if (rms > endT) { speechFrames++; quiet = 0; } else quiet++;
        phraseFrames++; if (!aec && SpeakerMeter.Peak() > 0.02f) speakerFrames++;
        if (quiet >= EndFrames || phrase.Count >= MaxFrames) {
          inSpeech = false; loud = 0;
          if (speechFrames >= MinSpeechFrames)
            Out("AUDIO " + Save(clipDir, phrase) + (speakerFrames * 2 > phraseFrames ? " SPEAKERS" : ""));
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

# VOICE_AEC=0 turns echo cancellation off (plain microphone capture).
[PhraseCapture]::Run($clipDir, $env:VOICE_AEC -ne '0')
