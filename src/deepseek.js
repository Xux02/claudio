import { randomUUID } from 'node:crypto';

const BASE = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
const API_KEY = process.env.DEEPSEEK_API_KEY || '';
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const REASONER_MODEL = process.env.DEEPSEEK_REASONER_MODEL || 'deepseek-reasoner';

async function callAPI(messages, { maxTokens = 2048, temperature, useReasoner = true } = {}) {
  if (!API_KEY) throw new Error('DEEPSEEK_API_KEY is not set');

  const body = {
    model: useReasoner ? REASONER_MODEL : MODEL,
    messages,
    max_tokens: maxTokens,
  };
  // Reasoner doesn't support temperature
  if (!useReasoner && temperature !== undefined) {
    body.temperature = temperature;
  }

  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DeepSeek API ${res.status}: ${text.slice(0, 200)}`);
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

const SYSTEM_INSTRUCTION = '在回复之前，请先深入分析用户的需求、当前时间与环境氛围、用户的听歌口味和近期播放历史。像一个真正了解用户的朋友一样思考后再给出回复。不要使用任何固定句式或模板（如"好的，我为你推荐..."、"为你找到X首歌"），每次回复都应该是独一无二的。你必须只输出一个 JSON 对象，不要包含任何其他文字。';

export async function ask(ctx, options = {}) {
  const { maxTokens, useReasoner = true } = options;
  const prompt = buildPrompt(ctx);

  // Reasoner may not support system messages — merge into user prompt
  const messages = useReasoner
    ? [{ role: 'user', content: `${SYSTEM_INSTRUCTION}\n\n${prompt}` }]
    : [
        { role: 'system', content: SYSTEM_INSTRUCTION },
        { role: 'user', content: prompt },
      ];

  const data = await callAPI(messages, { maxTokens, useReasoner });

  const msg = data.choices?.[0]?.message || {};
  const content = msg.content || '';

  if (msg.reasoning_content) {
    console.log('[deepseek] thinking:', msg.reasoning_content.slice(0, 120), '...');
  }

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
  const { maxTokens } = options;
  const messages = [{ role: 'user', content: prompt }];
  const data = await callAPI(messages, { maxTokens, useReasoner: false });
  return data.choices?.[0]?.message?.content || '';
}
