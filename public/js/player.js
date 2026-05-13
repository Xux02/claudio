let audio = null;
let queue = [];
let currentIndex = -1;
let playing = false;
let clockTimer = null;
let playlistOpen = false;

// ─── Audio element ───────────────────────────────────────────

function getAudio() {
  if (!audio) {
    audio = document.getElementById('audio-player');
    if (audio) {
      audio.addEventListener('timeupdate', onTimeUpdate);
      audio.addEventListener('ended', onEnded);
      audio.addEventListener('error', onError);
      audio.addEventListener('play', () => syncPlayState(true));
      audio.addEventListener('pause', () => syncPlayState(false));
    }
  }
  return audio;
}

function onTimeUpdate() {
  const a = getAudio();
  const cur = a.currentTime || 0;
  const dur = a.duration || 0;
  if (dur > 0) {
    document.getElementById('progress-fill').style.width = ((cur / dur) * 100).toFixed(0) + '%';
    document.getElementById('time-current').textContent = formatTime(cur);
    document.getElementById('time-total').textContent = formatTime(dur);
  }
}

function onEnded() { playNext(); }
function onError() { console.error('Audio error, skipping'); playNext(); }

// ─── Clock ────────────────────────────────────────────────────

export function startClock() {
  tick();
  clockTimer = setInterval(tick, 1000);
}

function tick() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  document.getElementById('time-display').innerHTML = `${h}<span class="colon">:</span>${m}`;
  document.getElementById('day-of-week').textContent = now.toLocaleDateString('en-US', { weekday: 'long' });
}

// ─── Visualizer ───────────────────────────────────────────────

export function initVisualizer() {
  const c = document.getElementById('visualizer');
  c.innerHTML = '';
  const heights = [14, 44, 22, 48, 28, 40, 18, 36, 24, 46, 20, 42, 32, 38];
  for (let i = 0; i < 14; i++) {
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.height = heights[i] + 'px';
    bar.style.animationDelay = (i * 0.065).toFixed(2) + 's';
    c.appendChild(bar);
  }
}

// ─── Playlist toggle ──────────────────────────────────────────

export function togglePlaylist() {
  playlistOpen = !playlistOpen;
  const panel = document.getElementById('playlist-panel');
  panel.classList.toggle('collapsed', !playlistOpen);
  document.getElementById('btn-playlist').textContent = playlistOpen ? '✕' : '☰';
}

// ─── Queue / Playback ─────────────────────────────────────────

export function addToQueue(songs) {
  if (!songs || songs.length === 0) return;

  const wasIdle = queue.length === 0 || currentIndex === -1
    || (currentIndex >= queue.length - 1 && getAudio().ended);

  for (const s of songs) {
    if (s.url) queue.push(s);
  }

  // Auto-open playlist when new songs arrive
  if (!playlistOpen) togglePlaylist();

  renderPlaylist();

  if (wasIdle && queue.length > 0) {
    playIndex(currentIndex === -1 ? 0 : queue.length - songs.length);
  }
}

export function removeFromQueue(index) {
  if (index < 0 || index >= queue.length) return;

  if (index === currentIndex) {
    // Removing currently playing song — stop it and play next
    getAudio().pause();
    getAudio().src = '';
    queue.splice(index, 1);
    if (queue.length === 0) {
      currentIndex = -1;
      syncPlayState(false);
      updateDisplay({ title: '', artist: '' });
    } else {
      // currentIndex stays the same, but now points to the next song
      playIndex(Math.min(currentIndex, queue.length - 1));
    }
  } else {
    queue.splice(index, 1);
    if (index < currentIndex) currentIndex--;
    renderPlaylist();
  }
}

export function clearQueue() {
  queue = [];
  currentIndex = -1;
  const a = getAudio();
  a.pause();
  a.src = '';
  syncPlayState(false);
  updateDisplay({ title: '', artist: '' });
  renderPlaylist();
}

function playIndex(i) {
  if (i < 0 || i >= queue.length) {
    currentIndex = -1;
    const a = getAudio();
    a.pause();
    a.src = '';
    syncPlayState(false);
    updateDisplay({ title: '', artist: '' });
    renderPlaylist();
    return;
  }

  currentIndex = i;
  const song = queue[i];
  const a = getAudio();
  a.src = song.url;
  a.load();
  a.play().catch(err => { console.error('Play error:', err); playNext(); });
  updateDisplay(song);
  syncPlayState(true);
  renderPlaylist();
  document.dispatchEvent(new CustomEvent('claudio:nowPlaying', {
    detail: { title: song.title, artist: song.artist || '' }
  }));
}

function playNext() { playIndex(currentIndex + 1); }

function playPrev() {
  if (getAudio().currentTime > 3) {
    getAudio().currentTime = 0;
  } else if (currentIndex > 0) {
    playIndex(currentIndex - 1);
  } else {
    getAudio().currentTime = 0;
  }
}

// ─── UI helpers ───────────────────────────────────────────────

function updateDisplay(song) {
  document.getElementById('song-title').textContent = song.title || '';
  const artist = song.artist || '';
  const album = song.album || '';
  document.getElementById('song-artist').textContent = album ? `${artist} · ${album}` : artist;
  document.getElementById('progress-fill').style.width = '0%';
  document.getElementById('time-current').textContent = '0:00';
  document.getElementById('time-total').textContent = '0:00';
}

function syncPlayState(state) {
  playing = state;
  document.getElementById('btn-play').textContent = state ? '⏸' : '▶';
  const viz = document.getElementById('visualizer');
  viz.classList.toggle('playing', state);
}

function renderPlaylist() {
  const items = document.getElementById('playlist-items');
  const count = document.getElementById('playlist-count');

  if (queue.length === 0) {
    items.innerHTML = '<div class="playlist-empty">暂无歌曲</div>';
    count.textContent = '0首';
    return;
  }

  count.textContent = `${queue.length}首`;
  items.innerHTML = queue.map((s, i) => {
    const active = i === currentIndex;
    return `<div class="playlist-item${active ? ' active' : ''}" data-idx="${i}">
      <span class="playlist-index">${active ? '♪' : i + 1}</span>
      <div class="playlist-song-info">
        <span class="playlist-song-title">${esc(s.title)}</span>
        <span class="playlist-song-artist">${esc(s.artist || '')}</span>
      </div>
      ${s.reason ? `<span class="playlist-reason">${esc(s.reason)}</span>` : ''}
      <button class="playlist-del" data-idx="${i}" title="移除">×</button>
    </div>`;
  }).join('');

  // Click on song → play it (but not on the delete button)
  items.querySelectorAll('.playlist-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('playlist-del')) return;
      playIndex(parseInt(el.dataset.idx));
    });
  });

  // Click on delete button → remove
  items.querySelectorAll('.playlist-del').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFromQueue(parseInt(btn.dataset.idx));
    });
  });
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ─── Controls ─────────────────────────────────────────────────

export function togglePlay() {
  const a = getAudio();
  if (!a) return;
  if (a.paused) {
    if (a.src) { a.play(); }
    else if (queue.length > 0) { playIndex(currentIndex === -1 ? 0 : currentIndex); }
  } else {
    a.pause();
  }
}

export function playPrevSong() { playPrev(); }
export function playNextSong() { playNext(); }

export function setVolume(v) { getAudio().volume = v / 100; }

// ─── Utilities ────────────────────────────────────────────────

export function formatTime(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function setProgress(current, total) {
  const pct = total > 0 ? Math.min(100, (current / total) * 100) : 0;
  document.getElementById('progress-fill').style.width = pct.toFixed(0) + '%';
  document.getElementById('time-current').textContent = formatTime(current);
  document.getElementById('time-total').textContent = formatTime(total);
}

export function isPlaying() { return playing; }
export function getCurrentSong() { return currentIndex >= 0 ? queue[currentIndex] : null; }

export function update(song) { updateDisplay(song); }

export function setPlaying(state) {
  const a = getAudio();
  if (!a) { syncPlayState(state); return; }
  if (state && a.paused) {
    if (a.src) { a.play(); }
    else if (queue.length > 0) { playIndex(currentIndex === -1 ? 0 : currentIndex); }
    else { syncPlayState(true); }
  } else if (!state) {
    if (!a.paused) a.pause();
    else syncPlayState(false);
  }
}

// ─── Progress bar seeking ───────────────────────────────────────

let seekDragging = false;

function getSeekFraction(e) {
  const track = document.getElementById('progress-track');
  const rect = track.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
}

function handleSeekStart(e) {
  const a = getAudio();
  if (!a || !a.duration) return;
  seekDragging = true;
  const frac = getSeekFraction(e);
  a.currentTime = frac * a.duration;
  const fill = document.getElementById('progress-fill');
  fill.style.transition = 'none';
  document.addEventListener('mousemove', handleSeekMove);
  document.addEventListener('mouseup', handleSeekEnd);
  document.addEventListener('touchmove', handleSeekMove, { passive: false });
  document.addEventListener('touchend', handleSeekEnd);
  e.preventDefault();
}

function handleSeekMove(e) {
  if (!seekDragging) return;
  const a = getAudio();
  if (!a || !a.duration) return;
  const frac = getSeekFraction(e);
  a.currentTime = frac * a.duration;
}

function handleSeekEnd() {
  seekDragging = false;
  const fill = document.getElementById('progress-fill');
  fill.style.transition = 'width 0.25s linear';
  document.removeEventListener('mousemove', handleSeekMove);
  document.removeEventListener('mouseup', handleSeekEnd);
  document.removeEventListener('touchmove', handleSeekMove);
  document.removeEventListener('touchend', handleSeekEnd);
}

document.addEventListener('DOMContentLoaded', () => {
  const track = document.getElementById('progress-track');
  if (track) {
    track.addEventListener('mousedown', handleSeekStart);
    track.addEventListener('touchstart', handleSeekStart, { passive: false });
  }
});
