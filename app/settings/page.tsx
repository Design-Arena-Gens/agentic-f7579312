"use client";
import { useEffect, useState } from "react";

export default function SettingsPage() {
  const [assembly, setAssembly] = useState("");
  const [openai, setOpenai] = useState("");
  const [eleven, setEleven] = useState("");

  useEffect(() => {
    setAssembly(localStorage.getItem("assembly_key") || "");
    setOpenai(localStorage.getItem("openai_key") || "");
    setEleven(localStorage.getItem("eleven_key") || "");
  }, []);

  function save() {
    localStorage.setItem("assembly_key", assembly);
    localStorage.setItem("openai_key", openai);
    localStorage.setItem("eleven_key", eleven);
    alert("Saved locally. Server will use env vars if set.");
  }

  return (
    <div className="card">
      <h2>API Keys</h2>
      <p>Keys are stored locally in your browser and sent to the server for requests if env vars are not configured.</p>
      <label>AssemblyAI API Key<input className="input" value={assembly} onChange={e => setAssembly(e.target.value)} /></label>
      <label>OpenAI API Key<input className="input" value={openai} onChange={e => setOpenai(e.target.value)} /></label>
      <label>ElevenLabs API Key<input className="input" value={eleven} onChange={e => setEleven(e.target.value)} /></label>
      <div style={{ height: 12 }} />
      <button className="btn" onClick={save}>Save</button>
    </div>
  );
}
