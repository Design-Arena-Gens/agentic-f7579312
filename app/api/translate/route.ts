import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { getKey } from "@/lib/keys";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const { target, segments } = await req.json();
    if (!target || !Array.isArray(segments)) return NextResponse.json({ error: "bad request" }, { status: 400 });

    const key = getKey("OPENAI_API_KEY");
    if (!key) return NextResponse.json({ error: "OPENAI_API_KEY not configured" }, { status: 500 });

    const client = new OpenAI({ apiKey: key });
    const joined = segments.map((s: any) => `[${s.speaker}] ${s.text}`).join("\n");
    const prompt = `Translate the following lines into ${target}. Keep meaning, tone, and brevity suitable for dubbing. Return as JSON array of strings only, one per line, without extra commentary. Lines:\n${joined}`;

    const chat = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a professional dubbing translator. Keep timing consistent and keep sentences concise." },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
      response_format: { type: "json_object" },
    });

    const content = chat.choices[0]?.message?.content || "{}";
    let arr: string[] = [];
    try {
      const obj = JSON.parse(content);
      const firstKey = Object.keys(obj)[0];
      arr = Array.isArray(obj[firstKey]) ? obj[firstKey] : (Array.isArray(obj.lines) ? obj.lines : []);
    } catch {
      arr = [];
    }
    if (arr.length !== segments.length) {
      // fallback: naive split by lines in message content (non-json)
      const txt = chat.choices[0]?.message?.content || "";
      arr = txt.split(/\n+/).filter(Boolean);
      if (arr.length !== segments.length) arr = segments.map((s: any) => s.text);
    }

    const translated = segments.map((s: any, i: number) => ({ ...s, text: arr[i] || s.text }));

    return NextResponse.json({ language: target, segments: translated });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "unknown" }, { status: 500 });
  }
}
