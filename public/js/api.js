export async function chat(text) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: text }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function getNow() {
  const res = await fetch('/api/now');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function getHistory(limit = 20) {
  const res = await fetch(`/api/history?limit=${limit}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function getTaste() {
  const res = await fetch('/api/taste');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function deleteMsg(id) {
  const res = await fetch(`/api/messages/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function chatWithRetry(text, maxRetries = 3) {
  let lastErr;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await chat(text);
    } catch (err) {
      lastErr = err;
      if (i < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 1000 * (i + 1)));
      }
    }
  }
  throw lastErr;
}
