const Player = (() => {
  const audio = new Audio();
  audio.preload = 'metadata';

  let queue = [];          // ordered array of song ids for the current play context
  let shuffleOrder = null; // shuffled id order, used when shuffle is on
  let posInQueue = -1;     // index into (shuffleOn ? shuffleOrder : queue)
  let currentSong = null;  // full song record currently loaded
  let repeatMode = 'off';  // 'off' | 'all' | 'one'
  let shuffleOn = false;

  const listeners = { songChange: [], playState: [], time: [], ended: [], volumeChange: [] };
  function emit(evt, payload) { listeners[evt].forEach(fn => fn(payload)); }
  function on(evt, fn) { listeners[evt].push(fn); }

  function applyVolume(percent, muted) {
    const clamped = Math.min(Math.max(percent, 0), 100);
    audio.volume = muted ? 0 : clamped / 100;
  }

  function orderedIds() { return (shuffleOn && shuffleOrder) ? shuffleOrder : queue; }

  function buildShuffleOrder(keepCurrentFirst) {
    const ids = [...queue];
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    if (keepCurrentFirst && currentSong) {
      const idx = ids.indexOf(currentSong.id);
      if (idx > 0) [ids[0], ids[idx]] = [ids[idx], ids[0]];
    }
    shuffleOrder = ids;
  }

  async function resolveSong(id) { return LibraryData.getById(id); }

  async function loadAndPlay(song) {
    if (!song) return;
    currentSong = song;
    audio.src = song.src;
    emit('songChange', song);
    try {
      await audio.play();
    } catch (err) {
      emit('playState', { playing: false, error: 'Unable to play this file.' });
    }
  }

  audio.addEventListener('play', () => emit('playState', { playing: true }));
  audio.addEventListener('pause', () => emit('playState', { playing: false }));
  audio.addEventListener('timeupdate', () => emit('time', { current: audio.currentTime, duration: audio.duration || 0 }));
  audio.addEventListener('error', () => {
    if (audio.error) emit('playState', { playing: false, error: "Your browser can't play this file format." });
  });
  audio.addEventListener('ended', () => { PlayerAPI.next(false); });

  const PlayerAPI = {
    on,
    get audioElement() { return audio; },
    get current() { return currentSong; },
    get isPlaying() { return !audio.paused && !audio.ended; },
    get repeatMode() { return repeatMode; },
    get shuffleOn() { return shuffleOn; },

    /** Set the play context: an ordered list of song records (e.g. "All Songs", a playlist, favorites). */
    setQueue(songs, startId) {
      queue = songs.map(s => s.id);
      if (shuffleOn) buildShuffleOrder(false);
      const startIdx = orderedIds().indexOf(startId ?? queue[0]);
      posInQueue = startIdx === -1 ? 0 : startIdx;
    },

    /** Load and play a specific song record immediately (used for direct row clicks). */
    async playSong(song, songsForQueue) {
      if (songsForQueue) this.setQueue(songsForQueue, song.id);
      else {
        const idx = orderedIds().indexOf(song.id);
        posInQueue = idx === -1 ? posInQueue : idx;
      }
      await loadAndPlay(song);
    },

    async resumeOrPlay(song, songsForQueue) {
      if (currentSong && currentSong.id === song.id) { this.toggle(); return; }
      await this.playSong(song, songsForQueue);
    },

    toggle() {
      if (!currentSong) return;
      if (audio.paused) audio.play().catch(() => {}); else audio.pause();
    },
    pause() { audio.pause(); },

    async next(userInitiated = true) {
      if (!queue.length) return;
      const order = orderedIds();
      if (repeatMode === 'one' && !userInitiated) {
        await loadAndPlay(await resolveSong(order[posInQueue]));
        return;
      }
      let nextPos = posInQueue + 1;
      if (nextPos >= order.length) {
        if (repeatMode === 'all') nextPos = 0;
        else { emit('ended'); return; }
      }
      posInQueue = nextPos;
      await loadAndPlay(await resolveSong(order[posInQueue]));
    },

    async prev() {
      if (!queue.length) return;
      if (audio.currentTime > 3) { audio.currentTime = 0; return; }
      const order = orderedIds();
      let prevPos = posInQueue - 1;
      if (prevPos < 0) prevPos = repeatMode === 'all' ? order.length - 1 : 0;
      posInQueue = prevPos;
      await loadAndPlay(await resolveSong(order[posInQueue]));
    },

    seekTo(seconds) { audio.currentTime = seconds; },

    setShuffle(on) {
      shuffleOn = on;
      if (on) buildShuffleOrder(true);
      posInQueue = orderedIds().indexOf(currentSong ? currentSong.id : queue[0]);
      Prefs.saveSettings({ shuffle: on });
    },

    cycleRepeat() {
      repeatMode = repeatMode === 'off' ? 'all' : repeatMode === 'all' ? 'one' : 'off';
      Prefs.saveSettings({ repeatMode });
      return repeatMode;
    },
    setRepeat(mode) { repeatMode = mode; },

    setVolumePercent(percent, muted) {
      applyVolume(percent, muted);
      emit('volumeChange', { percent, muted });
    },

    // ---- Hover / tap preview: a short (~7s), separate Audio element so it
    // never touches the main playback position. ----
    _previewAudio: null,
    _previewTimer: null,
    playPreview(url, onFail) {
      this.stopPreview();
      const a = new Audio();
      a.volume = 0;
      a.src = url;
      const fadeIn = () => {
        let v = 0;
        const step = setInterval(() => {
          v += 0.08;
          a.volume = Math.min(v, 0.85);
          if (v >= 0.85) clearInterval(step);
        }, 30);
      };
      const playPromise = a.play();
      if (playPromise && playPromise.then) playPromise.then(fadeIn).catch(() => { if (onFail) onFail(); });
      else fadeIn();
      this._previewAudio = a;
      this._previewTimer = setTimeout(() => this.stopPreview(), 8000);
    },
    stopPreview() {
      if (this._previewTimer) { clearTimeout(this._previewTimer); this._previewTimer = null; }
      if (this._previewAudio) {
        const a = this._previewAudio;
        this._previewAudio = null;
        let v = a.volume;
        const step = setInterval(() => {
          v -= 0.15;
          a.volume = Math.max(v, 0);
          if (v <= 0) { clearInterval(step); a.pause(); a.src = ''; }
        }, 25);
      }
    },
  };

  return PlayerAPI;
})();
