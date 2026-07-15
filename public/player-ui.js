/**
 * Кастомный overlay-UI для hls.js плеера в стиле video.js
 * Работает поверх существующего hls.js из app.js
 * Предоставляет: play/pause, прогресс-бар, громкость, время, качество, PiP, fullscreen
 */

// ========== Элементы ==========
const video = document.getElementById('player');
const shell = video?.closest('.player-shell') || video?.parentElement;

const UI = {
  controls: null,
  playBtn: null,
  progressBar: null,
  progressFill: null,
  progressHandle: null,
  bufferFill: null,
  currentTime: null,
  duration: null,
  volumeBtn: null,
  volumeBar: null,
  volumeFill: null,
  skipBackBtn: null,
  skipForwardBtn: null,
  settingsBtn: null,
  fullscreenBtn: null,
  centerSpinner: null,
  centerOverlay: null,
  settingsPanel: document.getElementById('playerSettingsPanel'),
  qualityIndicator: document.getElementById('qualityIndicator'),
  qiRequested: document.getElementById('qiRequested'),
  qiActive: document.getElementById('qiActive')
};

let _isDragging = false;
let _pendingSeekTime = null;
let _isVolumeDragging = false;
let _menuOpen = false;

// Для временных значков play/pause
let _actionIconTimer = null;

// ========== Создание контролов ==========
function createControls() {
  if (UI.controls || !shell || !video) return;

  const div = document.createElement('div');
  div.className = 'custom-player-controls';
  div.innerHTML = `
    <div class="controls-left">
      <button class="ctrl-btn play-btn" title="Play/Pause">
        <svg viewBox="0 0 24 24" width="20" height="20"><polygon points="6,4 20,12 6,20" fill="currentColor"/></svg>
      </button>
      <button class="ctrl-btn skip-btn skip-back-btn" title="Back 10 seconds"><span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8a8 8 0 1 1-1 7M5 4v4h4"/></svg></span></button>
      <button class="ctrl-btn skip-btn skip-forward-btn" title="Forward 10 seconds"><span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 8a8 8 0 1 0 1 7M19 4v4h-4"/></svg></span></button>
      <div class="volume-container">
        <button class="ctrl-btn volume-btn" title="Mute">
          <svg viewBox="0 0 24 24" width="20" height="20">
            <path d="M11 5L6 9H2v6h4l5 4V5z" fill="currentColor"/>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" stroke="currentColor" stroke-width="2" fill="none"/>
          </svg>
        </button>
        <div class="volume-bar"><div class="volume-fill"></div></div>
      </div>
      <div class="time-display">
        <span class="current-time">00:00</span>
        <span class="time-sep">/</span>
        <span class="duration">00:00</span>
      </div>
    </div>
    <div class="controls-center">
      <div class="progress-container">
        <div class="progress-bar">
          <div class="buffer-fill"></div>
          <div class="progress-fill"></div>
          <div class="progress-handle"></div>
        </div>
      </div>
    </div>
    <div class="controls-right">
      <button class="ctrl-btn cc-btn" title="Closed captions"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="4" width="19" height="16" rx="2"/><text x="12" y="15.2" text-anchor="middle">CC</text></svg></button>
      <button class="ctrl-btn settings-btn" title="Settings">
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" fill="none" stroke="currentColor" stroke-width="2"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" fill="none" stroke="currentColor" stroke-width="2"/>
        </svg>
      </button>
      <button class="ctrl-btn fullscreen-btn" title="Fullscreen">
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" fill="none" stroke="currentColor" stroke-width="2"/>
        </svg>
      </button>
    </div>
  `;
  shell.appendChild(div);
  UI.controls = div;

  UI.playBtn = div.querySelector('.play-btn');
  UI.progressBar = div.querySelector('.progress-bar');
  UI.progressFill = div.querySelector('.progress-fill');
  UI.progressHandle = div.querySelector('.progress-handle');
  UI.bufferFill = div.querySelector('.buffer-fill');
  UI.currentTime = div.querySelector('.current-time');
  UI.duration = div.querySelector('.duration');
  UI.volumeBtn = div.querySelector('.volume-btn');
  UI.volumeBar = div.querySelector('.volume-bar');
  UI.volumeFill = div.querySelector('.volume-fill');
  UI.skipBackBtn = div.querySelector('.skip-back-btn');
  UI.skipForwardBtn = div.querySelector('.skip-forward-btn');
  UI.settingsBtn = div.querySelector('.settings-btn');
  UI.fullscreenBtn = div.querySelector('.fullscreen-btn');

  // Создаём спиннер загрузки по центру
  const spinner = document.createElement('div');
  spinner.className = 'player-center-spinner';
  spinner.innerHTML = `<svg viewBox="0 0 50 50" width="40" height="40"><circle cx="25" cy="25" r="20" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="4" stroke-dasharray="100" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 25 25" to="360 25 25" dur="1s" repeatCount="indefinite"/></circle></svg>`;
  shell.appendChild(spinner);
  UI.centerSpinner = spinner;

  // Создаём центральный overlay для временных значков
  const overlay = document.createElement('div');
  overlay.className = 'player-center-overlay';
  overlay.innerHTML = `<div class="center-icon"></div>`;
  shell.appendChild(overlay);
  UI.centerOverlay = overlay;

  bindEvents();
}

// ========== События ==========
function bindEvents() {
  if (!video) return;

  // Play/Pause
  UI.playBtn.addEventListener('click', () => {
    if (video.paused) {
      video.play().catch(() => {});
      showCenterIcon('play');
    } else {
      video.pause();
      showCenterIcon('pause');
    }
  });

  // Нажатие на сам video центральной области для play/pause
  video.addEventListener('click', () => {
    if (video.paused) {
      video.play().catch(() => {});
      showCenterIcon('play');
    } else {
      video.pause();
      showCenterIcon('pause');
    }
  });

  // Progress bar drag
  UI.progressBar.addEventListener('mousedown', (e) => {
    e.preventDefault();
    _isDragging = true;
    updateSeekPreview(e);
    document.addEventListener('mousemove', onDrag);
    document.addEventListener('mouseup', onEnd);
  });
  function onDrag(e) {
    if (!_isDragging) return;
    updateSeekPreview(e);
    UI.progressBar.classList.add('seeking');
  }
  function onEnd(e) {
    if (!_isDragging) return;
    updateSeekPreview(e);
    _isDragging = false;
    UI.progressBar.classList.remove('seeking');
    document.removeEventListener('mousemove', onDrag);
    document.removeEventListener('mouseup', onEnd);
    if (Number.isFinite(_pendingSeekTime)) {
      video.currentTime = _pendingSeekTime;
    }
    _pendingSeekTime = null;
  }
  function updateSeekPreview(e) {
    const rect = UI.progressBar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setProgressVisual(pct);
    _pendingSeekTime = Number.isFinite(video.duration) ? pct * video.duration : null;
  }

  // Volume
  UI.volumeBar.addEventListener('mousedown', (e) => {
    _isVolumeDragging = true;
    volFromMouse(e);
    document.addEventListener('mousemove', onVolDrag);
    document.addEventListener('mouseup', onVolEnd);
  });
  function onVolDrag(e) { if (_isVolumeDragging) volFromMouse(e); }
  function onVolEnd() { _isVolumeDragging = false; document.removeEventListener('mousemove', onVolDrag); document.removeEventListener('mouseup', onVolEnd); }
  function volFromMouse(e) {
    const rect = UI.volumeBar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    video.volume = pct;
    video.muted = pct === 0;
  }
  UI.volumeBtn.addEventListener('click', () => {
    video.muted = !video.muted;
    updateVolumeIcon();
  });

  UI.skipBackBtn.addEventListener('click', () => {
    video.currentTime = Math.max(0, (video.currentTime || 0) - 10);
  });
  UI.skipForwardBtn.addEventListener('click', () => {
    const duration = Number.isFinite(video.duration) ? video.duration : Infinity;
    video.currentTime = Math.min(duration, (video.currentTime || 0) + 10);
  });

  // Settings
  UI.settingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (window.toggleSettingsPanel) {
      window.toggleSettingsPanel();
    }
  });

  // Fullscreen
  UI.fullscreenBtn.addEventListener('click', () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      shell.requestFullscreen().catch(() => {
        video.requestFullscreen().catch(() => {});
      });
    }
  });

  // Video events
  video.addEventListener('timeupdate', updateTime);
  video.addEventListener('loadedmetadata', () => {
    updateTime();
    // Сбрасываем прогресс-бар и время при загрузке нового видео
    setProgressVisual(0);
    if (UI.currentTime) UI.currentTime.textContent = '00:00';
  });
  video.addEventListener('durationchange', () => {
    updateTime();
    // При смене длительности (новый источник) сбрасываем прогресс
    setProgressVisual(0);
  });
  video.addEventListener('timeupdate', updateProgress);
  video.addEventListener('progress', updateBuffer);
  video.addEventListener('volumechange', () => { updateVolume(); updateVolumeIcon(); });
  video.addEventListener('play', updatePlayBtn);
  video.addEventListener('pause', updatePlayBtn);

  // Spinner: show when waiting, hide when playing
  video.addEventListener('waiting', () => {
    if (UI.centerSpinner) UI.centerSpinner.classList.add('visible');
  });
  video.addEventListener('canplay', () => {
    if (UI.centerSpinner) UI.centerSpinner.classList.remove('visible');
  });
  video.addEventListener('playing', () => {
    if (UI.centerSpinner) UI.centerSpinner.classList.remove('visible');
  });

  // Fullscreen change
  document.addEventListener('fullscreenchange', onFullscreenChange);

  // Закрытие панели настроек при клике вне
  document.addEventListener('click', (e) => {
    if (_menuOpen && !e.target.closest('.quality-menu-overlay') && !e.target.closest('.settings-btn')) {
      closeMenu();
    }
    const panel = document.getElementById('playerSettingsPanel');
    if (panel && panel.classList.contains('is-open') &&
        !e.target.closest('.player-settings-panel') && !e.target.closest('.settings-btn')) {
      panel.classList.remove('is-open');
    }
  });
}

// ========== Временный значок по центру ==========
function showCenterIcon(type) {
  if (!UI.centerOverlay) return;
  const iconEl = UI.centerOverlay.querySelector('.center-icon');
  if (!iconEl) return;

  if (type === 'play') {
    iconEl.innerHTML = '<svg viewBox="0 0 24 24" width="48" height="48"><polygon points="6,3 22,12 6,21" fill="rgba(255,255,255,0.85)"/></svg>';
  } else {
    iconEl.innerHTML = '<svg viewBox="0 0 24 24" width="48" height="48"><rect x="6" y="4" width="4" height="16" fill="rgba(255,255,255,0.85)"/><rect x="14" y="4" width="4" height="16" fill="rgba(255,255,255,0.85)"/></svg>';
  }

  UI.centerOverlay.classList.add('visible');

  if (_actionIconTimer) clearTimeout(_actionIconTimer);
  _actionIconTimer = setTimeout(() => {
    UI.centerOverlay.classList.remove('visible');
    _actionIconTimer = null;
  }, 500);
}

// ========== Обновление fill/handle вручную (без timeupdate) ==========
function setProgressVisual(pct) {
  if (!UI.progressFill || !UI.progressHandle) return;
  const wpct = Math.min(100, pct * 100);
  UI.progressFill.style.width = `${wpct}%`;
  UI.progressHandle.style.left = `${wpct}%`;
}

// ========== Обновление UI ==========
function updateTime() {
  if (!video) return;
  const cur = fmt(video.currentTime || 0);
  const dur = fmt(video.duration || 0);
  if (UI.currentTime) UI.currentTime.textContent = cur;
  if (UI.duration) UI.duration.textContent = dur;
}

function updateProgress() {
  if (_isDragging || !video || !video.duration || !UI.progressFill || !UI.progressHandle) return;
  const pct = Math.min(100, (video.currentTime / video.duration) * 100);
  UI.progressFill.style.width = `${pct}%`;
  UI.progressHandle.style.left = `${pct}%`;
}

function updateBuffer() {
  if (!video || !video.duration || !UI.bufferFill) return;
  // bufferFill: показываем буферизированную часть (от 0 до buffered.end)
  try {
    const b = video.buffered;
    if (b.length > 0) {
      const end = b.end(b.length - 1);
      const pct = Math.min(100, (end / video.duration) * 100);
      UI.bufferFill.style.width = `${pct}%`;
    }
  } catch(e) {}
}

function updateVolume() {
  if (!UI.volumeFill) return;
  UI.volumeFill.style.width = `${video.muted ? 0 : video.volume * 100}%`;
}

function updateVolumeIcon() {
  if (!UI.volumeBtn) return;
  const isMuted = video.muted || video.volume === 0;
  UI.volumeBtn.innerHTML = isMuted
    ? '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M11 5L6 9H2v6h4l5 4V5z" fill="currentColor"/><line x1="23" y1="9" x2="17" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="17" y1="9" x2="23" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
    : '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M11 5L6 9H2v6h4l5 4V5z" fill="currentColor"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" stroke="currentColor" stroke-width="2" fill="none"/></svg>';
}

function updatePlayBtn() {
  if (!UI.playBtn) return;
  UI.playBtn.innerHTML = video.paused
    ? '<svg viewBox="0 0 24 24" width="20" height="20"><polygon points="6,4 20,12 6,20" fill="currentColor"/></svg>'
    : '<svg viewBox="0 0 24 24" width="20" height="20"><rect x="6" y="4" width="4" height="16" fill="currentColor"/><rect x="14" y="4" width="4" height="16" fill="currentColor"/></svg>';
}

// Экспорт функции для app.js для принудительного обновления при загрузке нового источника
window.__updatePlayButton = updatePlayBtn;

// Восстановление позиции при смене качества — обрабатывается в app.js
// через _qualityChangePendingTime и restoreQualitySeek

function onFullscreenChange() {
  if (!shell) return;
  shell.classList.toggle('is-fullscreen', !!document.fullscreenElement);
  updateTime();
}

function fmt(s) {
  if (!Number.isFinite(s) || s < 0) return '00:00';
  const sec = Math.floor(s);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const ss = String(sec % 60).padStart(2, '0');
  if (h > 0) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${ss}`;
  return `${String(m).padStart(2, '0')}:${ss}`;
}

// Панель настроек (Speed, Quality, PiP) — используется встроенная #playerSettingsPanel из HTML
// Логика открытия/закрытия и навигации — в app.js (toggleSettingsPanel, showMainMenu и т.д.)

// ========== Инициализация ==========
let _initDone = false;
function initOnce() {
  if (_initDone) return;
  _initDone = true;
  setTimeout(createControls, 100);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initOnce);
} else {
  initOnce();
}
