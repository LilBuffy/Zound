const Store = (() => {
  const DB_NAME = 'mono-music-db';
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
    /** Persist one imported song record: { id, title, artist, album, duration, dateAdded, fileBlob, pictureBlob, pictureMime, filename } */
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
  };
})();

const Prefs = (() => {
  const KEYS = {
    settings: 'mono_settings',
    favorites: 'mono_favorites',
    playlists: 'mono_playlists',
    recent: 'mono_recent',
  };
  const DEFAULT_SETTINGS = {
    volume: 100,       // 0–100, applied directly via audio.volume
    shuffle: false,
    repeatMode: 'off',  // 'off' | 'all' | 'one'
    previewEnabled: true,
    muted: false,
    sidebarCollapsed: true,
  };
  const RECENT_LIMIT = 60;

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
      const playlist = { id: 'pl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: name.trim() || 'Untitled', songIds: [], dateCreated: Date.now() };
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

    getRecent() { return read(KEYS.recent, []); },
    pushRecent(songId) {
      let list = this.getRecent().filter(r => r.id !== songId);
      list.unshift({ id: songId, playedAt: Date.now() });
      if (list.length > RECENT_LIMIT) list = list.slice(0, RECENT_LIMIT);
      write(KEYS.recent, list);
    },
    clearRecent() { write(KEYS.recent, []); },

    /** Cascade cleanup after song(s) are deleted from the library: strips
     *  those ids out of favorites, recently-played history, and every
     *  playlist, so nothing references a song that no longer exists. */
    purgeSongIds(ids) {
      const idSet = new Set(ids);
      write(KEYS.favorites, this.getFavorites().filter(id => !idSet.has(id)));
      write(KEYS.recent, this.getRecent().filter(r => !idSet.has(r.id)));
      const playlists = this.getPlaylists();
      playlists.forEach(p => { p.songIds = p.songIds.filter(id => !idSet.has(id)); });
      this.savePlaylists(playlists);
    },

    resetAll() {
      Object.values(KEYS).forEach(k => localStorage.removeItem(k));
    },
  };
})();
