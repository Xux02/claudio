let currentSong = null;
let playing = false;

export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function initVisualizer() {
  const container = document.getElementById('visualizer');
  container.innerHTML = '';
  const heights = [14, 44, 22, 48, 28, 40, 18, 36, 24, 46, 20, 42, 32, 38];
  for (let i = 0; i < 14; i++) {
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.height = heights[i] + 'px';
    bar.style.animationDelay = (i * 0.065).toFixed(2) + 's';
    container.appendChild(bar);
  }
}

export function update(song) {
  currentSong = song;
  document.getElementById('song-title').textContent = song.title || '';
  const artist = song.artist || '';
  const album = song.album || '';
  document.getElementById('song-artist').textContent = album ? `${artist} · ${album}` : artist;
  setProgress(0, song.duration ? Math.floor(song.duration / 1000) : 0);
}

export function setProgress(current, total) {
  const pct = total > 0 ? Math.min(100, (current / total) * 100) : 0;
  document.getElementById('progress-fill').style.width = pct.toFixed(0) + '%';
  document.getElementById('time-current').textContent = formatTime(current);
  document.getElementById('time-total').textContent = formatTime(total);
  document.getElementById('time-display').textContent = formatTime(current);
}

export function setPlaying(state) {
  playing = state;
  document.getElementById('btn-play').textContent = state ? '⏸' : '▶';
  const viz = document.getElementById('visualizer');
  if (state) {
    viz.classList.add('playing');
  } else {
    viz.classList.remove('playing');
  }
}

export function isPlaying() {
  return playing;
}

export function getCurrentSong() {
  return currentSong;
}
