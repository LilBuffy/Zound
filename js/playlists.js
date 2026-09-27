const Playlists = (() => {
  let activePlaylistId = null;

  function songsFor(playlist) {
    return playlist.songIds.map(id => LibraryData.getById(id)).filter(Boolean);
  }

  function totalDuration(songs) {
    return songs.reduce((sum, s) => sum + (s.duration || 0), 0);
  }

  function playlistArtwork(songs) {
    return songs.find(s => s.artworkUrl) || null;
  }

  function renderSidebar() {
    const list = Prefs.getPlaylists();
    const el = document.getElementById('playlistList');
    if (!el) return;
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
    if (!el) return;
    el.innerHTML = '';
    if (!list.length) {
      el.innerHTML = `<p class="empty-inline">Create a playlist to see it here.</p>`;
      return;
    }
    list.slice().sort((a, b) => b.dateCreated - a.dateCreated).slice(0, 8).forEach(p => el.appendChild(playlistCard(p)));
  }

  function renderGridInto(container, list) {
    container.innerHTML = '';
    if (!list.length) {
      container.innerHTML = `<div class="list-empty">No playlists yet. Create one from the sidebar.</div>`;
      return;
    }
    list.slice().sort((a, b) => b.dateCreated - a.dateCreated).forEach(p => container.appendChild(playlistCard(p)));
  }

  function playlistCard(p) {
    const songs = songsFor(p);
    const art = playlistArtwork(songs);
    const card = document.createElement('button');
    card.className = 'playlist-card';
    card.innerHTML = `
      <span class="playlist-card__icon">${art ? `<img src="${art.artworkUrl}" alt="">` : `<svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M9 18V6l11-2v12" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><circle cx="6" cy="18" r="3" stroke="currentColor" stroke-width="1.2"/><circle cx="17" cy="16" r="3" stroke="currentColor" stroke-width="1.2"/></svg>`}</span>
      <p class="playlist-card__name"></p>
      <p class="playlist-card__count">${songs.length} song${songs.length === 1 ? '' : 's'}</p>`;
    card.querySelector('.playlist-card__name').textContent = p.name;
    card.addEventListener('click', () => App.navigateTo('playlist', p.id));
    return card;
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
    const withArt = playlistArtwork(songs);
    artEl.innerHTML = withArt
      ? `<img src="${withArt.artworkUrl}" alt="">`
      : `<svg viewBox="0 0 24 24" width="34" height="34" fill="none"><path d="M9 18V6l11-2v12" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><circle cx="6" cy="18" r="3" stroke="currentColor" stroke-width="1.2"/><circle cx="17" cy="16" r="3" stroke="currentColor" stroke-width="1.2"/></svg>`;

    const table = document.getElementById('playlistTable');
    SongUI.renderTable(table, songs, {
      numbered: true,
      playlistId: id,
      emptyText: 'This playlist is empty. Add songs from any song\u2019s "More" menu.',
      onPlay: (song) => Player.resumeOrPlay(song, songs, playlist.name),
    });
    App.makeReorderable(table, (fromIdx, toIdx) => {
      const ids = songs.map(s => s.id);
      const [moved] = ids.splice(fromIdx, 1);
      ids.splice(toIdx, 0, moved);
      Prefs.reorderPlaylist(id, ids);
      openDetail(id);
    });

    document.getElementById('btnPlayPlaylist').onclick = () => { if (songs.length) Player.playSong(songs[0], songs, playlist.name); };
    document.getElementById('btnShufflePlaylist').onclick = () => {
      if (!songs.length) return;
      if (!Player.shuffleOn) App.setShuffle(true);
      Player.playSong(songs[Math.floor(Math.random() * songs.length)], songs, playlist.name);
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
  function remove(id) { Prefs.deletePlaylist(id); renderSidebar(); renderHomeGrid(); }
  function rename(id, name) { Prefs.renamePlaylist(id, name); renderSidebar(); renderHomeGrid(); }
  function addSong(playlistId, songId) {
    const added = Prefs.addToPlaylist(playlistId, songId);
    renderSidebar(); renderHomeGrid();
    return added;
  }
  function removeSong(playlistId, songId) {
    Prefs.removeFromPlaylist(playlistId, songId);
    renderSidebar(); renderHomeGrid();
    if (activePlaylistId === playlistId) openDetail(playlistId);
  }

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
    renderSidebar, renderHomeGrid, renderGridInto, openDetail, getActiveId,
    create, remove, rename, addSong, removeSong,
    renderAddToPlaylistModal, songsFor,
  };
})();
