const Playlists = (() => {
  let activePlaylistId = null;

  function songsFor(playlist) {
    return playlist.songIds.map(id => LibraryData.getById(id)).filter(Boolean);
  }

  function totalDuration(songs) {
    return songs.reduce((sum, s) => sum + (s.duration || 0), 0);
  }

  function formatTotalDuration(seconds) {
    const mins = Math.round(seconds / 60);
    if (mins < 60) return `${mins} min`;
    return `${Math.floor(mins / 60)} hr ${mins % 60} min`;
  }

  function renderSidebar() {
    const list = Prefs.getPlaylists();
    const el = document.getElementById('playlistList');
    el.innerHTML = '';
    if (!list.length) {
      el.innerHTML = `<p class="playlist-list__empty">No playlists yet</p>`;
      return;
    }
    list.slice().sort((a, b) => b.dateCreated - a.dateCreated).forEach(p => {
      const btn = document.createElement('button');
      btn.className = 'playlist-list__item' + (p.id === activePlaylistId ? ' is-active' : '');
      btn.innerHTML = `<span></span><span class="playlist-list__count">${p.songIds.length}</span>`;
      btn.querySelector('span').textContent = p.name;
      btn.addEventListener('click', () => App.navigateTo('playlist', p.id));
      el.appendChild(btn);
    });
  }

  function renderHomeGrid() {
    const list = Prefs.getPlaylists();
    const el = document.getElementById('homePlaylistGrid');
    el.innerHTML = '';
    if (!list.length) {
      el.innerHTML = `<p class="modal__empty" style="grid-column:1/-1;text-align:left;padding:0;">Create a playlist from the sidebar to see it here.</p>`;
      return;
    }
    list.slice().sort((a, b) => b.dateCreated - a.dateCreated).slice(0, 8).forEach(p => {
      const card = document.createElement('button');
      card.className = 'playlist-card';
      card.innerHTML = `
        <span class="playlist-card__icon"><svg viewBox="0 0 24 24" width="16" height="16" fill="none"><path d="M9 18V6l11-2v12" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><circle cx="6" cy="18" r="3" stroke="currentColor" stroke-width="1.2"/><circle cx="17" cy="16" r="3" stroke="currentColor" stroke-width="1.2"/></svg></span>
        <p class="playlist-card__name"></p>
        <p class="playlist-card__count">${p.songIds.length} songs</p>`;
      card.querySelector('.playlist-card__name').textContent = p.name;
      card.addEventListener('click', () => App.navigateTo('playlist', p.id));
      el.appendChild(card);
    });
  }

  function openDetail(id) {
    const playlist = Prefs.getPlaylists().find(p => p.id === id);
    if (!playlist) { App.navigateTo('home'); return; }
    activePlaylistId = id;
    const songs = songsFor(playlist);

    document.getElementById('playlistName').textContent = playlist.name;
    document.getElementById('playlistSub').textContent =
      `${songs.length} song${songs.length === 1 ? '' : 's'} · ${formatTotalDuration(totalDuration(songs))}`;

    const artEl = document.getElementById('playlistArt');
    const withArt = songs.find(s => s.artworkUrl);
    artEl.innerHTML = withArt
      ? `<img src="${withArt.artworkUrl}" alt="">`
      : `<svg viewBox="0 0 24 24" width="34" height="34" fill="none"><path d="M9 18V6l11-2v12" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><circle cx="6" cy="18" r="3" stroke="currentColor" stroke-width="1.2"/><circle cx="17" cy="16" r="3" stroke="currentColor" stroke-width="1.2"/></svg>`;

    SongUI.renderTable(document.getElementById('playlistTable'), songs, {
      numbered: true,
      playlistId: id,
      emptyText: 'This playlist is empty. Add songs from any song\u2019s "More" menu.',
      onPlay: (song) => Player.resumeOrPlay(song, songs),
    });

    document.getElementById('btnPlayPlaylist').onclick = () => { if (songs.length) Player.playSong(songs[0], songs); };
    document.getElementById('btnShufflePlaylist').onclick = () => {
      if (!songs.length) return;
      if (!Player.shuffleOn) App.setShuffle(true);
      Player.playSong(songs[Math.floor(Math.random() * songs.length)], songs);
    };
    document.getElementById('btnRenamePlaylist').onclick = () => App.startRenamePlaylist(id);
    document.getElementById('btnDeletePlaylist').onclick = () => App.confirmDeletePlaylist(id, playlist.name);

    renderSidebar();
  }

  function getActiveId() { return activePlaylistId; }

  function create(name) {
    const p = Prefs.createPlaylist(name);
    renderSidebar();
    renderHomeGrid();
    return p;
  }

  function remove(id) {
    Prefs.deletePlaylist(id);
    renderSidebar();
    renderHomeGrid();
  }

  function rename(id, name) {
    Prefs.renamePlaylist(id, name);
    renderSidebar();
    renderHomeGrid();
  }

  function addSong(playlistId, songId) {
    const added = Prefs.addToPlaylist(playlistId, songId);
    renderSidebar();
    renderHomeGrid();
    return added;
  }

  function removeSong(playlistId, songId) {
    Prefs.removeFromPlaylist(playlistId, songId);
    renderSidebar();
    renderHomeGrid();
    if (activePlaylistId === playlistId) openDetail(playlistId);
  }

  /** Populate the "Add to playlist" modal for a given song. */
  function renderAddToPlaylistModal(song) {
    const list = Prefs.getPlaylists();
    const el = document.getElementById('addToPlaylistList');
    el.innerHTML = '';
    if (!list.length) {
      el.innerHTML = `<p class="modal__empty">No playlists yet — create one below.</p>`;
      return;
    }
    list.slice().sort((a, b) => b.dateCreated - a.dateCreated).forEach(p => {
      const inList = p.songIds.includes(song.id);
      const row = document.createElement('div');
      row.className = 'modal__list-item';
      row.innerHTML = `<span></span><button>${inList ? 'Added' : 'Add'}</button>`;
      row.querySelector('span').textContent = p.name;
      const btn = row.querySelector('button');
      btn.classList.toggle('is-added', inList);
      btn.addEventListener('click', () => {
        if (btn.classList.contains('is-added')) {
          removeSong(p.id, song.id);
          btn.classList.remove('is-added');
          btn.textContent = 'Add';
        } else {
          addSong(p.id, song.id);
          btn.classList.add('is-added');
          btn.textContent = 'Added';
        }
      });
      el.appendChild(row);
    });
  }

  return {
    renderSidebar, renderHomeGrid, openDetail, getActiveId,
    create, remove, rename, addSong, removeSong,
    renderAddToPlaylistModal, songsFor,
  };
})();
