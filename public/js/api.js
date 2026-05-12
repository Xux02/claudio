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
