import 'dotenv/config';

const BASE = process.env.MUSIC_API_URL || 'http://localhost:4000';
const COOKIE = process.env.MUSIC_U ? `MUSIC_U=${process.env.MUSIC_U}` : '';

function auth(url) {
  if (!COOKIE) return url;
  return url + (url.includes('?') ? '&' : '?') + 'cookie=' + COOKIE;
}

export const provider = 'netease';
export const name = '网易云音乐';

export async function search(keyword, limit = 5) {
  if (!keyword || !keyword.trim()) return [];
  try {
    const url = auth(`${BASE}/search?keywords=${encodeURIComponent(keyword)}&limit=${limit}`);
    const res = await fetch(url);
    const data = await res.json();
    if (data.code !== 200 || !data.result?.songs) return [];
    return data.result.songs.slice(0, limit).map((s) => ({
      id: String(s.id),
      title: s.name,
      artist: (s.artists || []).map((a) => a.name).join('/'),
      album: s.album?.name || '',
      duration: s.duration || 0,
    }));
  } catch (err) {
    console.error('[netease] search error:', err.message);
    return [];
  }
}

export async function getSongUrl(id) {
  try {
    const url = auth(`${BASE}/song/url?id=${id}`);
    const res = await fetch(url);
    const data = await res.json();
    if (data.code === 200 && data.data?.[0]?.url) {
      return data.data[0].url;
    }
    return null;
  } catch (err) {
    console.error('[netease] getSongUrl error:', err.message);
    return null;
  }
}

export async function getLyric(id) {
  try {
    const url = auth(`${BASE}/lyric?id=${id}`);
    const res = await fetch(url);
    const data = await res.json();
    if (data.code === 200 && data.lrc?.lyric) {
      return data.lrc.lyric;
    }
    return '';
  } catch (err) {
    console.error('[netease] getLyric error:', err.message);
    return '';
  }
}

export async function loginByQR() {
  try {
    const keyRes = await fetch(`${BASE}/login/qr/key`);
    const keyData = await keyRes.json();
    if (keyData.code !== 200 || !keyData.data?.unikey) return null;
    const unikey = keyData.data.unikey;

    const qrRes = await fetch(`${BASE}/login/qr/create?key=${unikey}`);
    const qrData = await qrRes.json();
    if (qrData.code !== 200 || !qrData.data?.qrurl) return null;

    return { qrUrl: qrData.data.qrurl, unikey };
  } catch (err) {
    console.error('[netease] loginByQR error:', err.message);
    return null;
  }
}

export async function checkLoginStatus() {
  try {
    const res = await fetch(auth(`${BASE}/login/status`));
    const data = await res.json();
    if (data.data?.code === 200 && data.data?.profile) {
      return { loggedIn: true, profile: data.data.profile };
    }
    return { loggedIn: false, profile: null };
  } catch (err) {
    console.error('[netease] checkLoginStatus error:', err.message);
    return { loggedIn: false, profile: null };
  }
}
