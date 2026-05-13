import 'dotenv/config';

const UIN = process.env.QQ_MUSIC_UIN || '';
const QQ_MUSIC_KEY = process.env.QQ_MUSIC_KEY || '';

// Build cookie string for auth
const COOKIE = UIN ? `uin=o0${UIN}; qqmusic_key=${QQ_MUSIC_KEY}; qm_keyst=${QQ_MUSIC_KEY}` : '';

const headers = COOKIE ? {
  Cookie: COOKIE,
  Referer: 'https://y.qq.com',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
} : {
  Referer: 'https://y.qq.com',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
};

export const provider = 'qq';
export const name = 'QQ音乐';

function formatSong(s) {
  return {
    id: s.songmid || s.mid || String(s.id || ''),
    title: s.songname || s.name || '',
    artist: (s.singer || []).map((a) => a.name || a).join('/'),
    album: s.albumname || s.album?.name || '',
    duration: s.interval || s.duration || 0,
  };
}

export async function search(keyword, limit = 5) {
  if (!keyword || !keyword.trim()) return [];
  try {
    const params = new URLSearchParams({
      format: 'json',
      n: String(limit),
      p: '1',
      w: keyword,
      cr: '1',
      g_tk: '5381',
      t: '0',
    });
    const url = `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?${params}`;
    const res = await fetch(url, { headers });
    const data = await res.json();
    if (data.code !== 0 || !data.data?.song?.list) return [];
    return data.data.song.list.slice(0, limit).map(formatSong);
  } catch (err) {
    console.error('[qq] search error:', err.message);
    return [];
  }
}

export async function getSongUrl(songmid) {
  if (!songmid) return null;

  // Try up to 5 times to get a valid vkey
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const guid = String(Math.floor(Math.random() * 10000000));
      const bodyData = {
        req_0: {
          module: 'vkey.GetVkeyServer',
          method: 'CgiGetVkey',
          param: {
            filename: [`M500${songmid}${songmid}.mp3`],
            guid,
            songmid: [songmid],
            songtype: [0],
            uin: UIN,
            loginflag: 1,
            platform: '20',
          },
        },
        comm: {
          uin: UIN,
          format: 'json',
          ct: 19,
          cv: 0,
          authst: QQ_MUSIC_KEY,
        },
      };
      const params = new URLSearchParams({
        '-': 'getplaysongvkey',
        g_tk: '5381',
        loginUin: UIN,
        hostUin: '0',
        format: 'json',
        inCharset: 'utf8',
        outCharset: 'utf-8',
        notice: '0',
        platform: 'yqq.json',
        needNewCode: '0',
        data: JSON.stringify(bodyData),
      });
      const res = await fetch(`https://u.y.qq.com/cgi-bin/musicu.fcg?${params}`, { headers });
      const data = await res.json();

      if (data.req_0?.data?.midurlinfo?.[0]?.purl) {
        const purl = data.req_0.data.midurlinfo[0].purl;
        // Try non-ws domain first, fall back to first available
        const domain = (data.req_0.data.sip || []).find(i => !i.startsWith('http://ws'))
          || data.req_0.data.sip?.[0]
          || 'http://aqqmusic.tc.qq.com/';
        return domain + purl;
      }
    } catch (err) {
      console.error('[qq] getSongUrl error:', err.message);
    }
  }
  return null;
}

export async function getLyric(songmid) {
  if (!songmid) return '';
  try {
    const params = new URLSearchParams({
      format: 'json',
      songmid,
      g_tk: '5381',
    });
    const url = `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?${params}`;
    const res = await fetch(url, { headers: { ...headers, Referer: 'https://y.qq.com/portal/player.html' } });
    const data = await res.json();
    if (data.code === 0 && data.lyric) {
      return Buffer.from(data.lyric, 'base64').toString('utf-8');
    }
    return '';
  } catch (err) {
    console.error('[qq] getLyric error:', err.message);
    return '';
  }
}
