export type Segment = { start: number; end: number; text: string; speaker: string };
export type Translation = { language: string; segments: Segment[] };
export type SpeakerConfig = {
  speaker: string;
  strategy: "clone" | "preset";
  voiceId?: string;
  provider: "elevenlabs" | "openai";
};
