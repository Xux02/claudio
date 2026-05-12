import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TTS_DIR = path.join(__dirname, '..', 'tts');
const TTS_URL = process.env.TTS_API_URL || 'http://localhost:5000';
const TTS_VOICE = process.env.TTS_VOICE || 'female';

function formatDate(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export async function synthesize(text) {
  if (!text || !text.trim()) return null;
  try {
    const res = await fetch(`${TTS_URL}/v1/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.trim(), voice: TTS_VOICE }),
    });
    if (!res.ok) {
      console.error('tts.synthesize: API returned', res.status);
      return null;
    }
    const buffer = await res.arrayBuffer();
    fs.mkdirSync(TTS_DIR, { recursive: true });
    const fileName = `${formatDate(new Date())}-${randomUUID().slice(0, 8)}.wav`;
    const filePath = path.join(TTS_DIR, fileName);
    fs.writeFileSync(filePath, Buffer.from(buffer));
    return `tts/${fileName}`;
  } catch (err) {
    console.error('tts.synthesize error:', err.message);
    return null;
  }
}
