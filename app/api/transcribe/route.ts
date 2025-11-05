import { NextRequest, NextResponse } from "next/server";
import { getKey } from "@/lib/keys";

export const runtime = "nodejs";
export const maxDuration = 300; // allow long polling

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("audio") as File | null;
    if (!file) return NextResponse.json({ error: "missing audio" }, { status: 400 });

    const assemblyKey = getKey("ASSEMBLYAI_API_KEY");
    if (!assemblyKey) return NextResponse.json({ error: "ASSEMBLYAI_API_KEY not configured" }, { status: 500 });

    // 1) Upload audio to AssemblyAI
    const uploadRes = await fetch("https://api.assemblyai.com/v2/upload", {
      method: "POST",
      headers: { Authorization: assemblyKey },
      body: file.stream(),
    });
    if (!uploadRes.ok) {
      const t = await uploadRes.text();
      return NextResponse.json({ error: "upload failed", details: t }, { status: 500 });
    }
    const { upload_url } = await uploadRes.json();

    // 2) Create transcription request with diarization
    const createRes = await fetch("https://api.assemblyai.com/v2/transcript", {
      method: "POST",
      headers: { Authorization: assemblyKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        audio_url: upload_url,
        speaker_labels: true,
        language_detection: true,
        punctuate: true,
        format_text: true,
        word_boost: [],
      }),
    });
    if (!createRes.ok) return NextResponse.json({ error: "transcript create failed" }, { status: 500 });
    const createJson = await createRes.json();

    // 3) Poll until completed
    let status = "queued";
    let result: any = null;
    for (let i = 0; i < 300; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const r = await fetch(`https://api.assemblyai.com/v2/transcript/${createJson.id}`, {
        headers: { Authorization: assemblyKey },
      });
      const j = await r.json();
      status = j.status;
      if (status === "completed") { result = j; break; }
      if (status === "error") return NextResponse.json({ error: j.error }, { status: 500 });
    }
    if (!result) return NextResponse.json({ error: "timeout" }, { status: 504 });

    // 4) Build segments with speaker labels
    const segments: Array<{ start: number; end: number; text: string; speaker: string }> = [];
    if (Array.isArray(result.utterances)) {
      for (const u of result.utterances) {
        segments.push({ start: u.start / 1000, end: u.end / 1000, text: u.text, speaker: `S${u.speaker || 0}` });
      }
    } else if (Array.isArray(result.words)) {
      // fallback grouping by 5s windows
      let curStart = 0; let curEnd = 0; let curText: string[] = []; let sp = "S0";
      for (const w of result.words) {
        if (curText.length === 0) { curStart = w.start/1000; sp = "S0"; }
        curEnd = w.end/1000; curText.push(w.text);
        if (curEnd - curStart > 5) { segments.push({ start: curStart, end: curEnd, text: curText.join(" "), speaker: sp }); curText = []; }
      }
      if (curText.length) segments.push({ start: curStart, end: curEnd, text: curText.join(" "), speaker: sp });
    }

    return NextResponse.json({ language: result.language_code || "auto", segments });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "unknown" }, { status: 500 });
  }
}
