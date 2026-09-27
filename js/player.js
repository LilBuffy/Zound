const Player = (() => {
  const audioEls = [new Audio(), new Audio()];
  audioEls.forEach(a => { a.preload = 'metadata'; });
  let activeIdx = 0;
  const activeAudio = () => audioEls[activeIdx];
  const standbyAudio = () => audioEls[1 - activeIdx];

  let audioCtx = null;
  let sourceNodes = [null, null];
  let fadeGains = [null, null];
  let masterGain = null;
  let analyser = null;

  function ensureGraph() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    masterGain.connect(analyser);
    analyser.connect(audioCtx.destination);
    audioEls.forEach((el, i) => {
      sourceNodes[i] = audioCtx.createMediaElementSource(el);
      fadeGains[i] = audioCtx.createGain();
      fadeGains[i].gain.value = i === activeIdx ? 1 : 0;
      sourceNodes[i].connect(fadeGains[i]);
      fadeGains[i].connect(masterGain);
    });
    const boost = Prefs.getSettings().volumeBoost || 100;
    masterGain.gain.value = boost / 100;
  }

  let queue = [];          // ordered array of song ids for the current play context
  let shuffleOrder = null; // shuffled id order, used when shuffle is on
  let posInQueue = -1;     // index into (shuffleOn ? shuffleOrder : queue)
  let currentSong = null;  // full song record currently loaded/playing
  let repeatMode = 'off';  // 'off' | 'all' | 'one'
  let shuffleOn = false;
  let contextLabel = '';   // human label for "Playing from …"
  let crossfading = false;
  let crossfadeRaf = null;

  const listeners = { songChange: [], playState: [], time: [], ended: [], volumeChange: [], queueChange: [] };
  function emit(evt, payload) { (listeners[evt] || []).forEach(fn => fn(payload)); }
  function on(evt, fn) { (listeners[evt] || (listeners[evt] = [])).push(fn); }

  function applyVolume(percent, muted) {
    const clamped = Math.min(Math.max(percent, 0), 100);
    audioEls.forEach(a => { a.volume = muted ? 0 : clamped / 100; });
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

  /** What would play next, without mutating any state. Checks the manual
   *  "up next" queue first, then falls through to the playback context. */
  function peekNext(userInitiated) {
    if (Queue.length) return { fromQueue: true, id: Queue.items[0] };
    const order = orderedIds();
    if (!order.length) return null;
    if (repeatMode === 'one' && !userInitiated) return { fromQueue: false, id: order[posInQueue], index: posInQueue };
    let nextPos = posInQueue + 1;
    if (nextPos >= order.length) {
      if (repeatMode === 'all') nextPos = 0;
      else return null;
    }
    return { fromQueue: false, id: order[nextPos], index: nextPos };
  }
  function commitAdvance(peeked) {
    if (!peeked) return;
    if (peeked.fromQueue) Queue.shift();
    else posInQueue = peeked.index;
  }

  async function loadAndPlay(song, { viaCrossfade = false } = {}) {
    if (!song) return;
    ensureGraph();
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    currentSong = song;
    const audio = activeAudio();
    if (!viaCrossfade) {
      audio.src = song.src;
    }
    emit('songChange', song);
    try {
      await audio.play();
    } catch (err) {
      emit('playState', { playing: false, error: 'Unable to play this file.' });
    }
  }

  function stopCrossfadeAnimation() {
    if (crossfadeRaf) { cancelAnimationFrame(crossfadeRaf); crossfadeRaf = null; }
  }

  /** Overlap the tail of the active track with the head of the next one. */
  async function startCrossfade(peeked) {
    const nextSong = await resolveSong(peeked.id);
    if (!nextSong || crossfading) return;
    crossfading = true;
    ensureGraph();
    const fromIdx = activeIdx, toIdx = 1 - activeIdx;
    const toAudio = audioEls[toIdx];
    toAudio.src = nextSong.src;
    toAudio.currentTime = 0;
    fadeGains[toIdx].gain.value = 0;
    try { await toAudio.play(); } catch { crossfading = false; return; }

    const seconds = Math.max(1, Prefs.getSettings().crossfadeSec || 4);
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / (seconds * 1000));
      fadeGains[fromIdx].gain.value = 1 - t;
      fadeGains[toIdx].gain.value = t;
      if (t < 1) {
        crossfadeRaf = requestAnimationFrame(step);
      } else {
        audioEls[fromIdx].pause();
        activeIdx = toIdx;
        commitAdvance(peeked);
        currentSong = nextSong;
        crossfading = false;
        emit('songChange', nextSong);
      }
    };
    crossfadeRaf = requestAnimationFrame(step);
  }

  function wireAudioEvents(audio) {
    audio.addEventListener('play', () => { if (audio === activeAudio()) emit('playState', { playing: true }); });
    audio.addEventListener('pause', () => { if (audio === activeAudio() && !crossfading) emit('playState', { playing: false }); });
    audio.addEventListener('timeupdate', () => {
      if (audio !== activeAudio()) return;
      emit('time', { current: audio.currentTime, duration: audio.duration || 0 });
      const settings = Prefs.getSettings();
      const cfSec = settings.crossfadeSec || 0;
      if (cfSec > 0 && !crossfading && audio.duration && (audio.duration - audio.currentTime) <= cfSec && (audio.duration - audio.currentTime) > 0.15) {
        const peeked = peekNext(false);
        if (peeked) startCrossfade(peeked);
      }
    });
    audio.addEventListener('error', () => {
      if (audio === activeAudio() && audio.error) emit('playState', { playing: false, error: "Your browser can't play this file format." });
    });
    audio.addEventListener('ended', () => {
      if (audio !== activeAudio() || crossfading) return;
      if (Prefs.getSettings().autoplay === false) { emit('playState', { playing: false }); return; }
      PlayerAPI.next(false);
    });
  }
  audioEls.forEach(wireAudioEvents);

  const PlayerAPI = {
    on,
    get audioElement() { return activeAudio(); },
    get current() { return currentSong; },
    get isPlaying() { return !activeAudio().paused && !activeAudio().ended; },
    get repeatMode() { return repeatMode; },
    get shuffleOn() { return shuffleOn; },
    get contextLabel() { return contextLabel; },
    get isCrossfading() { return crossfading; },

    getAnalyser() { ensureGraph(); return analyser; },
    resumeAudioContext() { ensureGraph(); if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {}); },

    /** Everything that will play after the current song: the manual queue
     *  first, then the rest of the current context. Used by the Queue panel
     *  and the full Now Playing view. */
    upcoming() {
      const manual = Queue.songs();
      const order = orderedIds();
      const rest = posInQueue >= 0 ? order.slice(posInQueue + 1).map(id => LibraryData.getById(id)).filter(Boolean) : [];
      return { manual, contextRest: rest, contextLabel };
    },

    /** Set the play context: an ordered list of song records (e.g. "All Songs", a playlist, favorites). */
    setQueue(songs, startId, label = '') {
      queue = songs.map(s => s.id);
      contextLabel = label;
      if (shuffleOn) buildShuffleOrder(false);
      const startIdx = orderedIds().indexOf(startId ?? queue[0]);
      posInQueue = startIdx === -1 ? 0 : startIdx;
    },

    async playSong(song, songsForQueue, label) {
      if (songsForQueue) this.setQueue(songsForQueue, song.id, label);
      else {
        const idx = orderedIds().indexOf(song.id);
        posInQueue = idx === -1 ? posInQueue : idx;
      }
      await loadAndPlay(song);
    },

    async resumeOrPlay(song, songsForQueue, label) {
      if (currentSong && currentSong.id === song.id) { this.toggle(); return; }
      await this.playSong(song, songsForQueue, label);
    },

    toggle() {
      ensureGraph();
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
      if (!currentSong) return;
      const audio = activeAudio();
      if (audio.paused) audio.play().catch(() => {}); else audio.pause();
    },
    pause() { activeAudio().pause(); },

    async next(userInitiated = true) {
      stopCrossfadeAnimation();
      if (crossfading) {
        // A manual skip during an in-flight crossfade: just snap to the
        // target track that was already fading in.
        const toIdx = 1 - activeIdx;
        audioEls[activeIdx].pause();
        activeIdx = toIdx;
        fadeGains[toIdx].gain.value = 1;
        crossfading = false;
      }
      const peeked = peekNext(userInitiated);
      if (!peeked) { emit('ended'); return; }
      commitAdvance(peeked);
      await loadAndPlay(await resolveSong(peeked.id));
    },

    async prev() {
      if (!queue.length) return;
      if (activeAudio().currentTime > 3) { activeAudio().currentTime = 0; return; }
      const order = orderedIds();
      let prevPos = posInQueue - 1;
      if (prevPos < 0) prevPos = repeatMode === 'all' ? order.length - 1 : 0;
      posInQueue = prevPos;
      await loadAndPlay(await resolveSong(order[posInQueue]));
    },

    seekTo(seconds) { activeAudio().currentTime = seconds; },

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
    setVolumeBoost(percent) {
      ensureGraph();
      masterGain.gain.value = Math.max(1, percent) / 100;
    },

    /** Immediately play a song ahead of everything else, replacing what
     *  "Play Next" would have queued (used by the queue panel's drag/drop
     *  and by direct "Play" actions from menus). */
    playImmediately(song) { return this.resumeOrPlay(song, null); },

    // ---- Hover / tap preview: a short, separate Audio element so it never
    // touches the main playback position or the Web Audio graph. ----
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
