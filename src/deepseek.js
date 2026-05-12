import { randomUUID } from 'node:crypto';

const BASE = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
const API_KEY = process.env.DEEPSEEK_API_KEY || '';
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

async function callAPI(messages, { maxTokens = 2048, temperature = 0.7 } = {}) {
  if (!API_KEY) throw new Error('DEEPSEEK_API_KEY is not set');

  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ model: MODEL, messages, max_tokens: maxTokens, temperature }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`DeepSeek API ${res.status}: ${body.slice(0, 200)}`);
  }

  return res.json();
}

function buildPrompt(ctx) {
  return [
    ctx.persona && `## 角色\n${ctx.persona}`,
    ctx.taste && `## 用户画像\n${ctx.taste}`,
    ctx.env && `## 当前环境\n${ctx.env}`,
    ctx.memory && `## 近期记忆\n${ctx.memory}`,
    ctx.input && `## 用户输入\n${ctx.input}`,
    ctx.trigger && `## 触发原因\n${ctx.trigger}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function parseJSON(text) {
  const cleaned = text
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch { /* fall through */ }
    }
    return { say: cleaned };
  }
}

export async function ask(ctx, options = {}) {
  const { maxTokens, temperature } = options;
  const prompt = buildPrompt(ctx);

  const messages = [
    { role: 'system', content: '你是一个 JSON 输出机器人，必须只输出有效的 JSON 对象，不要有任何其他文字。' },
    { role: 'user', content: prompt },
  ];

  const data = await callAPI(messages, { maxTokens, temperature });
  const content = data.choices?.[0]?.message?.content || '';

  const parsed = parseJSON(content);

  return {
    id: randomUUID(),
    say: parsed.say || content || '',
    play: Array.isArray(parsed.play) ? parsed.play : [],
    reason: parsed.reason || '',
    segue: parsed.segue || '',
    raw: content,
  };
}

export async function raw(prompt, options = {}) {
  const { maxTokens, temperature } = options;
  const messages = [{ role: 'user', content: prompt }];
  const data = await callAPI(messages, { maxTokens, temperature });
  return data.choices?.[0]?.message?.content || '';
}
