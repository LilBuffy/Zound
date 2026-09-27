const App = (() => {
  let currentView = 'home';
  let currentParam = null;
  let lastListView = 'all';
  let openMenuEl = null;
  let isSeeking = false;
  let confirmCallback = null;
  let songInfoCurrentSong = null;
  let npOpen = false;
  let npTab = 'player';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  let toastTimer = null;
  function showToast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2600);
  }

  function openModal(id) {
    $('#modalBackdrop').classList.add('is-visible');
    document.getElementById(id).classList.add('is-visible');
  }
  function closeAllModals() {
    $('#modalBackdrop').classList.remove('is-visible');
    $$('.modal').forEach(m => m.classList.remove('is-visible'));
  }
  function anyModalOpen() { return $$('.modal.is-visible').length > 0; }
  function confirmAction(title, body, onConfirm, confirmLabel = 'Confirm') {
    $('#modalConfirmTitle').textContent = title;
    $('#modalConfirmBody').textContent = body;
    $('#btnConfirmAction').textContent = confirmLabel;
    confirmCallback = onConfirm;
    openModal('modalConfirm');
  }

  let previewHintTimer = null;
  function showPreviewHint(msg) {
    const el = $('#previewHint');
    el.textContent = msg;
    el.classList.add('is-visible');
    clearTimeout(previewHintTimer);
    previewHintTimer = setTimeout(() => el.classList.remove('is-visible'), 3200);
  }

  function makeReorderable(container, onReorder) {
    if (!container) return;
    Array.from(container.children).forEach(child => { child.draggable = true; });
    if (container._reorderBound) return;
    container._reorderBound = true;
    let dragSrcIndex = null;
    container.addEventListener('dragstart', (e) => {
      const row = e.target.closest('[draggable="true"]');
      if (!row || row.parentElement !== container) return;
      dragSrcIndex = Array.from(container.children).indexOf(row);
      row.classList.add('is-drag-ghost');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(dragSrcIndex));
    });
    container.addEventListener('dragover', (e) => {
      const row = e.target.closest('[draggable="true"]');
      if (!row || row.parentElement !== container) return;
      e.preventDefault();
      container.querySelectorAll('.is-drag-over').forEach(r => r.classList.remove('is-drag-over'));
      row.classList.add('is-drag-over');
    });
    container.addEventListener('drop', (e) => {
      e.preventDefault();
      const row = e.target.closest('[draggable="true"]');
      container.querySelectorAll('.is-drag-over').forEach(r => r.classList.remove('is-drag-over'));
      if (!row || dragSrcIndex === null) return;
      const targetIndex = Array.from(container.children).indexOf(row);
      if (targetIndex !== dragSrcIndex) onReorder(dragSrcIndex, targetIndex);
      dragSrcIndex = null;
    });
    container.addEventListener('dragend', () => {
      container.querySelectorAll('.is-drag-ghost,.is-drag-over').forEach(r => r.classList.remove('is-drag-ghost', 'is-drag-over'));
      dragSrcIndex = null;
    });
  }

  const VIEW_TITLES = {
    home: 'Home', all: 'All Songs', artists: 'Artists', artist: '', albums: 'Albums', album: '',
    recent: 'Recently Played', favorites: 'Favorites', search: 'Search', settings: 'Settings',
    playlist: '', playlists: 'Playlists',
  };
  const BOTTOMNAV_VIEWS = ['home', 'all', 'favorites'];
  const MORE_VIEWS = ['artists', 'artist', 'albums', 'album', 'recent', 'playlist', 'playlists', 'settings'];

  function navigateTo(view, param) {
    currentView = view;
    currentParam = param;
    if (view !== 'search') lastListView = (view === 'playlist' || view === 'artist' || view === 'album') ? lastListView : view;

    $$('.view').forEach(v => v.classList.remove('is-active'));
    const target = document.getElementById('view-' + view);
    if (target) target.classList.add('is-active');

    $$('.nav__item[data-view]').forEach(b => b.classList.toggle('is-active', b.dataset.view === view));
    $$('.bottomnav__item[data-view]').forEach(b => b.classList.toggle('is-active', b.dataset.view === view));
    $('#btnBottomMore')?.classList.toggle('is-active', MORE_VIEWS.includes(view));
    $('#viewTitle').textContent = VIEW_TITLES[view] ?? '';
    $('#mheaderTitle').textContent = VIEW_TITLES[view] || 'Zound';

    closeMobileSidebar();
    closeRowMenu();
    cancelAllSelections();

    if (view === 'home') renderHome();
    else if (view === 'all') renderAll();
    else if (view === 'artists') renderArtists();
    else if (view === 'artist') renderArtistDetail(param);
    else if (view === 'albums') renderAlbums();
    else if (view === 'album') renderAlbumDetail(param);
    else if (view === 'recent') renderRecent();
    else if (view === 'favorites') renderFavorites();
    else if (view === 'playlist') Playlists.openDetail(param);
    else if (view === 'playlists') renderPlaylistsGrid();
  }

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-view]');
    if (el && !el.classList.contains('nav__item') && !el.classList.contains('bottomnav__item')) navigateTo(el.dataset.view, el.dataset.param);
  });

  function renderHome() {
    const all = LibraryData.getAll();
    const empty = $('#homeEmpty'), content = $('#homeContent');
    if (!all.length) { empty.classList.remove('hidden'); content.classList.add('hidden'); return; }
    empty.classList.add('hidden'); content.classList.remove('hidden');

    SongUI.renderGrid($('#recentAddedGrid'), LibraryData.getRecentlyAdded(10), (song) => Player.resumeOrPlay(song, LibraryData.getAll(), 'All Songs'));
    const recentPlayed = LibraryData.getRecentlyPlayed().slice(0, 10);
    $('#recentPlayedGrid').closest('.home-row').classList.toggle('hidden', !recentPlayed.length);
    if (recentPlayed.length) SongUI.renderGrid($('#recentPlayedGrid'), recentPlayed, (song) => Player.resumeOrPlay(song, recentPlayed, 'Recently Played'));
    Playlists.renderHomeGrid();
  }

  function currentSort() {
    const [key, dir] = $('#sortSelect').value.split('-');
    return { key, dir };
  }
  function renderAll() {
    const { key, dir } = currentSort();
    const list = LibraryData.sort(LibraryData.getAll(), key, dir);
    $('#allCount').textContent = `${list.length} song${list.length === 1 ? '' : 's'}`;
    SongUI.renderTable($('#allSongsTable'), list, {
      emptyText: 'No songs imported yet.',
      onPlay: (song) => Player.resumeOrPlay(song, list, 'All Songs'),
    });
    syncSelectionCheckboxes('allSongsTable');
  }

  function renderArtists() {
    const artists = LibraryData.getArtists();
    const el = $('#artistGrid');
    el.innerHTML = '';
    if (!artists.length) { el.innerHTML = `<div class="list-empty">No artists yet. Import some music first.</div>`; return; }
    artists.forEach(a => {
      const withArt = a.songs.find(s => s.artworkUrl);
      const card = document.createElement('button');
      card.className = 'artist-card';
      card.innerHTML = `
        <span class="artist-card__art">${withArt ? `<img src="${withArt.artworkUrl}" alt="">` : artistFallbackSvg()}</span>
        <p class="artist-card__name"></p>
        <p class="artist-card__count">${a.songs.length} song${a.songs.length === 1 ? '' : 's'}</p>`;
      card.querySelector('.artist-card__name').textContent = a.name;
      card.addEventListener('click', () => navigateTo('artist', a.id));
      el.appendChild(card);
    });
  }
  function artistFallbackSvg() {
    return `<svg viewBox="0 0 24 24" width="34" height="34" fill="none"><circle cx="12" cy="8" r="3.2" stroke="currentColor" stroke-width="1.3"/><path d="M5 20c0-3.3 3.1-6 7-6s7 2.7 7 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`;
  }
  function renderArtistDetail(id) {
    const artist = LibraryData.getArtistById(id);
    if (!artist) { navigateTo('artists'); return; }
    const withArt = artist.songs.find(s => s.artworkUrl);
    $('#artistArt').innerHTML = withArt ? `<img src="${withArt.artworkUrl}" alt="">` : artistFallbackSvg();
    $('#artistName').textContent = artist.name;
    $('#artistSub').textContent = `${artist.songs.length} song${artist.songs.length === 1 ? '' : 's'} · ${formatTotalDuration(artist.songs.reduce((s, x) => s + (x.duration || 0), 0))}`;
    SongUI.renderTable($('#artistTable'), artist.songs, { emptyText: 'Nothing here yet.', onPlay: (song) => Player.resumeOrPlay(song, artist.songs, artist.name) });
    $('#btnPlayArtist').onclick = () => { if (artist.songs.length) Player.playSong(artist.songs[0], artist.songs, artist.name); };
    $('#btnShuffleArtist').onclick = () => { if (!artist.songs.length) return; if (!Player.shuffleOn) setShuffle(true); Player.playSong(artist.songs[Math.floor(Math.random() * artist.songs.length)], artist.songs, artist.name); };
  }

  function renderAlbums() {
    const albums = LibraryData.getAlbums();
    const el = $('#albumGrid');
    el.innerHTML = '';
    if (!albums.length) { el.innerHTML = `<div class="list-empty">No albums yet. Import some music first.</div>`; return; }
    albums.forEach(a => {
      const withArt = a.songs.find(s => s.artworkUrl);
      const card = document.createElement('button');
      card.className = 'album-card';
      card.innerHTML = `
        <span class="album-card__art">${withArt ? `<img src="${withArt.artworkUrl}" alt="">` : SongUI.artInner({})}</span>
        <p class="album-card__name"></p>
        <p class="album-card__sub"></p>`;
      card.querySelector('.album-card__name').textContent = a.name;
      card.querySelector('.album-card__sub').textContent = a.artist;
      card.addEventListener('click', () => navigateTo('album', a.id));
      el.appendChild(card);
    });
  }
  function renderAlbumDetail(id) {
    const album = LibraryData.getAlbumById(id);
    if (!album) { navigateTo('albums'); return; }
    const withArt = album.songs.find(s => s.artworkUrl);
    $('#albumArt').innerHTML = withArt ? `<img src="${withArt.artworkUrl}" alt="">` : SongUI.artInner({});
    $('#albumName').textContent = album.name;
    $('#albumSub').textContent = `${album.artist} · ${album.songs.length} song${album.songs.length === 1 ? '' : 's'} · ${formatTotalDuration(album.songs.reduce((s, x) => s + (x.duration || 0), 0))}`;
    SongUI.renderTable($('#albumTable'), album.songs, { showAlbum: false, emptyText: 'Nothing here yet.', onPlay: (song) => Player.resumeOrPlay(song, album.songs, album.name) });
    $('#btnPlayAlbum').onclick = () => { if (album.songs.length) Player.playSong(album.songs[0], album.songs, album.name); };
    $('#btnShuffleAlbum').onclick = () => { if (!album.songs.length) return; if (!Player.shuffleOn) setShuffle(true); Player.playSong(album.songs[Math.floor(Math.random() * album.songs.length)], album.songs, album.name); };
  }

  function renderRecent() {
    const list = LibraryData.getRecentlyPlayed();
    $('#recentCount').textContent = `${list.length} song${list.length === 1 ? '' : 's'}`;
    SongUI.renderTable($('#recentTable'), list, {
      emptyText: 'Nothing played yet. Your history will show up here.',
      onPlay: (song) => Player.resumeOrPlay(song, list, 'Recently Played'),
    });
  }

  function renderFavorites() {
    const list = LibraryData.getFavorites();
    $('#favCount').textContent = `${list.length} song${list.length === 1 ? '' : 's'}`;
    SongUI.renderTable($('#favoritesTable'), list, {
      emptyText: 'Favorite a song to see it here.',
      onPlay: (song) => Player.resumeOrPlay(song, list, 'Favorites'),
    });
    syncSelectionCheckboxes('favoritesTable');
    $('#btnPlayFavorites').onclick = () => { if (list.length) Player.playSong(list[0], list, 'Favorites'); };
    $('#btnShuffleFavorites').onclick = () => { if (!list.length) return; if (!Player.shuffleOn) setShuffle(true); Player.playSong(list[Math.floor(Math.random() * list.length)], list, 'Favorites'); };
  }

  function renderPlaylistsGrid() { Playlists.renderGridInto($('#playlistsGrid'), Prefs.getPlaylists()); }

  function renderSearch(query) {
    const results = LibraryData.search(query);
    $('#searchCount').textContent = `${results.songs.length} song result${results.songs.length === 1 ? '' : 's'}`;
    const chips = $('#searchChips');
    chips.innerHTML = '';
    const chipGroups = [
      ...results.artists.map(a => ({ label: `${a.name} (artist)`, view: 'artist', param: a.id })),
      ...results.albums.map(a => ({ label: `${a.name} (album)`, view: 'album', param: a.id })),
      ...results.playlists.map(p => ({ label: `${p.name} (playlist)`, view: 'playlist', param: p.id })),
    ];
    chips.classList.toggle('hidden', !chipGroups.length);
    chipGroups.forEach(c => {
      const btn = document.createElement('button');
      btn.className = 'lib-tab';
      btn.textContent = c.label;
      btn.addEventListener('click', () => navigateTo(c.view, c.param));
      chips.appendChild(btn);
    });
    SongUI.renderTable($('#searchTable'), results.songs, {
      emptyText: `No matches for "${query}".`,
      onPlay: (song) => Player.resumeOrPlay(song, results.songs, 'Search results'),
    });
  }

  function onFavoritesChanged() {
    if (currentView === 'favorites') renderFavorites();
    if (Player.current) {
      $('#btnNowFav').classList.toggle('is-fav', Prefs.isFavorite(Player.current.id));
      $('#btnNPFav').classList.toggle('is-fav', Prefs.isFavorite(Player.current.id));
    }
  }

  function closeRowMenu() {
    if (openMenuEl) { openMenuEl.remove(); openMenuEl = null; }
    $$('.song-row.is-menu-open, .is-menu-open').forEach(r => r.classList.remove('is-menu-open'));
  }

  function openRowMenu(anchorBtn, song, { row, playlistId }) {
    const alreadyOpenForThisRow = openMenuEl && row.contains(openMenuEl);
    closeRowMenu();
    if (alreadyOpenForThisRow) return;

    const isFav = Prefs.isFavorite(song.id);
    row.classList.add('is-menu-open');
    if (getComputedStyle(row).position === 'static') row.style.position = 'relative';
    const menu = document.createElement('div');
    menu.className = 'row-menu';
    menu.innerHTML = `
      <button data-act="play">Play</button>
      <button data-act="playnext">Play next</button>
      <button data-act="queue">Add to queue</button>
      <div class="row-menu__divider"></div>
      <button data-act="fav">${isFav ? 'Remove from favorites' : 'Add to favorites'}</button>
      <button data-act="add">Add to playlist</button>
      ${playlistId ? `<button data-act="remove">Remove from this playlist</button>` : ''}
      <div class="row-menu__divider"></div>
      <button data-act="viewartist">View artist</button>
      <button data-act="viewalbum">View album</button>
      <button data-act="info">Song info</button>
      ${!song.isBundled ? `<button data-act="artwork">Change artwork</button>` : ''}
      ${!song.isBundled ? `<div class="row-menu__divider"></div><button data-act="delete" class="danger">Delete from library</button>` : ''}
    `;
    row.appendChild(menu);
    openMenuEl = menu;

    const act = (name, fn) => { const b = menu.querySelector(`[data-act="${name}"]`); if (b) b.addEventListener('click', () => { closeRowMenu(); fn(); }); };
    act('play', () => Player.playImmediately(song));
    act('playnext', () => { Queue.playNext(song.id); showToast('Playing next'); });
    act('queue', () => { Queue.add(song.id); showToast('Added to queue'); });
    act('fav', () => { const nowFav = Prefs.toggleFavorite(song.id); onFavoritesChanged(); refreshCurrentView(); showToast(nowFav ? 'Added to favorites' : 'Removed from favorites'); });
    act('add', () => openAddToPlaylist(song));
    act('remove', () => { Playlists.removeSong(playlistId, song.id); showToast('Removed from playlist'); });
    act('viewartist', () => navigateTo('artist', 'artist_' + slugify(song.artist)));
    act('viewalbum', () => navigateTo('album', 'album_' + slugify((song.album || 'Unknown Album') + '::' + (song.artist || ''))));
    act('info', () => openSongInfo(song));
    act('artwork', () => promptArtworkChange(song));
    act('delete', () => {
      confirmAction('Delete from library?', `"${song.title}" will be removed from your imported music. This can't be undone.`, async () => {
        await LibraryData.removeImported(song.id);
        showToast('Deleted from library');
        refreshCurrentView();
      }, 'Delete');
    });
  }
  document.addEventListener('click', (e) => { if (openMenuEl && !openMenuEl.contains(e.target) && !e.target.closest('.more-btn')) closeRowMenu(); });

  function openAddToPlaylist(song) {
    Playlists.renderAddToPlaylistModal(song);
    openModal('modalAddToPlaylist');
    $('#btnCreateFromAdd').onclick = () => {
      closeAllModals();
      openModal('modalNewPlaylist');
      $('#newPlaylistInput').value = '';
      $('#newPlaylistInput').focus();
      $('#btnConfirmNewPlaylist').onclick = () => {
        const name = $('#newPlaylistInput').value.trim();
        if (!name) return;
        const p = Playlists.create(name);
        Playlists.addSong(p.id, song.id);
        closeAllModals();
        showToast(`Added to "${p.name}"`);
      };
    };
  }

  function openSongInfo(song) {
    songInfoCurrentSong = song;
    const rows = [
      ['Title', song.title], ['Artist', song.artist], ['Album', song.album],
      ['Duration', formatDuration(song.duration)],
      ['File', song.filename],
      ['Source', song.isBundled ? 'Bundled with project' : 'Imported from your device'],
      ['Added', song.dateAdded ? new Date(song.dateAdded).toLocaleDateString() : '-'],
    ];
    $('#songInfoBody').innerHTML = rows.map(([k]) => `<div class="song-info__row"><span>${k}</span><span></span></div>`).join('');
    $$('#songInfoBody .song-info__row span:last-child').forEach((el, i) => { el.textContent = rows[i][1]; });
    openModal('modalSongInfo');
  }

  let artworkTargetSong = null;
  function promptArtworkChange(song) {
    if (song.isBundled) { showToast("Bundled songs can't have custom artwork."); return; }
    artworkTargetSong = song;
    $('#artworkInput').click();
  }
  function initArtwork() {
    $('#artworkInput').addEventListener('change', async () => {
      const file = $('#artworkInput').files[0];
      $('#artworkInput').value = '';
      if (!file || !artworkTargetSong) return;
      if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { showToast('Please choose a JPG, PNG, or WEBP image.'); return; }
      const ok = await LibraryData.setArtwork(artworkTargetSong.id, file);
      if (!ok) { showToast('Could not update artwork.'); return; }
      showToast('Artwork updated');
      if (Player.current && Player.current.id === artworkTargetSong.id) renderNowPlaying(Player.current);
      if (songInfoCurrentSong && songInfoCurrentSong.id === artworkTargetSong.id) openSongInfo(artworkTargetSong);
      refreshEverything();
      artworkTargetSong = null;
    });
    $('#btnChangeArtwork').addEventListener('click', () => { if (songInfoCurrentSong) promptArtworkChange(songInfoCurrentSong); });
  }

  function refreshCurrentView() {
    if (currentView === 'playlist') Playlists.openDetail(Playlists.getActiveId());
    else navigateTo(currentView, currentParam);
  }

  function startRenamePlaylist(id) {
    const el = $('#playlistName');
    el.setAttribute('contenteditable', 'true');
    el.focus();
    document.execCommand('selectAll', false, null);
    const commit = () => {
      el.setAttribute('contenteditable', 'false');
      Playlists.rename(id, el.textContent.trim() || 'Untitled');
      el.removeEventListener('blur', commit);
      el.removeEventListener('keydown', onKey);
    };
    const onKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } };
    el.addEventListener('blur', commit);
    el.addEventListener('keydown', onKey);
  }
  function confirmDeletePlaylist(id, name) {
    confirmAction('Delete playlist?', `"${name}" will be deleted. Your songs stay in your library.`, () => {
      Playlists.remove(id);
      showToast('Playlist deleted');
      navigateTo('home');
    }, 'Delete');
  }

  function fillPercent(el, pct) { el.style.setProperty('--fill', `${Math.min(Math.max(pct, 0), 100)}%`); }

  function renderNowPlaying(song) {
    $('#nowTitle').textContent = song.title;
    $('#nowArtist').textContent = song.artist;
    $('#playerArt').innerHTML = SongUI.artInner(song);
    $('#btnNowFav').classList.toggle('is-fav', Prefs.isFavorite(song.id));
    $('#npTitle').textContent = song.title;
    $('#npArtist').textContent = song.artist;
    $('#npArt').innerHTML = SongUI.artInner(song);
    $('#btnNPFav').classList.toggle('is-fav', Prefs.isFavorite(song.id));
    $('#npFrom').textContent = Player.contextLabel || '-';
    document.title = `${song.title} · ${song.artist} - Zound`;
    SongUI.refreshPlayingState();
    renderQueuePanel();
  }

  function setShuffle(on) {
    Player.setShuffle(on);
    $('#btnShuffle').classList.toggle('is-active', on);
    $('#npBtnShuffle').classList.toggle('is-active', on);
  }
  function updateRepeatUI(mode) {
    $('#btnRepeat').classList.toggle('is-active', mode !== 'off');
    $('#repeatOneBadge').classList.toggle('hidden', mode !== 'one');
    $('#npBtnRepeat').classList.toggle('is-active', mode !== 'off');
    $('#npRepeatOneBadge').classList.toggle('hidden', mode !== 'one');
  }
  function applyVolumeUI(percent, muted) {
    $('#volumeBar').value = percent; $('#npVolumeBar').value = percent;
    $('#volumeValue').textContent = muted ? 'Muted' : `${Math.round(percent)}%`;
    fillPercent($('#volumeBar'), percent); fillPercent($('#npVolumeBar'), percent);
    $('#btnMute').classList.toggle('is-active', muted);
    $('#npBtnMute').classList.toggle('is-active', muted);
  }

  function initPlayerBar() {
    Player.on('songChange', (song) => { renderNowPlaying(song); Prefs.pushRecent(song.id); if (currentView === 'recent') renderRecent(); if (currentView === 'home') renderHome(); });
    Player.on('playState', (state) => {
      $$('#iconPlay,#npIconPlay').forEach(el => el.classList.toggle('hidden', state.playing));
      $$('#iconPause,#npIconPause').forEach(el => el.classList.toggle('hidden', !state.playing));
      if (state.error) showToast(state.error);
      SongUI.refreshPlayingState();
      if (state.playing) Visualizer.start(); else if (!npOpen) Visualizer.stop();
    });
    Player.on('time', ({ current, duration }) => {
      const curTxt = formatDuration(current), durTxt = formatDuration(duration);
      $('#curTime').textContent = curTxt; $('#durTime').textContent = durTxt;
      $('#npCurTime').textContent = curTxt; $('#npDurTime').textContent = durTxt;
      if (!isSeeking) {
        const pct = duration ? (current / duration) * 100 : 0;
        $('#seekBar').value = pct; $('#npSeekBar').value = pct;
        fillPercent($('#seekBar'), pct); fillPercent($('#npSeekBar'), pct);
      }
    });
    Player.on('ended', () => { $$('#iconPlay,#npIconPlay').forEach(el => el.classList.remove('hidden')); $$('#iconPause,#npIconPause').forEach(el => el.classList.add('hidden')); });

    const wireTransport = (prefix) => {
      $(`#${prefix}Play`).addEventListener('click', () => Player.toggle());
      $(`#${prefix}Next`).addEventListener('click', () => Player.next(true));
      $(`#${prefix}Prev`).addEventListener('click', () => Player.prev());
    };
    wireTransport('btn'); wireTransport('npBtn');
    $('#btnShuffle').addEventListener('click', () => setShuffle(!Player.shuffleOn));
    $('#npBtnShuffle').addEventListener('click', () => setShuffle(!Player.shuffleOn));
    $('#btnRepeat').addEventListener('click', () => updateRepeatUI(Player.cycleRepeat()));
    $('#npBtnRepeat').addEventListener('click', () => updateRepeatUI(Player.cycleRepeat()));

    const toggleFav = () => {
      if (!Player.current) return;
      const nowFav = Prefs.toggleFavorite(Player.current.id);
      $('#btnNowFav').classList.toggle('is-fav', nowFav);
      $('#btnNPFav').classList.toggle('is-fav', nowFav);
      onFavoritesChanged();
    };
    $('#btnNowFav').addEventListener('click', toggleFav);
    $('#btnNPFav').addEventListener('click', toggleFav);

    $('#btnQueue').addEventListener('click', () => openNowPlaying('queue'));
    $('#playerArt').addEventListener('click', () => openNowPlaying('player'));
    $('#playerMeta').addEventListener('click', () => openNowPlaying('player'));
    [$('#playerArt'), $('#playerMeta')].forEach(el => el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openNowPlaying('player'); } }));
    $('#btnCollapseNP').addEventListener('click', closeNowPlaying);
    $('#btnNPMore').addEventListener('click', () => { if (Player.current) openSongInfo(Player.current); });
    $$('.np-tab').forEach(tab => tab.addEventListener('click', () => switchNPTab(tab.dataset.npTab)));

    const wireSeek = (id, npId) => {
      const bar = $(id);
      bar.addEventListener('input', () => { isSeeking = true; fillPercent(bar, bar.value); const twin = id === '#seekBar' ? $(npId) : $('#seekBar'); if (twin) { twin.value = bar.value; fillPercent(twin, bar.value); } });
      bar.addEventListener('change', () => { const duration = Player.audioElement.duration || 0; Player.seekTo((bar.value / 100) * duration); isSeeking = false; });
    };
    wireSeek('#seekBar', '#npSeekBar'); wireSeek('#npSeekBar', '#seekBar');

    const wireVolume = (id) => {
      $(id).addEventListener('input', () => {
        const val = Number($(id).value);
        Prefs.saveSettings({ volume: val, muted: false });
        Player.setVolumePercent(val, false);
        applyVolumeUI(val, false);
      });
    };
    wireVolume('#volumeBar'); wireVolume('#npVolumeBar');
    const toggleMute = () => { const settings = Prefs.saveSettings({ muted: !Prefs.getSettings().muted }); Player.setVolumePercent(settings.volume, settings.muted); applyVolumeUI(settings.volume, settings.muted); };
    $('#btnMute').addEventListener('click', toggleMute);
    $('#npBtnMute').addEventListener('click', toggleMute);

    $$('#vizSwitch button').forEach(btn => btn.addEventListener('click', () => {
      $$('#vizSwitch button').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      Visualizer.setStyle(btn.dataset.style);
      Prefs.saveSettings({ visualizerStyle: btn.dataset.style });
    }));
  }

  function openNowPlaying(tab) {
    if (!Player.current) { showToast('Nothing playing yet. Pick a song first.'); return; }
    Player.resumeAudioContext();
    $('#nowPlaying').classList.add('is-open');
    npOpen = true;
    switchNPTab(tab || 'player');
    if (Player.isPlaying) Visualizer.start();
  }
  function closeNowPlaying() {
    $('#nowPlaying').classList.remove('is-open');
    npOpen = false;
    if (!Player.isPlaying) Visualizer.stop();
  }
  function switchNPTab(tab) {
    npTab = tab;
    $$('.np-tab').forEach(t => t.classList.toggle('is-active', t.dataset.npTab === tab));
    $('#npPanelPlayer').classList.toggle('is-active', tab === 'player');
    $('#npPanelQueue').classList.toggle('is-active', tab === 'queue');
    if (tab === 'queue') renderQueuePanel();
  }

  function queueRow(song, opts = {}) {
    const row = document.createElement('div');
    row.className = 'queue-row' + (opts.current ? ' is-current' : '');
    row.innerHTML = `
      ${opts.draggable ? `<span class="queue-row__handle"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><circle cx="9" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg></span>` : ''}
      <span class="queue-row__art">${SongUI.artInner(song)}</span>
      <span class="queue-row__main"><p class="queue-row__title"></p><p class="queue-row__artist"></p></span>
      ${opts.removable ? `<button class="icon-btn icon-btn--sm queue-row__remove" aria-label="Remove"><svg viewBox="0 0 24 24" width="13" height="13" fill="none"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>` : ''}
    `;
    row.querySelector('.queue-row__title').textContent = song.title;
    row.querySelector('.queue-row__artist').textContent = song.artist;
    if (opts.onPlay) row.querySelector('.queue-row__main').addEventListener('click', opts.onPlay);
    if (opts.onRemove) row.querySelector('.queue-row__remove').addEventListener('click', (e) => { e.stopPropagation(); opts.onRemove(); });
    return row;
  }

  function renderQueuePanel() {
    const nowEl = $('#queueNowPlaying');
    nowEl.innerHTML = '';
    if (Player.current) nowEl.appendChild(queueRow(Player.current, { current: true }));
    else nowEl.innerHTML = `<p class="queue-empty">Nothing playing.</p>`;

    const { manual, contextRest, contextLabel } = Player.upcoming();
    const upNextEl = $('#queueUpNext');
    upNextEl.innerHTML = '';
    if (!manual.length) upNextEl.innerHTML = `<p class="queue-empty">Nothing queued. Use "Play next" or "Add to queue" from any song's menu.</p>`;
    else manual.forEach((song, i) => upNextEl.appendChild(queueRow(song, {
      draggable: true, removable: true,
      onPlay: () => { for (let k = 0; k <= i; k++) Queue.shift(); Player.playImmediately(song); },
      onRemove: () => Queue.removeAt(i),
    })));
    makeReorderable(upNextEl, (from, to) => Queue.reorder(from, to));

    $('#queueContextLabel').textContent = contextLabel ? `Next from ${contextLabel}` : 'Up next';
    const restEl = $('#queueContextRest');
    restEl.innerHTML = '';
    if (!contextRest.length) restEl.innerHTML = `<p class="queue-empty">That's the end of this list.</p>`;
    else contextRest.slice(0, 60).forEach(song => restEl.appendChild(queueRow(song, { onPlay: () => Player.playSong(song, null) })));

    $('#btnClearQueue').onclick = () => { Queue.clear(); renderQueuePanel(); showToast('Queue cleared'); };
    $('#btnSaveQueueAsPlaylist').onclick = () => {
      const songs = [Player.current, ...manual, ...contextRest].filter(Boolean);
      if (!songs.length) { showToast('Nothing to save yet.'); return; }
      const p = Playlists.create(`Queue - ${new Date().toLocaleDateString()}`);
      songs.forEach(s => Playlists.addSong(p.id, s.id));
      showToast(`Saved as "${p.name}"`);
    };
  }
  Queue.onChange(() => { if (npOpen && npTab === 'queue') renderQueuePanel(); });

  async function handleFiles(fileList) {
    if (!fileList || !fileList.length) return;
    showToast(`Importing ${fileList.length} file${fileList.length === 1 ? '' : 's'}…`);
    const { added, failed, duplicates } = await LibraryData.addFiles(fileList);
    if (added.length) showToast(`Added ${added.length} song${added.length === 1 ? '' : 's'} to your library`);
    else if (duplicates.length) showToast(`Skipped ${duplicates.length} duplicate${duplicates.length === 1 ? '' : 's'} already in your library.`);
    else if (failed.length) showToast(failed[0].reason || "Some files couldn't be imported.");
    refreshEverything();
    updateStorageMeter();
  }

  function initImport() {
    const fileInput = $('#fileInput');
    const trigger = () => fileInput.click();
    $('#btnImport').addEventListener('click', trigger);
    $('#btnImportHero').addEventListener('click', trigger);
    $('#btnImportTop').addEventListener('click', trigger);
    fileInput.addEventListener('change', () => { handleFiles(fileInput.files); fileInput.value = ''; });

    let dragCounter = 0;
    const dropzone = $('#dropzone');
    window.addEventListener('dragenter', (e) => {
      e.preventDefault();
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
      dragCounter++;
      dropzone.classList.add('is-active');
    });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('dragleave', () => { dragCounter = Math.max(0, dragCounter - 1); if (dragCounter === 0) dropzone.classList.remove('is-active'); });
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      dragCounter = 0;
      dropzone.classList.remove('is-active');
      if (e.dataTransfer && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
    });
  }

  function initSearch() {
    const input = $('#searchInput');
    const run = (q) => {
      if (q.trim()) {
        currentView = 'search';
        $$('.view').forEach(v => v.classList.remove('is-active'));
        $('#view-search').classList.add('is-active');
        $$('.nav__item[data-view],.bottomnav__item[data-view]').forEach(b => b.classList.remove('is-active'));
        $('#viewTitle').textContent = 'Search';
        $('#mheaderTitle').textContent = 'Search';
        renderSearch(q);
      } else {
        navigateTo(lastListView === 'search' ? 'all' : lastListView);
      }
    };
    input.addEventListener('input', () => run(input.value));

    $('#btnMobileSearch').addEventListener('click', () => {
      $('#searchWrap').classList.add('is-mobile-open');
      input.focus();
    });
    document.addEventListener('click', (e) => {
      if ($('#searchWrap').classList.contains('is-mobile-open') && !$('#searchWrap').contains(e.target) && e.target.id !== 'btnMobileSearch') {
        if (!input.value.trim()) $('#searchWrap').classList.remove('is-mobile-open');
      }
    });
  }
  function initSort() { $('#sortSelect').addEventListener('change', renderAll); }

  function openMobileSidebar() { $('#sidebar').classList.add('is-open'); $('#scrim').classList.add('is-visible'); }
  function closeMobileSidebar() { $('#sidebar').classList.remove('is-open'); $('#scrim').classList.remove('is-visible'); }
  function initMobileNav() {
    $('#btnMenu').addEventListener('click', openMobileSidebar);
    $('#btnBottomMore').addEventListener('click', openMobileSidebar);
    $('#scrim').addEventListener('click', closeMobileSidebar);
  }

  function initSidebarCollapse() {
    const collapsed = Prefs.getSettings().sidebarCollapsed;
    $('#app').classList.toggle('sidebar-collapsed', collapsed);
    $('#btnCollapseSidebar').addEventListener('click', () => {
      const nowCollapsed = !$('#app').classList.contains('sidebar-collapsed');
      $('#app').classList.toggle('sidebar-collapsed', nowCollapsed);
      Prefs.saveSettings({ sidebarCollapsed: nowCollapsed });
      $('#btnCollapseSidebar').setAttribute('aria-label', nowCollapsed ? 'Expand sidebar' : 'Collapse sidebar');
    });
  }

  function initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (e.key === 'Escape') {
        if (anyModalOpen()) closeAllModals();
        else if (npOpen) closeNowPlaying();
        return;
      }
      if (tag === 'input' || tag === 'select' || tag === 'textarea' || e.target.isContentEditable) return;
      switch (e.key) {
        case ' ': e.preventDefault(); Player.toggle(); break;
        case 'ArrowRight': if (e.shiftKey) Player.next(true); else Player.seekTo(Math.min(Player.audioElement.currentTime + 5, Player.audioElement.duration || 0)); break;
        case 'ArrowLeft': if (e.shiftKey) Player.prev(); else Player.seekTo(Math.max(Player.audioElement.currentTime - 5, 0)); break;
        case 'ArrowUp': { e.preventDefault(); const v = Math.min(Number($('#volumeBar').value) + 5, 100); $('#volumeBar').value = v; $('#volumeBar').dispatchEvent(new Event('input')); break; }
        case 'ArrowDown': { e.preventDefault(); const v = Math.max(Number($('#volumeBar').value) - 5, 0); $('#volumeBar').value = v; $('#volumeBar').dispatchEvent(new Event('input')); break; }
        case 'n': case 'N': Player.next(true); break;
        case 'p': case 'P': Player.prev(); break;
        case 'm': case 'M': $('#btnMute').click(); break;
        case 's': case 'S': setShuffle(!Player.shuffleOn); break;
        case 'r': case 'R': updateRepeatUI(Player.cycleRepeat()); break;
        case 'f': case 'F': $('#btnNowFav').click(); break;
        case 'q': case 'Q': openNowPlaying('queue'); break;
      }
    });
  }

  function crossfadeLabel(sec) { return sec > 0 ? `${sec} second${sec === 1 ? '' : 's'}` : 'Off'; }
  async function updateStorageMeter() {
    const est = await Store.estimateUsage();
    if (!est || !est.quota) { $('#storageText').textContent = "Storage usage isn't available in this browser."; return; }
    const pct = Math.min(100, (est.usage / est.quota) * 100);
    $('#storageFill').style.width = `${pct}%`;
    const fmt = (n) => n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${(n / 1e6).toFixed(0)} MB`;
    $('#storageText').textContent = `${fmt(est.usage)} used of ${fmt(est.quota)} available in this browser.`;
  }

  function initSettings() {
    const s = Prefs.getSettings();
    $('#previewToggle').checked = s.previewEnabled;
    $('#autoplayToggle').checked = s.autoplay;
    $('#crossfadeRange').value = s.crossfadeSec;
    $('#crossfadeDesc').textContent = crossfadeLabel(s.crossfadeSec);
    $('#boostRange').value = s.volumeBoost;
    $('#boostDesc').textContent = `${s.volumeBoost}%`;
    $('#visualizerToggle').checked = s.visualizerEnabled;
    $('#visualizerStyleSelect').value = s.visualizerStyle;
    $$('#vizSwitch button').forEach(b => b.classList.toggle('is-active', b.dataset.style === s.visualizerStyle));
    $('#animationsToggle').checked = s.animationsEnabled;
    document.body.classList.toggle('no-animations', !s.animationsEnabled);
    Visualizer.setStyle(s.visualizerStyle);
    Player.setVolumeBoost(s.volumeBoost);
    updateStorageMeter();

    $('#previewToggle').addEventListener('change', (e) => Prefs.saveSettings({ previewEnabled: e.target.checked }));
    $('#autoplayToggle').addEventListener('change', (e) => Prefs.saveSettings({ autoplay: e.target.checked }));
    $('#crossfadeRange').addEventListener('input', (e) => { const v = Number(e.target.value); Prefs.saveSettings({ crossfadeSec: v }); $('#crossfadeDesc').textContent = crossfadeLabel(v); });
    $('#boostRange').addEventListener('input', (e) => { const v = Number(e.target.value); Prefs.saveSettings({ volumeBoost: v }); $('#boostDesc').textContent = `${v}%`; Player.setVolumeBoost(v); });
    $('#visualizerToggle').addEventListener('change', (e) => Prefs.saveSettings({ visualizerEnabled: e.target.checked }));
    $('#visualizerStyleSelect').addEventListener('change', (e) => { Visualizer.setStyle(e.target.value); Prefs.saveSettings({ visualizerStyle: e.target.value }); $$('#vizSwitch button').forEach(b => b.classList.toggle('is-active', b.dataset.style === e.target.value)); });
    $('#animationsToggle').addEventListener('change', (e) => { Prefs.saveSettings({ animationsEnabled: e.target.checked }); document.body.classList.toggle('no-animations', !e.target.checked); });

    $('#btnClearHistory').addEventListener('click', () => confirmAction('Clear recently played?', 'Your playback history will be cleared.', () => { Prefs.clearRecent(); showToast('History cleared'); if (currentView === 'recent') renderRecent(); renderHome(); }, 'Clear'));
    $('#btnClearRecent').addEventListener('click', () => $('#btnClearHistory').click());
    $('#btnClearImported').addEventListener('click', () => confirmAction('Clear imported music?', 'All songs you imported from your device will be removed from this browser. This can\'t be undone.', async () => { await LibraryData.clearImported(); showToast('Imported music cleared'); refreshEverything(); updateStorageMeter(); }, 'Clear'));
    $('#btnResetAll').addEventListener('click', () => confirmAction('Reset all application data?', 'This clears playlists, favorites, history and settings, and removes imported music. This can\'t be undone.', async () => { await LibraryData.clearImported(); Prefs.resetAll(); showToast('Application reset'); location.reload(); }, 'Reset'));

    $('#btnExportData').addEventListener('click', () => {
      const data = Prefs.exportData(LibraryData.getAll());
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `zound-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Backup downloaded');
    });
    $('#btnImportData').addEventListener('click', () => $('#importDataInput').click());
    $('#importDataInput').addEventListener('change', async () => {
      const file = $('#importDataInput').files[0];
      $('#importDataInput').value = '';
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        Prefs.importData(data, LibraryData.getAll().map(s => s.id));
        showToast('Backup imported');
        refreshEverything();
        initSettings();
      } catch (err) {
        console.error(err);
        showToast("Couldn't read that backup file.");
      }
    });
  }

  function refreshEverything() {
    renderHome();
    Playlists.renderSidebar();
    Playlists.renderHomeGrid();
    if (currentView === 'all') renderAll();
    else if (currentView === 'favorites') renderFavorites();
    else if (currentView === 'recent') renderRecent();
    else if (currentView === 'artists') renderArtists();
    else if (currentView === 'artist') renderArtistDetail(currentParam);
    else if (currentView === 'albums') renderAlbums();
    else if (currentView === 'album') renderAlbumDetail(currentParam);
    else if (currentView === 'playlists') renderPlaylistsGrid();
    else if (currentView === 'playlist') Playlists.openDetail(Playlists.getActiveId());
  }

  const selectionState = {};
  function selectionFor(tableId) { return selectionState[tableId] || (selectionState[tableId] = new Set()); }

  function updateBulkBar(tableId) {
    const count = selectionFor(tableId).size;
    const bar = document.querySelector(`.bulk-bar[data-target="${tableId}"]`);
    if (bar) { bar.querySelector('.bulk-bar__count').textContent = `${count} selected`; bar.querySelector('.bulk-delete').disabled = count === 0; }
  }
  function onRowCheckboxChange(tableId, songId, checked) {
    const set = selectionFor(tableId);
    if (checked) set.add(songId); else set.delete(songId);
    updateBulkBar(tableId);
  }
  function syncSelectionCheckboxes(tableId) {
    const table = document.getElementById(tableId);
    if (!table || !table.classList.contains('is-select-mode')) return;
    const set = selectionFor(tableId);
    table.querySelectorAll('.song-row').forEach(row => { const cb = row.querySelector('.row-checkbox'); if (cb) cb.checked = set.has(row.dataset.songId); });
    updateBulkBar(tableId);
  }
  function enterSelectMode(tableId) {
    const table = document.getElementById(tableId);
    if (!table) return;
    table.classList.add('is-select-mode');
    selectionFor(tableId).clear();
    updateBulkBar(tableId);
    document.querySelector(`.bulk-bar[data-target="${tableId}"]`)?.classList.remove('hidden');
    document.querySelector(`.btn-select-toggle[data-target="${tableId}"]`)?.classList.add('is-active');
  }
  function exitSelectMode(tableId) {
    const table = document.getElementById(tableId);
    if (!table) return;
    table.classList.remove('is-select-mode');
    selectionFor(tableId).clear();
    table.querySelectorAll('.row-checkbox').forEach(cb => { cb.checked = false; });
    document.querySelector(`.bulk-bar[data-target="${tableId}"]`)?.classList.add('hidden');
    document.querySelector(`.btn-select-toggle[data-target="${tableId}"]`)?.classList.remove('is-active');
  }
  function cancelAllSelections() { $$('.song-table.is-select-mode').forEach(t => exitSelectMode(t.id)); }
  function bulkSelectAll(tableId) {
    const table = document.getElementById(tableId);
    if (!table) return;
    const songs = (table._songs || []).filter(s => !s.isBundled);
    const set = selectionFor(tableId);
    songs.forEach(s => set.add(s.id));
    table.querySelectorAll('.row-checkbox:not(:disabled)').forEach(cb => { cb.checked = true; });
    updateBulkBar(tableId);
  }
  function bulkDeleteSelected(tableId) {
    const ids = Array.from(selectionFor(tableId));
    if (!ids.length) return;
    const n = ids.length;
    confirmAction(`Delete ${n} selected song${n === 1 ? '' : 's'}?`, `They'll be removed from your library, playlists, favorites, and history. This can't be undone.`, async () => {
      await LibraryData.removeManyImported(ids);
      showToast(`Deleted ${n} song${n === 1 ? '' : 's'}`);
      exitSelectMode(tableId);
      refreshEverything();
      updateStorageMeter();
    }, 'Delete');
  }
  function initSelection() {
    $$('.btn-select-toggle').forEach(btn => btn.addEventListener('click', () => {
      const id = btn.dataset.target;
      const table = document.getElementById(id);
      if (table && table.classList.contains('is-select-mode')) exitSelectMode(id); else enterSelectMode(id);
    }));
    $$('.bulk-cancel').forEach(btn => btn.addEventListener('click', () => exitSelectMode(btn.dataset.target)));
    $$('.bulk-select-all').forEach(btn => btn.addEventListener('click', () => bulkSelectAll(btn.dataset.target)));
    $$('.bulk-delete').forEach(btn => btn.addEventListener('click', () => bulkDeleteSelected(btn.dataset.target)));
  }

  function initModals() {
    $('#modalBackdrop').addEventListener('click', closeAllModals);
    $$('[data-close-modal]').forEach(btn => btn.addEventListener('click', closeAllModals));

    $('#btnNewPlaylist').addEventListener('click', () => {
      $('#newPlaylistInput').value = '';
      openModal('modalNewPlaylist');
      $('#newPlaylistInput').focus();
      $('#btnConfirmNewPlaylist').onclick = () => {
        const name = $('#newPlaylistInput').value.trim();
        if (!name) return;
        const p = Playlists.create(name);
        closeAllModals();
        navigateTo('playlist', p.id);
      };
    });
    $('#newPlaylistInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btnConfirmNewPlaylist').click(); });

    $('#btnConfirmAction').addEventListener('click', () => { const cb = confirmCallback; closeAllModals(); if (cb) cb(); });
  }

  async function init() {
    await LibraryData.init();
    Queue.restore();

    const settings = Prefs.getSettings();
    Player.setRepeat(settings.repeatMode);
    updateRepeatUI(settings.repeatMode);
    setShuffle(settings.shuffle);
    applyVolumeUI(Math.min(settings.volume, 100), settings.muted);

    Visualizer.mount($('#npVisualizer'));

    initPlayerBar();
    initImport();
    initSearch();
    initSort();
    initMobileNav();
    initKeyboardShortcuts();
    initSettings();
    initModals();
    initSidebarCollapse();
    initArtwork();
    initSelection();

    $$('.nav__item[data-view]').forEach(btn => btn.addEventListener('click', () => navigateTo(btn.dataset.view)));
    $$('.bottomnav__item[data-view]').forEach(btn => btn.addEventListener('click', () => navigateTo(btn.dataset.view)));

    Playlists.renderSidebar();
    navigateTo('home');
  }

  document.addEventListener('DOMContentLoaded', init);

  return {
    navigateTo, showPreviewHint, onFavoritesChanged, openRowMenu, setShuffle,
    startRenamePlaylist, confirmDeletePlaylist, onRowCheckboxChange, makeReorderable,
  };
})();
