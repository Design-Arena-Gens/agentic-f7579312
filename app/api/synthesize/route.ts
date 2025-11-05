import { NextRequest, NextResponse } from "next/server";
import { getKey } from "@/lib/keys";
import OpenAI from "openai";

export const runtime = "nodejs";
export const maxDuration = 300;

type Segment = { start: number; end: number; text: string; speaker: string };

type SpeakerCfg = { speaker: string; strategy: "clone"|"preset"; voiceId?: string; provider: "openai"|"elevenlabs" };

async function ttsOpenAI(client: OpenAI, text: string, voice: string) {
  const resp = await client.audio.speech.create({
    model: "gpt-4o-mini-tts",
    input: text,
    voice: voice || "alloy",
    format: "wav",
  } as any);
  const buf = Buffer.from(await resp.arrayBuffer());
  return buf;
}

async function elevenCreateVoice(apiKey: string, name: string, file: File): Promise<string> {
  const form = new FormData();
  form.append("name", name);
  form.append("files", file);
  const r = await fetch("https://api.elevenlabs.io/v1/voices/add", {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form,
  });
  if (!r.ok) throw new Error("elevenlabs voice create failed");
  const j = await r.json();
  return j.voice_id;
}

async function ttsEleven(apiKey: string, text: string, voiceId: string) {
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/wav" },
    body: JSON.stringify({ text, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.5, similarity_boost: 0.8 } }),
  });
  if (!r.ok) throw new Error("elevenlabs tts failed");
  const arr = await r.arrayBuffer();
  return Buffer.from(arr);
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const meta = JSON.parse(String(form.get("meta")) || "{}") as { segments: Segment[]; speakers: SpeakerCfg[] };
    const segs = meta.segments;
    const speakerCfgs = new Map<string, SpeakerCfg>(meta.speakers.map(s => [s.speaker, s]));

    const keyOpenAI = getKey("OPENAI_API_KEY");
    const keyEleven = getKey("ELEVENLABS_API_KEY");
    if (!keyOpenAI && !keyEleven) return NextResponse.json({ error: "No TTS provider configured" }, { status: 500 });

    const client = keyOpenAI ? new OpenAI({ apiKey: keyOpenAI }) : null;

    // Handle cloning uploads and resolve final voice ids
    const resolvedVoices = new Map<string, string>();
    for (const [spk, cfg] of speakerCfgs) {
      if (cfg.provider === "elevenlabs" && cfg.strategy === "clone") {
        const sample = form.get(`sample_${spk}`) as File | null;
        if (!sample) throw new Error(`missing sample for ${spk}`);
        const vid = await elevenCreateVoice(String(keyEleven), `Clone_${spk}_${Date.now()}`, sample);
        resolvedVoices.set(spk, vid);
      } else if (cfg.voiceId) {
        resolvedVoices.set(spk, cfg.voiceId);
      } else {
        resolvedVoices.set(spk, cfg.provider === "openai" ? "alloy" : "Rachel");
      }
    }

    // Synthesize each segment
    const results: { filename: string; data: string; start: number }[] = [];
    let idx = 0;
    for (const s of segs) {
      const cfg = speakerCfgs.get(s.speaker)!;
      const voice = resolvedVoices.get(s.speaker)!;
      let audio: Buffer;
      if (cfg.provider === "elevenlabs") {
        if (!keyEleven) throw new Error("ELEVENLABS_API_KEY missing");
        audio = await ttsEleven(String(keyEleven), s.text, voice);
      } else {
        if (!client) throw new Error("OPENAI_API_KEY missing");
        audio = await ttsOpenAI(client, s.text, voice);
      }
      const filename = `seg_${idx++}.wav`;
      results.push({ filename, data: audio.toString("base64"), start: s.start });
    }

    return NextResponse.json({ parts: results });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "unknown" }, { status: 500 });
  }
}
