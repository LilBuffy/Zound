const MUSIC_LIBRARY = [

  {
    title: "Sleep Tonight", artist: "The Birthday Massacre", album: "Pathways (2025)", src: "music/Sleep_Tonight.mp3"
  },
  {
    title: "Sleepwalking", artist: "The Birthday Massacre", album: "Pins and Needles (2010)", src: "music/Sleepwalking.mp3"
  },
  {
    title: "Pins and Needles", artist: "The Birthday Massacre", album: "Pins and Needles (2010)", src: "music/Pins_and_Needles.mp3"
  },
  {
    title: "Red Stars", artist: "The Birthday Massacre", album: "Walking With Strangers (2007)", src: "music/Red_Stars.mp3"
  },
  {
    title: "In The Dark", artist: "The Birthday Massacre", album: "Pins and Needles (2010)", src: "music/In_The_Dark.mp3"
  }

];

function formatDuration(totalSeconds) {
  if (!isFinite(totalSeconds) || totalSeconds < 0) return '--:--';
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function titleFromFilename(filename) {
  return filename.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Untitled';
}

function probeDuration(url) {
  return new Promise((resolve) => {
    const a = new Audio();
    const done = (val) => { a.src = ''; resolve(val); };
    a.addEventListener('loadedmetadata', () => done(a.duration || 0));
    a.addEventListener('error', () => done(0));
    setTimeout(() => done(a.duration || 0), 4000); // don't hang forever on odd files
    a.src = url;
  });
}

const LibraryData = (() => {
  let songs = []; // in-memory, always mirrors bundled config + IndexedDB
  let ready = null;

  function toBundledSong(cfg, i) {
    return {
      id: 'bundle_' + i,
      title: cfg.title || titleFromFilename(cfg.src),
      artist: cfg.artist || 'Unknown Artist',
      album: cfg.album || 'Unknown Album',
      duration: cfg.duration || 0,
      dateAdded: 0,
      src: cfg.src,
      artworkUrl: cfg.artwork || null,
      isBundled: true,
      filename: cfg.src.split('/').pop(),
    };
  }

  function toImportedSong(record) {
    return {
      id: record.id,
      title: record.title || titleFromFilename(record.filename),
      artist: record.artist || 'Unknown Artist',
      album: record.album || 'Unknown Album',
      duration: record.duration || 0,
      dateAdded: record.dateAdded || Date.now(),
      src: URL.createObjectURL(record.fileBlob),
      artworkUrl: record.pictureBlob ? URL.createObjectURL(record.pictureBlob) : null,
      isBundled: false,
      filename: record.filename,
    };
  }

  async function init() {
    if (ready) return ready;
    ready = (async () => {
      const bundled = MUSIC_LIBRARY.map(toBundledSong);
      let imported = [];
      try {
        const records = await Store.getAll();
        imported = records.map(toImportedSong);
      } catch (e) {
        console.warn('Could not load imported music from IndexedDB', e);
      }
      // probe durations for bundled tracks that didn't declare one
      await Promise.all(bundled.filter(s => !s.duration).map(async s => { s.duration = await probeDuration(s.src); }));
      songs = [...bundled, ...imported];
    })();
    return ready;
  }

  const SUPPORTED_TYPES = /audio\/(mpeg|mp4|m4a|x-m4a|wav|wave|x-wav|ogg|aac|flac|webm)/i;

  async function addFiles(fileList) {
    const results = { added: [], failed: [] };
    for (const file of Array.from(fileList)) {
      try {
        if (file.type && !SUPPORTED_TYPES.test(file.type) && !/\.(mp3|m4a|wav|ogg|aac|flac)$/i.test(file.name)) {
          results.failed.push({ file, reason: "Your browser can't play this file format." });
          continue;
        }
        const id = 'song_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        const objectUrl = URL.createObjectURL(file);
        const [tags, duration] = await Promise.all([ID3.parse(file), probeDuration(objectUrl)]);

        if (!duration) {
          // The browser genuinely couldn't decode it — don't add a dead entry.
          URL.revokeObjectURL(objectUrl);
          results.failed.push({ file, reason: "Your browser can't play this file format." });
          continue;
        }

        const record = {
          id,
          title: (tags && tags.title) || titleFromFilename(file.name),
          artist: (tags && tags.artist) || 'Unknown Artist',
          album: (tags && tags.album) || 'Unknown Album',
          duration,
          dateAdded: Date.now(),
          fileBlob: file,
          pictureBlob: (tags && tags.picture) ? tags.picture.blob : null,
          filename: file.name,
        };
        await Store.put(record);
        const song = toImportedSong(record);
        songs.push(song);
        results.added.push(song);
      } catch (e) {
        console.error(e);
        results.failed.push({ file, reason: 'Unable to import this file.' });
      }
    }
    return results;
  }

  function revokeUrls(song) {
    if (song.src && song.src.startsWith('blob:')) URL.revokeObjectURL(song.src);
    if (song.artworkUrl && song.artworkUrl.startsWith('blob:')) URL.revokeObjectURL(song.artworkUrl);
  }

  async function removeImported(id) {
    const song = songs.find(s => s.id === id);
    if (song) revokeUrls(song);
    songs = songs.filter(s => s.id !== id);
    await Store.delete(id);
  }

  async function clearImported() {
    songs.filter(s => !s.isBundled).forEach(revokeUrls);
    songs = songs.filter(s => s.isBundled);
    await Store.clear();
  }

  return {
    init,
    getAll: () => songs.slice(),
    getById: (id) => songs.find(s => s.id === id) || null,
    addFiles,
    removeImported,
    clearImported,

    getFavorites() { const favs = Prefs.getFavorites(); return songs.filter(s => favs.includes(s.id)); },
    getRecentlyAdded(limit = 12) { return songs.slice().sort((a, b) => b.dateAdded - a.dateAdded).slice(0, limit); },
    getRecentlyPlayed() {
      const recent = Prefs.getRecent();
      return recent.map(r => this.getById(r.id)).filter(Boolean);
    },
    search(query) {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      return songs.filter(s =>
        s.title.toLowerCase().includes(q) ||
        s.artist.toLowerCase().includes(q) ||
        s.album.toLowerCase().includes(q));
    },
    sort(list, key, dir) {
      const sorted = [...list].sort((a, b) => {
        let av = a[key], bv = b[key];
        if (typeof av === 'string') { av = av.toLowerCase(); bv = bv.toLowerCase(); }
        if (av < bv) return -1;
        if (av > bv) return 1;
        return 0;
      });
      return dir === 'desc' ? sorted.reverse() : sorted;
    },
  };
})();

/* ==========================================================================
   Rendering: song rows (list) and song cards (grid)
   ========================================================================== */
const SongUI = (() => {
  const isTouch = matchMedia('(hover: none)').matches;
  let hoverTimer = null;

  function artInner(song) {
    if (song.artworkUrl) return `<img src="${song.artworkUrl}" alt="" loading="lazy">`;
    return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none"><path d="M9 18V6l11-2v12" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><circle cx="6" cy="18" r="3" stroke="currentColor" stroke-width="1.3"/><circle cx="17" cy="16" r="3" stroke="currentColor" stroke-width="1.3"/></svg>`;
  }

  function wireHoverPreview(artEl, song) {
    const startPreview = () => {
      if (!Prefs.getSettings().previewEnabled) return;
      artEl.classList.add('is-previewing');
      Player.playPreview(song.src, () => {
        artEl.classList.remove('is-previewing');
        App.showPreviewHint("Hover preview needs a click first — click a song to enable audio.");
      });
    };
    const stopPreview = () => {
      artEl.classList.remove('is-previewing');
      Player.stopPreview();
    };

    if (!isTouch) {
      artEl.addEventListener('mouseenter', () => {
        clearTimeout(hoverTimer);
        hoverTimer = setTimeout(startPreview, 450);
      });
      artEl.addEventListener('mouseleave', () => { clearTimeout(hoverTimer); stopPreview(); });
    } else {
      // No hover on touch devices — tapping the artwork previews instead of playing.
      artEl.addEventListener('click', (e) => {
        e.stopPropagation();
        if (artEl.classList.contains('is-previewing')) { stopPreview(); return; }
        startPreview();
      });
    }
  }

  function songRow(song, opts = {}) {
    const { index, showAlbum = true, numbered = false, playlistId = null, onPlay } = opts;
    const row = document.createElement('div');
    row.className = 'song-row';
    row.dataset.songId = song.id;
    const isFav = Prefs.isFavorite(song.id);

    row.innerHTML = `
      <span class="song-row__index">
        <span class="index-num">${numbered ? (index + 1) : ''}</span>
        <span class="eq"><span></span><span></span><span></span></span>
      </span>
      <span class="song-row__art">${artInner(song)}<span class="preview-ring"></span></span>
      <span class="song-row__main">
        <p class="song-row__title"></p>
        <p class="song-row__artist"></p>
      </span>
      ${showAlbum ? `<span class="song-row__album"></span>` : `<span></span>`}
      <span class="song-row__duration">${formatDuration(song.duration)}</span>
      <span class="song-row__actions">
        <button class="icon-btn icon-btn--sm fav-btn ${isFav ? 'is-fav' : ''}" aria-label="Toggle favorite" title="Favorite">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none"><path d="M12 20s-7-4.3-9.5-8.6C.8 8 2 4.5 5.4 3.7 8 3 10.5 4.4 12 6.6 13.5 4.4 16 3 18.6 3.7 22 4.5 23.2 8 21.5 11.4 19 15.7 12 20 12 20Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
        </button>
        <button class="icon-btn icon-btn--sm more-btn" aria-label="More options" title="More">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>
        </button>
      </span>`;

    row.querySelector('.song-row__title').textContent = song.title;
    row.querySelector('.song-row__artist').textContent = song.artist;
    if (showAlbum) row.querySelector('.song-row__album').textContent = song.album;

    const mainEl = row.querySelector('.song-row__main');
    const playIt = () => { if (onPlay) onPlay(song); };
    mainEl.addEventListener('click', playIt);
    row.querySelector('.song-row__art').addEventListener('dblclick', playIt);

    wireHoverPreview(row.querySelector('.song-row__art'), song);

    row.querySelector('.fav-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const nowFav = Prefs.toggleFavorite(song.id);
      e.currentTarget.classList.toggle('is-fav', nowFav);
      App.onFavoritesChanged();
    });

    row.querySelector('.more-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      App.openRowMenu(e.currentTarget, song, { row, playlistId });
    });

    return row;
  }

  function songCard(song, onPlay) {
    const card = document.createElement('button');
    card.className = 'song-card';
    card.innerHTML = `
      <span class="song-card__art">${artInner(song)}
        <span class="song-card__play"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg></span>
      </span>
      <p class="song-card__title"></p>
      <p class="song-card__sub"></p>`;
    card.querySelector('.song-card__title').textContent = song.title;
    card.querySelector('.song-card__sub').textContent = song.artist;
    card.addEventListener('click', () => onPlay(song));
    return card;
  }

  function renderTable(container, list, opts = {}) {
    container.innerHTML = '';
    if (!list.length) {
      container.innerHTML = `<div class="list-empty">${opts.emptyText || 'No songs here yet.'}</div>`;
      return;
    }
    list.forEach((song, i) => container.appendChild(songRow(song, { ...opts, index: i })));
    refreshPlayingState(container);
  }

  function renderGrid(container, list, onPlay) {
    container.innerHTML = '';
    list.forEach(song => container.appendChild(songCard(song, onPlay)));
  }

  function refreshPlayingState(scope) {
    const root = scope || document;
    const current = Player.current;
    root.querySelectorAll('.song-row').forEach(row => {
      row.classList.toggle('is-playing', !!current && row.dataset.songId === current.id);
    });
  }

  return { songRow, songCard, renderTable, renderGrid, refreshPlayingState, artInner };
})();
