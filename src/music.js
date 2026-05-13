import * as netease from './music/netease.js';
import * as qq from './music/qq.js';

const PROVIDERS = [qq, netease];

export const providers = PROVIDERS.map(p => ({ provider: p.provider, name: p.name }));

// Simple search: try providers in order, return first successful results
export async function search(keyword, limit = 5) {
  for (const p of PROVIDERS) {
    const results = await p.search(keyword, limit);
    if (results.length > 0) return results;
  }
  return [];
}

// For resolvePlaylist: search ALL providers, return per-provider arrays
// Returns [{ provider, name, results }]
export async function searchAll(keyword, limit = 5) {
  const all = [];
  for (const p of PROVIDERS) {
    const results = await p.search(keyword, limit);
    all.push({ provider: p.provider, name: p.name, results });
  }
  return all;
}

// getSongUrl by composite id "provider:realId" — plain numeric IDs default to netease
export async function getSongUrl(compositeId) {
  if (!compositeId) return null;
  const colon = compositeId.indexOf(':');
  if (colon === -1) return netease.getSongUrl(compositeId);
  const provider = compositeId.slice(0, colon);
  const id = compositeId.slice(colon + 1);
  if (provider === 'qq') return qq.getSongUrl(id);
  return netease.getSongUrl(id);
}

// getLyric by composite id
export async function getLyric(compositeId) {
  if (!compositeId) return '';
  const colon = compositeId.indexOf(':');
  if (colon === -1) return netease.getLyric(compositeId);
  const provider = compositeId.slice(0, colon);
  const id = compositeId.slice(colon + 1);
  if (provider === 'qq') return qq.getLyric(id);
  return netease.getLyric(id);
}

// Re-export netease-specific auth functions (only netease supports these)
export const loginByQR = netease.loginByQR;
export const checkLoginStatus = netease.checkLoginStatus;
