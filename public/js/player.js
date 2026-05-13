let audio = null;
let queue = [];
let currentIndex = -1;
let playing = false;
let clockTimer = null;
let playlistOpen = false;
let lastNotifiedKey = '';

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

// ─── Visualizer (Web Audio API) ───────────────────────────────

let audioCtx = null;
let analyser = null;
let sourceAttached = false;
let vizAnimId = null;
let vizBars = [];

// 7 frequency bins for mirrored center-out spectrum (fftSize=256 → 128 bins)
// i=0 is bass (center), i=6 is treble (edges)
const BIN_INDICES = [0, 1, 2, 3, 5, 8, 16];

export function initVisualizer() {
  const c = document.getElementById('visualizer');
  c.innerHTML = '';
  vizBars = [];
  for (let i = 0; i < 14; i++) {
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.height = '3px';
    c.appendChild(bar);
    vizBars.push(bar);
  }
}

export function initAudioContext() {
  if (audioCtx) return;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  audioCtx = new AudioCtx();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.8;
}

function attachSource() {
  if (sourceAttached || !audioCtx || !analyser) return;
  const a = getAudio();
  if (!a) return;

  // Primary: MediaElementSource (requires crossorigin="anonymous" on <audio>)
  try {
    const source = audioCtx.createMediaElementSource(a);
    source.connect(analyser);
    analyser.connect(audioCtx.destination);
    sourceAttached = true;
    return;
  } catch (e) {
    console.warn('MediaElementSource failed, trying captureStream:', e.message);
  }

  // Fallback: captureStream — avoids CORS but needs audio track to be ready
  if (a.captureStream) {
    try {
      const stream = a.captureStream();
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);
      const gain = audioCtx.createGain();
      gain.gain.value = 0;
      analyser.connect(gain);
      gain.connect(audioCtx.destination);
      sourceAttached = true;
    } catch {}
  }
}

export function startVisualizer() {
  if (!analyser || vizAnimId) return;
  attachSource();

  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  function draw() {
    vizAnimId = requestAnimationFrame(draw);
    analyser.getByteFrequencyData(dataArray);

    for (let i = 0; i < BIN_INDICES.length; i++) {
      const val = dataArray[BIN_INDICES[i]] || 0;
      const norm = val / 255;
      const h = Math.max(3, norm * 48);
      const hStr = h.toFixed(1) + 'px';

      // Mirror from center outward: i=0→center bass, i=6→edge treble
      const leftIdx = 6 - i;
      const rightIdx = 7 + i;

      vizBars[leftIdx].style.height = hStr;
      vizBars[rightIdx].style.height = hStr;

      if (norm > 0.35) {
        const glow = `0 0 ${(norm * 10).toFixed(1)}px rgba(201,168,124,${(norm * 0.7).toFixed(2)})`;
        vizBars[leftIdx].style.boxShadow = glow;
        vizBars[rightIdx].style.boxShadow = glow;
      } else {
        vizBars[leftIdx].style.boxShadow = 'none';
        vizBars[rightIdx].style.boxShadow = 'none';
      }
    }
  }

  draw();
}

export function stopVisualizer() {
  if (vizAnimId) {
    cancelAnimationFrame(vizAnimId);
    vizAnimId = null;
  }
  for (const bar of vizBars) {
    bar.style.height = '3px';
    bar.style.boxShadow = 'none';
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
  initAudioContext();
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  a.src = song.url;
  a.load();
  attachSource();
  a.play().catch(err => { console.error('Play error:', err); playNext(); });
  updateDisplay(song);
  syncPlayState(true);
  renderPlaylist();

  const songKey = `${song.title}|${song.artist || ''}`;
  if (songKey !== lastNotifiedKey) {
    lastNotifiedKey = songKey;
    document.dispatchEvent(new CustomEvent('claudio:nowPlaying', {
      detail: { title: song.title, artist: song.artist || '' }
    }));
  }
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
  const title = song.title || '';
  const artist = song.artist || '';
  const album = song.album || '';
  const artistText = album ? `${artist} · ${album}` : artist;
  // Original song-info block (standalone)
  const titleEl = document.getElementById('song-title');
  const artistEl = document.getElementById('song-artist');
  if (titleEl) titleEl.textContent = title;
  if (artistEl) artistEl.textContent = artistText;
  // Inline song info in controls row
  const titleInEl = document.getElementById('song-title-inline');
  const artistInEl = document.getElementById('song-artist-inline');
  if (titleInEl) titleInEl.textContent = title || 'Claudio FM';
  if (artistInEl) artistInEl.textContent = artistText || (title ? '' : '等待点歌');
  document.getElementById('progress-fill').style.width = '0%';
  document.getElementById('time-current').textContent = '0:00';
  document.getElementById('time-total').textContent = '0:00';
}

function syncPlayState(state) {
  playing = state;
  document.getElementById('btn-play').textContent = state ? '⏸' : '▶';
  const viz = document.getElementById('visualizer');
  viz.classList.toggle('playing', state);
  if (state) {
    initAudioContext();
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    startVisualizer();
  } else {
    stopVisualizer();
  }
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

// ─── Custom volume slider ─────────────────────────────────────

let volValue = 65;
let volDragging = false;
let volFillValue = 65;
let volRaf = null;
let volPreMute = 65;

function volSliderEl() { return document.getElementById('vol-slider'); }
function volFillEl() { return volSliderEl()?.querySelector('.vol-track-fill'); }
function volIconEl() { return document.getElementById('vol-icon'); }

function volGetFraction(e) {
  const rect = volSliderEl().getBoundingClientRect();
  const x = e.touches ? e.touches[0].clientX : e.clientX;
  return Math.max(0, Math.min(1, (x - rect.left) / rect.width));
}

function volUpdateIcon(v) {
  const icon = volIconEl();
  if (!icon) return;
  icon.style.opacity = v === 0 ? '0.25' : '';
}

function volApplyValue(v, instant) {
  volValue = v;
  const fill = volFillEl();
  const pct = v.toFixed(0) + '%';
  if (fill) {
    fill.style.width = pct;
    if (instant) fill.style.transition = 'none';
    else fill.style.transition = '';
  }
  volSliderEl().setAttribute('aria-valuenow', v);
  volUpdateIcon(v);
  setVolume(v);
}

function volSetValue(v) {
  volValue = Math.max(0, Math.min(100, Math.round(v)));
  volFillValue = volValue;
  volApplyValue(volValue, true);
}

// rAF loop: fill chases target with spring-like tension during drag
function volDragLoop() {
  if (!volDragging) return;
  volFillValue += (volValue - volFillValue) * 0.32;
  const fill = volFillEl();
  if (fill) fill.style.width = volFillValue.toFixed(0) + '%';
  volRaf = requestAnimationFrame(volDragLoop);
}

function volOnPointerDown(e) {
  const slider = volSliderEl();
  if (!slider) return;
  volDragging = true;
  slider.classList.add('dragging');
  volFillValue = volValue;
  if (volRaf) cancelAnimationFrame(volRaf);

  const newVal = Math.round(volGetFraction(e) * 100);
  volValue = newVal;
  volApplyValue(newVal, true);

  volRaf = requestAnimationFrame(volDragLoop);
  e.preventDefault();
}

function volOnPointerMove(e) {
  if (!volDragging) return;
  const newVal = Math.round(volGetFraction(e) * 100);
  volValue = newVal;
  const fill = volFillEl();
  if (fill) fill.style.width = newVal.toFixed(0) + '%';
  volSliderEl().setAttribute('aria-valuenow', newVal);
  volUpdateIcon(newVal);
  setVolume(newVal);
}

function volOnPointerUp() {
  if (!volDragging) return;
  volDragging = false;
  const slider = volSliderEl();
  if (slider) slider.classList.remove('dragging');
  if (volRaf) cancelAnimationFrame(volRaf);

  const fill = volFillEl();
  if (fill) {
    fill.style.transition = '';
    fill.style.width = volValue.toFixed(0) + '%';
  }
}

export function initVolumeSlider() {
  const slider = volSliderEl();
  if (!slider) return;

  // Mouse
  slider.addEventListener('mousedown', volOnPointerDown);
  document.addEventListener('mousemove', volOnPointerMove);
  document.addEventListener('mouseup', volOnPointerUp);

  // Touch
  slider.addEventListener('touchstart', volOnPointerDown, { passive: false });
  document.addEventListener('touchmove', volOnPointerMove, { passive: false });
  document.addEventListener('touchend', volOnPointerUp);

  // Keyboard
  slider.addEventListener('keydown', (e) => {
    let delta = 0;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') delta = -5;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') delta = 5;
    if (delta !== 0) {
      e.preventDefault();
      volSetValue(volValue + delta);
    }
  });

  // Mute/unmute on VOL click
  const icon = volIconEl();
  if (icon) {
    icon.addEventListener('click', (e) => {
      e.stopPropagation();
      if (volValue > 0) {
        volPreMute = volValue;
        volSetValue(0);
      } else {
        volSetValue(volPreMute);
      }
    });
  }

  // Initialize
  volApplyValue(65, true);
}

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
  const bar = document.querySelector('.progress-bar-bg');
  if (!bar) return 0;
  const rect = bar.getBoundingClientRect();
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
  const bar = document.querySelector('.progress-bar-bg');
  if (bar) {
    bar.addEventListener('mousedown', handleSeekStart);
    bar.addEventListener('touchstart', handleSeekStart, { passive: false });
  }
});
