const BASE = process.env.MUSIC_API_URL || 'http://localhost:4000';

export async function search(keyword, limit = 5) {
  if (!keyword || !keyword.trim()) return [];
  try {
    const url = `${BASE}/search?keywords=${encodeURIComponent(keyword)}&limit=${limit}`;
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
    console.error('music.search error:', err.message);
    return [];
  }
}

export async function getSongUrl(id) {
  try {
    const url = `${BASE}/song/url?id=${id}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.code === 200 && data.data?.[0]?.url) {
      return data.data[0].url;
    }
    return null;
  } catch (err) {
    console.error('music.getSongUrl error:', err.message);
    return null;
  }
}

export async function getLyric(id) {
  try {
    const url = `${BASE}/lyric?id=${id}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.code === 200 && data.lrc?.lyric) {
      return data.lrc.lyric;
    }
    return '';
  } catch (err) {
    console.error('music.getLyric error:', err.message);
    return '';
  }
}
