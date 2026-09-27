const Store = (() => {
  const DB_NAME = 'zound-db';
  const DB_VERSION = 1;
  const STORE = 'songs';
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function tx(mode) {
    const db = await open();
    const t = db.transaction(STORE, mode);
    return { t, store: t.objectStore(STORE) };
  }

  return {
    /** Persist one imported song record: { id, title, artist, album, duration, dateAdded, fileBlob, pictureBlob, filename } */
    async put(record) {
      const { t, store } = await tx('readwrite');
      store.put(record);
      return new Promise((res, rej) => { t.oncomplete = () => res(true); t.onerror = () => rej(t.error); });
    },
    async getAll() {
      const { store } = await tx('readonly');
      return new Promise((res, rej) => {
        const req = store.getAll();
        req.onsuccess = () => res(req.result || []);
        req.onerror = () => rej(req.error);
      });
    },
    async get(id) {
      const { store } = await tx('readonly');
      return new Promise((res, rej) => {
        const req = store.get(id);
        req.onsuccess = () => res(req.result || null);
        req.onerror = () => rej(req.error);
      });
    },
    async delete(id) {
      const { t, store } = await tx('readwrite');
      store.delete(id);
      return new Promise((res, rej) => { t.oncomplete = () => res(true); t.onerror = () => rej(t.error); });
    },
    async clear() {
      const { t, store } = await tx('readwrite');
      store.clear();
      return new Promise((res, rej) => { t.oncomplete = () => res(true); t.onerror = () => rej(t.error); });
    },
    /** Rough estimate of bytes used, for the Settings > Storage panel. */
    async estimateUsage() {
      if (navigator.storage && navigator.storage.estimate) {
        try { return await navigator.storage.estimate(); } catch { /* fall through */ }
      }
      return null;
    },
  };
})();

const Prefs = (() => {
  const KEYS = {
    settings: 'zound_settings',
    favorites: 'zound_favorites',
    playlists: 'zound_playlists',
    recent: 'zound_recent',
    queue: 'zound_queue',
  };
  const DEFAULT_SETTINGS = {
    // Playback
    volume: 100,          // 0–100, base volume before boost
    shuffle: false,
    repeatMode: 'off',    // 'off' | 'all' | 'one'
    muted: false,
    autoplay: true,       // continue to the next track automatically
    crossfadeSec: 0,      // 0 = off, 1–12 seconds
    // Audio
    volumeBoost: 100,     // 100–300%, applied post-fader via a gain node
    previewEnabled: true,
    // Appearance
    theme: 'dark',        // reserved — Zound ships one cohesive dark theme
    animationsEnabled: true,
    // Visualizer
    visualizerEnabled: true,
    visualizerStyle: 'bars', // 'bars' | 'wave' | 'radial'
    // Library / layout
    sidebarCollapsed: false,
    libraryView: 'list',  // 'list' | 'grid' for All Songs
  };
  const RECENT_LIMIT = 80;

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { console.warn('Storage write failed', e); }
  }

  return {
    getSettings() { return { ...DEFAULT_SETTINGS, ...read(KEYS.settings, {}) }; },
    saveSettings(patch) { const s = { ...this.getSettings(), ...patch }; write(KEYS.settings, s); return s; },

    getFavorites() { return read(KEYS.favorites, []); },
    isFavorite(id) { return this.getFavorites().includes(id); },
    toggleFavorite(id) {
      const favs = this.getFavorites();
      const idx = favs.indexOf(id);
      if (idx === -1) favs.push(id); else favs.splice(idx, 1);
      write(KEYS.favorites, favs);
      return idx === -1; // true if now favorited
    },

    getPlaylists() { return read(KEYS.playlists, []); },
    savePlaylists(list) { write(KEYS.playlists, list); },
    createPlaylist(name) {
      const list = this.getPlaylists();
      const playlist = { id: 'pl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: (name || '').trim() || 'Untitled', songIds: [], dateCreated: Date.now() };
      list.push(playlist);
      this.savePlaylists(list);
      return playlist;
    },
    deletePlaylist(id) { this.savePlaylists(this.getPlaylists().filter(p => p.id !== id)); },
    renamePlaylist(id, name) {
      const list = this.getPlaylists();
      const p = list.find(p => p.id === id);
      if (p) { p.name = name.trim() || p.name; this.savePlaylists(list); }
    },
    addToPlaylist(playlistId, songId) {
      const list = this.getPlaylists();
      const p = list.find(p => p.id === playlistId);
      if (p && !p.songIds.includes(songId)) { p.songIds.push(songId); this.savePlaylists(list); return true; }
      return false;
    },
    removeFromPlaylist(playlistId, songId) {
      const list = this.getPlaylists();
      const p = list.find(p => p.id === playlistId);
      if (p) { p.songIds = p.songIds.filter(id => id !== songId); this.savePlaylists(list); }
    },
    reorderPlaylist(playlistId, songIds) {
      const list = this.getPlaylists();
      const p = list.find(p => p.id === playlistId);
      if (p) { p.songIds = songIds.slice(); this.savePlaylists(list); }
    },

    getRecent() { return read(KEYS.recent, []); },
    pushRecent(songId) {
      let list = this.getRecent().filter(r => r.id !== songId);
      list.unshift({ id: songId, playedAt: Date.now() });
      if (list.length > RECENT_LIMIT) list = list.slice(0, RECENT_LIMIT);
      write(KEYS.recent, list);
    },
    clearRecent() { write(KEYS.recent, []); },

    /** Manual "up next" queue — persisted so a reload doesn't lose it. */
    getQueue() { return read(KEYS.queue, []); },
    saveQueue(ids) { write(KEYS.queue, ids); },

    /** Cascade cleanup after song(s) are deleted from the library: strips
     *  those ids out of favorites, recently-played history, the saved
     *  queue, and every playlist, so nothing references a dead id. */
    purgeSongIds(ids) {
      const idSet = new Set(ids);
      write(KEYS.favorites, this.getFavorites().filter(id => !idSet.has(id)));
      write(KEYS.recent, this.getRecent().filter(r => !idSet.has(r.id)));
      write(KEYS.queue, this.getQueue().filter(id => !idSet.has(id)));
      const playlists = this.getPlaylists();
      playlists.forEach(p => { p.songIds = p.songIds.filter(id => !idSet.has(id)); });
      this.savePlaylists(playlists);
    },

    resetAll() {
      Object.values(KEYS).forEach(k => localStorage.removeItem(k));
    },

    /** Everything that's safe & meaningful to export as JSON: playlists,
     *  favorites, recent history, settings, and per-song metadata for
     *  imported tracks (not the audio files themselves — those never
     *  leave the browser). */
    exportData(librarySongs) {
      const metadata = (librarySongs || [])
        .filter(s => !s.isBundled)
        .map(s => ({ id: s.id, title: s.title, artist: s.artist, album: s.album, duration: s.duration, dateAdded: s.dateAdded, filename: s.filename }));
      return {
        app: 'Zound',
        version: 2,
        exportedAt: Date.now(),
        settings: this.getSettings(),
        favorites: this.getFavorites(),
        playlists: this.getPlaylists(),
        recent: this.getRecent(),
        libraryMetadata: metadata,
      };
    },

    /** Merge an exported bundle back in. Only references library metadata
     *  for songs that are actually present (by id) — it can't restore
     *  audio files that aren't already imported. */
    importData(data, presentIds) {
      if (!data || typeof data !== 'object') throw new Error('Invalid file');
      const idSet = new Set(presentIds || []);
      if (data.settings) this.saveSettings(data.settings);
      if (Array.isArray(data.favorites)) write(KEYS.favorites, data.favorites.filter(id => idSet.has(id)));
      if (Array.isArray(data.recent)) write(KEYS.recent, data.recent.filter(r => idSet.has(r.id)));
      if (Array.isArray(data.playlists)) {
        const cleaned = data.playlists.map(p => ({
          id: p.id || ('pl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
          name: p.name || 'Untitled',
          songIds: (p.songIds || []).filter(id => idSet.has(id)),
          dateCreated: p.dateCreated || Date.now(),
        }));
        write(KEYS.playlists, cleaned);
      }
      return true;
    },
  };
})();
