"""TTS HTTP API — wraps edge-tts for Claudio."""
import sys
import io
import tempfile
import subprocess
import json
import os
import asyncio
from http.server import HTTPServer, BaseHTTPRequestHandler

VOICE = os.environ.get("TTS_VOICE", "zh-CN-XiaoxiaoNeural")
PORT = int(os.environ.get("TTS_PORT", "5000"))


class TTSHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/v1/tts":
            self.send_response(404)
            self.end_headers()
            return

        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length))
            text = (body.get("text", "") or "").strip()
            voice = body.get("voice", VOICE)

            if not text:
                self.send_error(400, "text is required")
                return

            wav = asyncio.run(self._synth(text, voice))
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", len(wav))
            self.end_headers()
            self.wfile.write(wav)
        except Exception as e:
            print(f"[TTS] error: {e}", file=sys.stderr)
            self.send_error(500, str(e))

    @staticmethod
    async def _synth(text, voice):
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
            tmp_path = tmp.name
        try:
            proc = await asyncio.create_subprocess_exec(
                sys.executable, "-m", "edge_tts",
                "--voice", voice,
                "--text", text,
                "--write-media", tmp_path,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            await proc.communicate()
            if proc.returncode != 0:
                raise RuntimeError(f"edge-tts exited with code {proc.returncode}")

            try:
                convert = await asyncio.create_subprocess_exec(
                    "ffmpeg", "-y", "-i", tmp_path, "-f", "wav", "pipe:1",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.DEVNULL,
                )
                wav, _ = await convert.communicate()
                if convert.returncode == 0 and wav:
                    return wav
            except FileNotFoundError:
                pass

            with open(tmp_path, "rb") as f:
                return f.read()
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    def log_message(self, fmt, *args):
        pass  # suppress access logs


if __name__ == "__main__":
    print(f"[TTS] Starting on :{PORT}, voice={VOICE}")
    HTTPServer(("127.0.0.1", PORT), TTSHandler).serve_forever()
