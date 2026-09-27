const MUSIC_LIBRARY = [
  {
    title: "Sleep Tonight",
    artist: "The Birthday Massacre",
    album: "Pathways (2025)",
    src: "music/Sleep_Tonight.mp3",
    artwork: "music/artwork/sleep_tonight.jpg"
  },
  {
    title: "Pins and Needles",
    artist: "The Birthday Massacre",
    album: "Pins and Needles (2010)",
    src: "music/Pins_And_Needles.mp3",
    artwork: "music/artwork/pins_and_needles.jpg"
  },
  {
    title: "Sleepwalking",
    artist: "The Birthday Massacre",
    album: "Pins and Needles (2010)",
    src: "music/Sleepwalking.mp3",
    artwork: "music/artwork/sleepwalking.jpg"
  },
  {
    title: "Red Stars",
    artist: "The Birthday Massacre",
    album: "Walking With Strangers (2007)",
    src: "music/Red_Stars.mp3",
    artwork: "music/artwork/red_stars.jpg"
  },
  {
    title: "In The Dark",
    artist: "The Birthday Massacre",
    album: "Pins and Needles (2010)",
    src: "music/In_The_Dark.mp3",
    artwork: "music/artwork/in_the_dark.jpg"
  }
];

function formatDuration(totalSeconds) {
  if (!isFinite(totalSeconds) || totalSeconds < 0) return '--:--';
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** "3:45" -> total seconds; used to render summed durations. */
function formatTotalDuration(seconds) {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  return `${h} hr ${mins % 60} min`;
}

function titleFromFilename(filename) {
  return filename.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Untitled';
}

function slugify(str) {
  return (str || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
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
      await Promise.all(bundled.filter(s => !s.duration).map(async s => { s.duration = await probeDuration(s.src); }));
      songs = [...bundled, ...imported];
    })();
    return ready;
  }

  const SUPPORTED_TYPES = /audio\/(mpeg|mp4|m4a|x-m4a|wav|wave|x-wav|ogg|aac|flac|webm)/i;

  /** Fingerprint used for duplicate detection: title+artist (case/space
   *  insensitive) plus duration rounded to the nearest second. Good enough
   *  to catch "the same file imported twice" without false-flagging two
   *  different short clips that merely share a name. */
  function fingerprint(title, artist, duration) {
    return `${(title || '').trim().toLowerCase()}::${(artist || '').trim().toLowerCase()}::${Math.round(duration || 0)}`;
  }
  function existingFingerprints() {
    return new Set(songs.map(s => fingerprint(s.title, s.artist, s.duration)));
  }

  async function addFiles(fileList) {
    const results = { added: [], failed: [], duplicates: [] };
    const seen = existingFingerprints();
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
          URL.revokeObjectURL(objectUrl);
          results.failed.push({ file, reason: "Your browser can't play this file format." });
          continue;
        }

        const title = (tags && tags.title) || titleFromFilename(file.name);
        const artist = (tags && tags.artist) || 'Unknown Artist';
        const fp = fingerprint(title, artist, duration);
        if (seen.has(fp)) {
          URL.revokeObjectURL(objectUrl);
          results.duplicates.push(file.name);
          continue;
        }
        seen.add(fp);

        const record = {
          id,
          title,
          artist,
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
    Prefs.purgeSongIds([id]);
  }

  async function removeManyImported(ids) {
    const idsToDelete = ids.filter(id => {
      const s = songs.find(x => x.id === id);
      return s && !s.isBundled;
    });
    idsToDelete.forEach(id => {
      const song = songs.find(s => s.id === id);
      if (song) revokeUrls(song);
    });
    songs = songs.filter(s => !idsToDelete.includes(s.id));
    await Promise.all(idsToDelete.map(id => Store.delete(id)));
    Prefs.purgeSongIds(idsToDelete);
    return idsToDelete;
  }

  async function clearImported() {
    songs.filter(s => !s.isBundled).forEach(revokeUrls);
    songs = songs.filter(s => s.isBundled);
    await Store.clear();
  }

  async function setArtwork(songId, imageFile) {
    const song = songs.find(s => s.id === songId);
    if (!song || song.isBundled) return false;
    const record = await Store.get(songId);
    if (!record) return false;
    record.pictureBlob = imageFile;
    await Store.put(record);
    if (song.artworkUrl && song.artworkUrl.startsWith('blob:')) URL.revokeObjectURL(song.artworkUrl);
    song.artworkUrl = URL.createObjectURL(imageFile);
    return true;
  }

  /* ---- Artists / Albums grouping ------------------------------------- */
  function getArtists() {
    const map = new Map();
    songs.forEach(s => {
      const key = s.artist || 'Unknown Artist';
      if (!map.has(key)) map.set(key, { id: 'artist_' + slugify(key), name: key, songs: [] });
      map.get(key).songs.push(s);
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }
  function getArtistById(id) { return getArtists().find(a => a.id === id) || null; }

  function getAlbums() {
    const map = new Map();
    songs.forEach(s => {
      const albumName = s.album || 'Unknown Album';
      const key = albumName + '::' + (s.artist || '');
      if (!map.has(key)) map.set(key, { id: 'album_' + slugify(key), name: albumName, artist: s.artist, songs: [] });
      map.get(key).songs.push(s);
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }
  function getAlbumById(id) { return getAlbums().find(a => a.id === id) || null; }

  return {
    init,
    getAll: () => songs.slice(),
    getById: (id) => songs.find(s => s.id === id) || null,
    addFiles,
    removeImported,
    removeManyImported,
    clearImported,
    setArtwork,
    getArtists,
    getArtistById,
    getAlbums,
    getAlbumById,

    getFavorites() { const favs = Prefs.getFavorites(); return favs.map(id => this.getById(id)).filter(Boolean); },
    getRecentlyAdded(limit = 12) { return songs.slice().sort((a, b) => b.dateAdded - a.dateAdded).slice(0, limit); },
    getRecentlyPlayed() {
      const recent = Prefs.getRecent();
      return recent.map(r => this.getById(r.id)).filter(Boolean);
    },
    search(query) {
      const q = query.trim().toLowerCase();
      if (!q) return { songs: [], artists: [], albums: [], playlists: [] };
      const songResults = songs.filter(s =>
        s.title.toLowerCase().includes(q) ||
        s.artist.toLowerCase().includes(q) ||
        s.album.toLowerCase().includes(q));
      const artistResults = this.getArtists().filter(a => a.name.toLowerCase().includes(q));
      const albumResults = this.getAlbums().filter(a => a.name.toLowerCase().includes(q));
      const playlistResults = Prefs.getPlaylists().filter(p => p.name.toLowerCase().includes(q));
      return { songs: songResults, artists: artistResults, albums: albumResults, playlists: playlistResults };
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
        <input type="checkbox" class="row-checkbox" aria-label="Select ${song.isBundled ? '' : song.title}" ${song.isBundled ? 'disabled title="Bundled songs can\'t be deleted"' : ''}>
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
    const playIt = () => {
      const t = row.closest('.song-table');
      if (t && t.classList.contains('is-select-mode')) {
        const cb = row.querySelector('.row-checkbox');
        if (!cb.disabled) { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); }
        return;
      }
      if (onPlay) onPlay(song);
    };
    mainEl.addEventListener('click', playIt);
    row.querySelector('.song-row__art').addEventListener('dblclick', playIt);

    wireHoverPreview(row.querySelector('.song-row__art'), song);

    row.querySelector('.row-checkbox').addEventListener('change', (e) => {
      const t = row.closest('.song-table');
      if (t) App.onRowCheckboxChange(t.id, song.id, e.target.checked);
    });
    row.querySelector('.row-checkbox').addEventListener('click', (e) => e.stopPropagation());

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

    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      App.openRowMenu(row.querySelector('.more-btn'), song, { row, playlistId });
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
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      App.openRowMenu(card, song, { row: card, playlistId: null });
    });
    return card;
  }

  function renderTable(container, list, opts = {}) {
    container.innerHTML = '';
    container._songs = list;
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
    const playing = Player.isPlaying;
    root.querySelectorAll('.song-row').forEach(row => {
      const isCurrent = !!current && row.dataset.songId === current.id;
      row.classList.toggle('is-playing', isCurrent);
      row.classList.toggle('is-paused-current', isCurrent && !playing);
    });
  }

  return { songRow, songCard, renderTable, renderGrid, refreshPlayingState, artInner };
})();
