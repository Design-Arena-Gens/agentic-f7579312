"use client";
import { useState, useEffect } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";

type Segment = { start: number; end: number; text: string; speaker: string };

type Translation = { language: string; segments: Array<{ start: number; end: number; text: string; speaker: string }> };

type SpeakerConfig = {
  speaker: string;
  strategy: "clone" | "preset";
  voiceId?: string;
  sampleFile?: File | null;
  provider: "elevenlabs" | "openai";
};

const ffmpeg = new FFmpeg();

const defaultTargets = [
  { code: "hi", label: "Hindi" },
  { code: "bn", label: "Bengali" },
  { code: "en", label: "English" },
];

export default function HomeClient() {
  const [ready, setReady] = useState(false);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [segments, setSegments] = useState<Segment[] | null>(null);
  const [speakers, setSpeakers] = useState<string[]>([]);
  const [speakerConfigs, setSpeakerConfigs] = useState<Record<string, SpeakerConfig>>({});
  const [targetLang, setTargetLang] = useState("hi");
  const [translations, setTranslations] = useState<Translation | null>(null);
  const [dubbedUrl, setDubbedUrl] = useState<string | null>(null);
  const [finalUrl, setFinalUrl] = useState<string | null>(null);
  const [originalSrtUrl, setOriginalSrtUrl] = useState<string | null>(null);
  const [targetSrtUrl, setTargetSrtUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    (async () => {
      await ffmpeg.load();
      setReady(true);
    })();
  }, []);

  async function extractAudio(file: File) {
    setProgress(5);
    const data = await fetchFile(file);
    await ffmpeg.writeFile("input.mp4", data);
    await ffmpeg.exec(["-i", "input.mp4", "-vn", "-ac", "1", "-ar", "44100", "input.wav"]);
    const wav = await ffmpeg.readFile("input.wav");
    const url = URL.createObjectURL(new Blob([wav], { type: "audio/wav" }));
    setAudioUrl(url);
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setVideoFile(f);
    await extractAudio(f);
  }

  async function transcribe() {
    if (!audioUrl) return;
    setProgress(10);
    const res = await fetch(audioUrl);
    const blob = await res.blob();
    const form = new FormData();
    form.append("audio", new File([blob], "input.wav", { type: "audio/wav" }));
    const tr = await fetch("/api/transcribe", { method: "POST", body: form, headers: {
      ...(typeof window !== 'undefined' && localStorage.getItem('assembly_key') ? { 'x-assemblyai-key': String(localStorage.getItem('assembly_key')) } : {})
    }});
    if (!tr.ok) throw new Error("Transcription failed");
    const json = await tr.json();
    const segs: Segment[] = json.segments;
    setSegments(segs);
    const uniqueSpeakers = Array.from(new Set(segs.map(s => s.speaker)));
    setSpeakers(uniqueSpeakers);
    setSpeakerConfigs(Object.fromEntries(uniqueSpeakers.map(s => [s, { speaker: s, strategy: "preset", provider: "openai", voiceId: "alloy", sampleFile: null }])));
    setProgress(25);
    const srt = segmentsToSrt(segs);
    const srtUrl = URL.createObjectURL(new Blob([srt], { type: "text/plain" }));
    setOriginalSrtUrl(srtUrl);
  }

  async function translate() {
    if (!segments) return;
    setProgress(35);
    const response = await fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(typeof window !== 'undefined' && localStorage.getItem('openai_key') ? { 'x-openai-key': String(localStorage.getItem('openai_key')) } : {}) },
      body: JSON.stringify({ target: targetLang, segments }),
    });
    if (!response.ok) throw new Error("Translation failed");
    const tr: Translation = await response.json();
    setTranslations(tr);
    setProgress(50);
    const srt = segmentsToSrt(tr.segments);
    const srtUrl = URL.createObjectURL(new Blob([srt], { type: "text/plain" }));
    setTargetSrtUrl(srtUrl);
  }

  function updateSpeakerConfig(s: string, patch: Partial<SpeakerConfig>) {
    setSpeakerConfigs(prev => ({ ...prev, [s]: { ...prev[s], ...patch } }));
  }

  async function synthesizeSegments() {
    if (!translations || !segments) return;
    setProgress(60);
    const segs = translations.segments;

    const payload = new FormData();
    payload.append("meta", JSON.stringify({
      segments: segs.map(s => ({ start: s.start, end: s.end, text: s.text, speaker: s.speaker })),
      speakers: speakers.map(s => speakerConfigs[s])
    }));
    for (const s of speakers) {
      const cfg = speakerConfigs[s];
      if (cfg.sampleFile) {
        payload.append(`sample_${s}`, cfg.sampleFile);
      }
    }

    const headers: Record<string,string> = {};
    const kOpen = typeof window !== 'undefined' ? localStorage.getItem('openai_key') : null;
    const kEl = typeof window !== 'undefined' ? localStorage.getItem('eleven_key') : null;
    if (kOpen) headers['x-openai-key'] = String(kOpen);
    if (kEl) headers['x-elevenlabs-key'] = String(kEl);
    const res = await fetch("/api/synthesize", { method: "POST", body: payload, headers });
    if (!res.ok) throw new Error("Synthesis failed");
    const { parts }: { parts: Array<{ filename: string; data: string; start: number }> } = await res.json();

    for (const p of parts) {
      const bin = Uint8Array.from(atob(p.data), c => c.charCodeAt(0));
      await ffmpeg.writeFile(p.filename, bin);
    }

    const inputs: string[] = [];
    const delays: string[] = [];
    parts.forEach((p, idx) => {
      inputs.push("-i", p.filename);
      const ms = Math.max(0, Math.round(p.start * 1000));
      delays.push(`[${idx}:a]adelay=${ms}|${ms}[a${idx}]`);
    });
    const amixInputs = parts.map((_, idx) => `[a${idx}]`).join("");
    const filter = `${delays.join(";")};${amixInputs}amix=inputs=${parts.length}:normalize=0[out]`;

    await ffmpeg.exec([...inputs, "-filter_complex", filter, "-map", "[out]", "-ar", "44100", "-ac", "2", "dubbed.wav"]);
    const dub = await ffmpeg.readFile("dubbed.wav");
    const dubUrl = URL.createObjectURL(new Blob([dub], { type: "audio/wav" }));
    setDubbedUrl(dubUrl);
    setProgress(70);
  }

  async function mixAndMux() {
    if (!dubbedUrl || !videoFile) return;
    setProgress(80);
    const dubBlob = await (await fetch(dubbedUrl)).blob();
    await ffmpeg.writeFile("dubbed.wav", new Uint8Array(await dubBlob.arrayBuffer()));

    await ffmpeg.exec([
      "-i", "input.wav",
      "-i", "dubbed.wav",
      "-filter_complex",
      "[0:a][1:a]sidechaincompress=threshold=0.05:ratio=8:attack=5:release=250[duck];[duck][1:a]amix=inputs=2:normalize=0[out]",
      "-map", "[out]",
      "-ar", "44100",
      "-ac", "2",
      "mixed.wav",
    ]);

    if (originalSrtUrl) {
      const b = await (await fetch(originalSrtUrl)).blob();
      await ffmpeg.writeFile("orig.srt", new Uint8Array(await b.arrayBuffer()));
    }
    if (targetSrtUrl) {
      const b = await (await fetch(targetSrtUrl)).blob();
      await ffmpeg.writeFile("target.srt", new Uint8Array(await b.arrayBuffer()));
    }

    await ffmpeg.writeFile("input.mp4", await fetchFile(videoFile));

    const args = ["-i", "input.mp4", "-i", "mixed.wav"] as string[];
    if (originalSrtUrl) { args.push("-i", "orig.srt"); }
    if (targetSrtUrl) { args.push("-i", "target.srt"); }

    const maps = ["-map", "0:v:0", "-map", "1:a:0"];
    const codec = ["-c:v", "copy", "-c:a", "aac"];

    const subArgs: string[] = [];
    if (originalSrtUrl && targetSrtUrl) {
      subArgs.push("-c:s", "mov_text", "-map", "2", "-map", "3", "-metadata:s:s:0", `language=xx`, "-metadata:s:s:1", `language=${targetLang}`);
    } else if (originalSrtUrl) {
      subArgs.push("-c:s", "mov_text", "-map", "2", "-metadata:s:s:0", `language=xx`);
    } else if (targetSrtUrl) {
      subArgs.push("-c:s", "mov_text", "-map", "2", "-metadata:s:s:0", `language=${targetLang}`);
    }

    await ffmpeg.exec([ ...args, ...maps, ...codec, ...subArgs, "-shortest", "-movflags", "faststart", "output.mp4" ]);
    const out = await ffmpeg.readFile("output.mp4");
    const url = URL.createObjectURL(new Blob([out], { type: "video/mp4" }));
    setFinalUrl(url);
    setProgress(100);
  }

  return (
    <div className="grid">
      <section className="card">
        <h2>1. Upload Video</h2>
        <input className="input" type="file" accept="video/*" onChange={handleUpload} />
        <div style={{ height: 12 }} />
        {videoFile && <span className="tag">{videoFile.name}</span>}
        <div style={{ height: 16 }} />
        <button disabled={!ready || !videoFile} className="btn" onClick={transcribe}>2. Transcribe + Diarize</button>
        <div style={{ height: 8 }} />
        <label>
          Target language
          <select className="select" value={targetLang} onChange={e => setTargetLang(e.target.value)}>
            {defaultTargets.map(l => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>
        </label>
        <div style={{ height: 8 }} />
        <button disabled={!segments} className="btn" onClick={translate}>3. Translate</button>
      </section>
      <section className="card">
        <h2>4. Voices</h2>
        {speakers.length === 0 && <p className="tag">Run transcription first</p>}
        {speakers.map((s) => {
          const cfg = speakerConfigs[s];
          return (
            <div key={s} className="card" style={{ marginBottom: 12 }}>
              <div className="row">
                <div className="col"><strong>Speaker {s}</strong></div>
                <div className="col">
                  <label>Provider
                    <select className="select" value={cfg.provider} onChange={e => updateSpeakerConfig(s, { provider: e.target.value as any })}>
                      <option value="openai">OpenAI</option>
                      <option value="elevenlabs">ElevenLabs</option>
                    </select>
                  </label>
                </div>
                <div className="col">
                  <label>Strategy
                    <select className="select" value={cfg.strategy} onChange={e => updateSpeakerConfig(s, { strategy: e.target.value as any })}>
                      <option value="preset">Preset</option>
                      <option value="clone">Clone</option>
                    </select>
                  </label>
                </div>
              </div>
              {cfg.strategy === "preset" && (
                <label>Voice ID / Name
                  <input className="input" value={cfg.voiceId || ""} onChange={e => updateSpeakerConfig(s, { voiceId: e.target.value })} placeholder={cfg.provider === "openai" ? "e.g., alloy, verse" : "ElevenLabs voice_id"} />
                </label>
              )}
              {cfg.strategy === "clone" && (
                <label>Upload 1-2 min voice sample (wav/mp3)
                  <input className="input" type="file" accept="audio/*" onChange={e => updateSpeakerConfig(s, { sampleFile: e.target.files?.[0] || null })} />
                </label>
              )}
            </div>
          );
        })}
        <button disabled={!translations} className="btn" onClick={synthesizeSegments}>5. Synthesize Dub</button>
      </section>

      <section className="card">
        <h2>6. Mix and Mux</h2>
        <button disabled={!dubbedUrl} className="btn" onClick={mixAndMux}>Generate Final Video</button>
        <div style={{ height: 10 }} />
        <div className="progress"><div className="bar" style={{ width: `${progress}%` }} /></div>
        <div style={{ height: 12 }} />
        {finalUrl && (
          <div>
            <video src={finalUrl} controls style={{ width: "100%" }} />
            <div className="row">
              <a className="btn secondary" href={finalUrl} download>Download Video</a>
              {originalSrtUrl && <a className="btn secondary" href={originalSrtUrl} download>Download Original SRT</a>}
              {targetSrtUrl && <a className="btn secondary" href={targetSrtUrl} download>Download Target SRT</a>}
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <h3>Preview</h3>
        <div className="row">
          {audioUrl && (
            <div className="col"><p>Original Audio</p><audio controls src={audioUrl} /></div>
          )}
          {dubbedUrl && (
            <div className="col"><p>Dubbed Audio</p><audio controls src={dubbedUrl} /></div>
          )}
        </div>
      </section>
    </div>
  );
}

function segmentsToSrt(segs: Segment[]) {
  const toTime = (t: number) => {
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = Math.floor(t % 60);
    const ms = Math.floor((t % 1) * 1000);
    const pad = (n: number, l = 2) => `${n}`.padStart(l, "0");
    return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
  };
  return segs.map((s, i) => `${i + 1}\n${toTime(s.start)} --> ${toTime(s.end)}\n${s.text}\n\n`).join("");
}
