// Minimal fetch polyfill for Node 16 (no global fetch).
// Uses only built-in node:https / node:http — zero dependencies.
import https from 'node:https';
import http from 'node:http';

const modByProto = { 'https:': https, 'http:': http };

function nodeFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = modByProto[parsed.protocol];
    if (!mod) return reject(new Error(`Unsupported protocol: ${parsed.protocol}`));

    const req = mod.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: options.method || 'GET',
        headers: options.headers || {},
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks);
          const body = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 400,
            status: res.statusCode,
            headers: res.headers,
            json: () => JSON.parse(raw.toString()),
            text: () => Promise.resolve(raw.toString()),
            arrayBuffer: () => Promise.resolve(body),
          });
        });
      }
    );

    req.on('error', reject);
    req.setTimeout(30_000, () => {
      req.destroy();
      reject(new Error('fetch timeout'));
    });

    if (options.body) req.write(options.body);
    req.end();
  });
}

// Install globally so all modules (deepseek.js, music.js, tts.js) see it.
if (typeof globalThis.fetch === 'undefined') {
  globalThis.fetch = nodeFetch;
}
