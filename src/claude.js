import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const DEFAULT_TIMEOUT = 30_000;
const MAX_RETRIES = 2;

/**
 * Normalize a stream-of-objects or single-object Claude JSON response into a
 * plain { say, play, reason, segue, ... } object.
 *
 * Claude's --output-format json mode may emit multiple JSON objects (one per
 * line streamed) or a single one. We take the final complete object as the
 * authoritative result.
 */
function parseClaudeOutput(raw) {
  const lines = raw.split(/\r?\n/).filter(Boolean);
  let last = null;
  for (const line of lines) {
    try {
      last = JSON.parse(line);
    } catch {
      // Claude may wrap output with markdown fences; try to extract
      const match = line.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          last = JSON.parse(match[0]);
        } catch {
          /* not every line is JSON */
        }
      }
    }
  }

  if (!last) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        last = JSON.parse(match[0]);
      } catch {
        /* will throw below */
      }
    }
  }

  if (!last || typeof last !== 'object') {
    throw new Error(
      `Claude response was not valid JSON. Raw output:\n${raw.slice(0, 500)}`
    );
  }

  return last;
}

/**
 * Build the CLI argument list for a `claude` invocation.
 */
function buildArgs({ prompt, json = true, model, maxTokens }) {
  const args = ['-p', prompt];

  if (json) {
    args.push('--output-format', 'json');
  }

  if (model) {
    args.push('--model', model);
  }

  if (maxTokens) {
    args.push('--max-tokens', String(maxTokens));
  }

  return args;
}

/**
 * Execute a single `claude` call via child_process.spawn.
 */
function spawnClaude(opts) {
  const {
    prompt,
    model,
    json = true,
    maxTokens,
    timeout = DEFAULT_TIMEOUT,
    signal,
  } = opts;

  const args = buildArgs({ prompt, json, model, maxTokens });
  const child = spawn('claude', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  return new Promise((resolve, reject) => {
    const stdoutChunks = [];
    const stderrChunks = [];

    child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk) => stderrChunks.push(chunk));

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Claude call timed out after ${timeout}ms`));
    }, timeout);

    const onAbort = () => {
      child.kill('SIGTERM');
      reject(new Error('Claude call aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    child.on('error', (err) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(
        new Error(
          `Failed to spawn claude CLI. Is it installed? ${err.message}`
        )
      );
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);

      const stdout = Buffer.concat(stdoutChunks).toString('utf-8').trim();
      const stderr = Buffer.concat(stderrChunks).toString('utf-8').trim();

      if (code !== 0) {
        reject(
          new Error(`Claude exited with code ${code}\nstderr: ${stderr}`)
        );
        return;
      }

      try {
        const parsed = json ? parseClaudeOutput(stdout) : { say: stdout };
        resolve({
          say: parsed.say ?? '',
          play: parsed.play ?? [],
          reason: parsed.reason ?? '',
          segue: parsed.segue ?? '',
        });
      } catch (err) {
        reject(err);
      }
    });
  });
}

/**
 * Main entry point – call Claude with retry logic.
 *
 * @param {Object} ctx – assembled context with keys:
 *   persona  – DJ persona prompt
 *   taste    – user taste profile
 *   env      – weather, calendar, time
 *   memory   – recent plays from state.db
 *   trigger  – scheduler trigger reason
 *   input    – user message or tool result (e.g. Netease search)
 * @returns {Promise<{id:string, say:string, play:Array, reason:string, segue:string, raw:string}>}
 */
export async function ask(ctx, options = {}) {
  const { timeout, retries = MAX_RETRIES } = options;

  const prompt = [
    ctx.persona && `## 角色\n${ctx.persona}`,
    ctx.taste && `## 用户画像\n${ctx.taste}`,
    ctx.env && `## 当前环境\n${ctx.env}`,
    ctx.memory && `## 近期记忆\n${ctx.memory}`,
    ctx.input && `## 用户输入 / 工具结果\n${ctx.input}`,
    ctx.trigger && `## 触发原因\n${ctx.trigger}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await spawnClaude({ prompt, timeout });
      return {
        id: randomUUID(),
        say: result.say || '',
        play: Array.isArray(result.play) ? result.play : [],
        reason: result.reason || '',
        segue: result.segue || '',
        raw: JSON.stringify(result),
      };
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }

  throw lastError;
}

/**
 * Lightweight raw call – pass a plain prompt string, get text back.
 */
export async function raw(prompt, options = {}) {
  const { timeout, retries = 0 } = options;
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await spawnClaude({ prompt, timeout, json: false });
      return result.say;
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

/**
 * Stream variant – yields parsed JSON objects as they arrive from stdout.
 */
export async function* stream(ctx, options = {}) {
  const { timeout = DEFAULT_TIMEOUT } = options;

  const prompt = [
    ctx.persona && `## 角色\n${ctx.persona}`,
    ctx.taste && `## 用户画像\n${ctx.taste}`,
    ctx.env && `## 当前环境\n${ctx.env}`,
    ctx.memory && `## 近期记忆\n${ctx.memory}`,
    ctx.input && `## 用户输入 / 工具结果\n${ctx.input}`,
    ctx.trigger && `## 触发原因\n${ctx.trigger}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const args = buildArgs({ prompt, json: true });
  const child = spawn('claude', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const timer = setTimeout(() => child.kill('SIGTERM'), timeout);

  try {
    for await (const chunk of child.stdout) {
      const lines = chunk.toString('utf-8').split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          if (obj && typeof obj === 'object') yield obj;
        } catch {
          // skip non-JSON output
        }
      }
    }
  } finally {
    clearTimeout(timer);
    child.kill();
  }
}
