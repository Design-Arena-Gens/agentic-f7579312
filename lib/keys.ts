import { headers } from "next/headers";

export function getKey(name: "OPENAI_API_KEY" | "ASSEMBLYAI_API_KEY" | "ELEVENLABS_API_KEY"): string | null {
  const env = process.env[name];
  if (env && env.trim()) return env.trim();
  // fallback to header from client settings (not ideal for prod, but convenient for demo)
  try {
    const h = headers();
    const map: Record<string, string> = {
      OPENAI_API_KEY: "x-openai-key",
      ASSEMBLYAI_API_KEY: "x-assemblyai-key",
      ELEVENLABS_API_KEY: "x-elevenlabs-key",
    };
    const val = h.get(map[name]);
    return val && val.trim() ? val.trim() : null;
  } catch {
    return null;
  }
}
