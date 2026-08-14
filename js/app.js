const App = (() => {
  let currentView = 'home';
  let lastListView = 'all';   // where to return to when a search is cleared
  let openMenuEl = null;      // the currently-open "more" row menu, if any
  let isSeeking = false;
  let confirmCallback = null;
  let songInfoCurrentSong = null;

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  /* ---------------------------------------------------------------------
   * Toast + modal helpers (shared plumbing used all over the app)
   * ------------------------------------------------------------------- */
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

  /* ---------------------------------------------------------------------
   * Navigation
   * ------------------------------------------------------------------- */
  const VIEW_TITLES = { home: 'Home', all: 'All Songs', recent: 'Recently Played', favorites: 'Favorites', search: 'Search', settings: 'Settings', playlist: '' };

  function navigateTo(view, param) {
    currentView = view;
    if (view !== 'search') lastListView = (view === 'playlist') ? lastListView : view;

    $$('.view').forEach(v => v.classList.remove('is-active'));
    document.getElementById('view-' + view).classList.add('is-active');

    $$('.nav__item[data-view]').forEach(b => b.classList.toggle('is-active', b.dataset.view === view));
    $('#viewTitle').textContent = view === 'playlist' ? '' : VIEW_TITLES[view];
    $('#mheaderTitle').textContent = view === 'playlist' ? 'Playlist' : (VIEW_TITLES[view] || 'Zound');

    closeMobileSidebar();
    closeRowMenu();
    cancelAllSelections();

    if (view === 'home') renderHome();
    else if (view === 'all') renderAll();
    else if (view === 'recent') renderRecent();
    else if (view === 'favorites') renderFavorites();
    else if (view === 'playlist') Playlists.openDetail(param);
  }

  /* ---------------------------------------------------------------------
   * View renderers
   * ------------------------------------------------------------------- */
  function renderHome() {
    const all = LibraryData.getAll();
    const empty = $('#homeEmpty'), content = $('#homeContent');
    if (!all.length) { empty.classList.remove('hidden'); content.classList.add('hidden'); return; }
    empty.classList.add('hidden'); content.classList.remove('hidden');

    SongUI.renderGrid($('#recentAddedGrid'), LibraryData.getRecentlyAdded(10), (song) => Player.resumeOrPlay(song, LibraryData.getAll()));
    const recentPlayed = LibraryData.getRecentlyPlayed().slice(0, 10);
    if (recentPlayed.length) {
      $('#recentPlayedGrid').closest('.home-row').classList.remove('hidden');
      SongUI.renderGrid($('#recentPlayedGrid'), recentPlayed, (song) => Player.resumeOrPlay(song, recentPlayed));
    } else {
      $('#recentPlayedGrid').closest('.home-row').classList.add('hidden');
    }
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
      onPlay: (song) => Player.resumeOrPlay(song, list),
    });
    syncSelectionCheckboxes('allSongsTable');
  }

  function renderRecent() {
    const list = LibraryData.getRecentlyPlayed();
    $('#recentCount').textContent = `${list.length} song${list.length === 1 ? '' : 's'}`;
    SongUI.renderTable($('#recentTable'), list, {
      emptyText: 'Nothing played yet — your history will show up here.',
      onPlay: (song) => Player.resumeOrPlay(song, list),
    });
  }

  function renderFavorites() {
    const list = LibraryData.getFavorites();
    $('#favCount').textContent = `${list.length} song${list.length === 1 ? '' : 's'}`;
    SongUI.renderTable($('#favoritesTable'), list, {
      emptyText: 'Favorite a song to see it here.',
      onPlay: (song) => Player.resumeOrPlay(song, list),
    });
    syncSelectionCheckboxes('favoritesTable');
    $('#btnPlayFavorites').onclick = () => { if (list.length) Player.playSong(list[0], list); };
    $('#btnShuffleFavorites').onclick = () => {
      if (!list.length) return;
      if (!Player.shuffleOn) setShuffle(true);
      Player.playSong(list[Math.floor(Math.random() * list.length)], list);
    };
  }

  function renderSearch(query) {
    const list = LibraryData.search(query);
    $('#searchCount').textContent = `${list.length} result${list.length === 1 ? '' : 's'}`;
    SongUI.renderTable($('#searchTable'), list, {
      emptyText: `No matches for "${query}".`,
      onPlay: (song) => Player.resumeOrPlay(song, list),
    });
  }

  function onFavoritesChanged() {
    if (currentView === 'favorites') renderFavorites();
    if (Player.current) $('#btnNowFav').classList.toggle('is-fav', Prefs.isFavorite(Player.current.id));
  }

  /* ---------------------------------------------------------------------
   * Row "more" menu (add to playlist / song info / remove / delete)
   * ------------------------------------------------------------------- */
  function closeRowMenu() {
    if (openMenuEl) { openMenuEl.remove(); openMenuEl = null; }
    $$('.song-row.is-menu-open').forEach(r => r.classList.remove('is-menu-open'));
  }

  function openRowMenu(anchorBtn, song, { row, playlistId }) {
    const alreadyOpenForThisRow = openMenuEl && row.contains(openMenuEl);
    closeRowMenu();
    if (alreadyOpenForThisRow) return;

    row.classList.add('is-menu-open');
    const menu = document.createElement('div');
    menu.className = 'row-menu';
    menu.innerHTML = `
      <button data-act="add">Add to playlist</button>
      ${playlistId ? `<button data-act="remove">Remove from this playlist</button>` : ''}
      <button data-act="info">Song info</button>
      ${!song.isBundled ? `<button data-act="artwork">Change artwork</button>` : ''}
      ${!song.isBundled ? `<div class="row-menu__divider"></div><button data-act="delete" class="danger">Delete from library</button>` : ''}
    `;
    row.appendChild(menu);
    openMenuEl = menu;

    menu.querySelector('[data-act="add"]').addEventListener('click', () => { closeRowMenu(); openAddToPlaylist(song); });
    menu.querySelector('[data-act="info"]').addEventListener('click', () => { closeRowMenu(); openSongInfo(song); });
    const artworkBtn = menu.querySelector('[data-act="artwork"]');
    if (artworkBtn) artworkBtn.addEventListener('click', () => { closeRowMenu(); promptArtworkChange(song); });
    const removeBtn = menu.querySelector('[data-act="remove"]');
    if (removeBtn) removeBtn.addEventListener('click', () => { closeRowMenu(); Playlists.removeSong(playlistId, song.id); showToast('Removed from playlist'); });
    const delBtn = menu.querySelector('[data-act="delete"]');
    if (delBtn) delBtn.addEventListener('click', () => {
      closeRowMenu();
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
      ['Added', song.dateAdded ? new Date(song.dateAdded).toLocaleDateString() : '—'],
    ];
    $('#songInfoBody').innerHTML = rows.map(([k, v]) => `<div class="song-info__row"><span>${k}</span><span></span></div>`).join('');
    $$('#songInfoBody .song-info__row span:last-child').forEach((el, i) => { el.textContent = rows[i][1]; });
    openModal('modalSongInfo');
  }

  /* ---------------------------------------------------------------------
   * Manual album artwork
   * ------------------------------------------------------------------- */
  let artworkTargetSong = null;
  function promptArtworkChange(song) {
    if (song.isBundled) { showToast("Bundled songs can't have custom artwork — edit MUSIC_LIBRARY in library.js instead."); return; }
    artworkTargetSong = song;
    $('#artworkInput').click();
  }
  function initArtwork() {
    $('#artworkInput').addEventListener('change', async () => {
      const file = $('#artworkInput').files[0];
      $('#artworkInput').value = '';
      if (!file || !artworkTargetSong) return;
      if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
        showToast('Please choose a JPG, PNG, or WEBP image.');
        return;
      }
      const ok = await LibraryData.setArtwork(artworkTargetSong.id, file);
      if (!ok) { showToast('Could not update artwork.'); return; }
      showToast('Artwork updated');
      if (Player.current && Player.current.id === artworkTargetSong.id) renderNowPlaying(Player.current);
      if (songInfoCurrentSong && songInfoCurrentSong.id === artworkTargetSong.id) openSongInfo(artworkTargetSong);
      refreshEverything();
      artworkTargetSong = null;
    });
    $('#btnChangeArtwork').addEventListener('click', () => {
      if (songInfoCurrentSong) promptArtworkChange(songInfoCurrentSong);
    });
  }

  function refreshCurrentView() {
    if (currentView === 'playlist') Playlists.openDetail(Playlists.getActiveId());
    else navigateTo(currentView);
  }

  /* ---------------------------------------------------------------------
   * Playlist rename / delete (invoked from Playlists module)
   * ------------------------------------------------------------------- */
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

  /* ---------------------------------------------------------------------
   * Player bar wiring
   * ------------------------------------------------------------------- */
  function fillPercent(el, pct) { el.style.backgroundSize = `${Math.min(Math.max(pct, 0), 100)}%`; }

  function renderNowPlaying(song) {
    $('#nowTitle').textContent = song.title;
    $('#nowArtist').textContent = song.artist;
    $('#playerArt').innerHTML = SongUI.artInner(song);
    $('#btnNowFav').classList.toggle('is-fav', Prefs.isFavorite(song.id));
    document.title = `${song.title} · ${song.artist} — Zound`;
    SongUI.refreshPlayingState();
  }

  function setShuffle(on) {
    Player.setShuffle(on);
    $('#btnShuffle').classList.toggle('is-active', on);
  }
  function updateRepeatUI(mode) {
    $('#btnRepeat').classList.toggle('is-active', mode !== 'off');
    $('#repeatOneBadge').classList.toggle('hidden', mode !== 'one');
  }

  function applyVolumeUI(percent, muted) {
    $('#volumeBar').value = percent;
    $('#volumeValue').textContent = muted ? 'Muted' : `${Math.round(percent)}%`;
    fillPercent($('#volumeBar'), percent);
    $('#btnMute').classList.toggle('is-active', muted);
  }

  function initPlayerBar() {
    Player.on('songChange', (song) => { renderNowPlaying(song); Prefs.pushRecent(song.id); });
    Player.on('playState', (state) => {
      $('#iconPlay').classList.toggle('hidden', state.playing);
      $('#iconPause').classList.toggle('hidden', !state.playing);
      if (state.error) showToast(state.error);
      SongUI.refreshPlayingState();
    });
    Player.on('time', ({ current, duration }) => {
      $('#curTime').textContent = formatDuration(current);
      $('#durTime').textContent = formatDuration(duration);
      if (!isSeeking) {
        const pct = duration ? (current / duration) * 100 : 0;
        $('#seekBar').value = pct;
        fillPercent($('#seekBar'), pct);
      }
    });
    Player.on('ended', () => { $('#iconPlay').classList.remove('hidden'); $('#iconPause').classList.add('hidden'); });

    $('#btnPlay').addEventListener('click', () => Player.toggle());
    $('#btnNext').addEventListener('click', () => Player.next(true));
    $('#btnPrev').addEventListener('click', () => Player.prev());
    $('#btnShuffle').addEventListener('click', () => setShuffle(!Player.shuffleOn));
    $('#btnRepeat').addEventListener('click', () => updateRepeatUI(Player.cycleRepeat()));
    $('#btnNowFav').addEventListener('click', () => {
      if (!Player.current) return;
      const nowFav = Prefs.toggleFavorite(Player.current.id);
      $('#btnNowFav').classList.toggle('is-fav', nowFav);
      onFavoritesChanged();
    });
    $('#btnQueue').addEventListener('click', () => { if (Player.current) openSongInfo(Player.current); });

    // Seek bar: drag scrubs the position; commit on release so we don't
    // fight the real-time 'timeupdate' events while the user is dragging.
    const seekBar = $('#seekBar');
    seekBar.addEventListener('input', () => { isSeeking = true; fillPercent(seekBar, seekBar.value); });
    seekBar.addEventListener('change', () => {
      const duration = Player.audioElement.duration || 0;
      Player.seekTo((seekBar.value / 100) * duration);
      isSeeking = false;
    });

    // Volume: plain 0–100%, applied directly to the audio element.
    const volumeBar = $('#volumeBar');
    volumeBar.addEventListener('input', () => {
      const val = Number(volumeBar.value);
      Prefs.saveSettings({ volume: val, muted: false });
      Player.setVolumePercent(val, false);
      applyVolumeUI(val, false);
    });
    $('#btnMute').addEventListener('click', () => {
      const settings = Prefs.saveSettings({ muted: !Prefs.getSettings().muted });
      Player.setVolumePercent(settings.volume, settings.muted);
      applyVolumeUI(settings.volume, settings.muted);
    });
  }

  /* ---------------------------------------------------------------------
   * Import: file picker + drag & drop
   * ------------------------------------------------------------------- */
  async function handleFiles(fileList) {
    if (!fileList || !fileList.length) return;
    showToast(`Importing ${fileList.length} file${fileList.length === 1 ? '' : 's'}…`);
    const { added, failed } = await LibraryData.addFiles(fileList);
    if (added.length) showToast(`Added ${added.length} song${added.length === 1 ? '' : 's'} to your library`);
    if (failed.length) showToast(failed[0].reason || "Some files couldn't be imported.");
    renderHome();
    if (currentView === 'all') renderAll();
    Playlists.renderSidebar();
  }

  function initImport() {
    const fileInput = $('#fileInput');
    const trigger = () => fileInput.click();
    $('#btnImport').addEventListener('click', trigger);
    $('#btnMobileImport').addEventListener('click', trigger);
    $('#btnImportHero').addEventListener('click', trigger);
    $('#btnImportTop').addEventListener('click', trigger);
    fileInput.addEventListener('change', () => { handleFiles(fileInput.files); fileInput.value = ''; });

    // Drag & drop, with a counter so nested dragenter/leave events (which
    // fire for every child element) don't flicker the overlay.
    let dragCounter = 0;
    const dropzone = $('#dropzone');
    ['dragenter'].forEach(evt => window.addEventListener(evt, (e) => {
      e.preventDefault();
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
      dragCounter++;
      dropzone.classList.add('is-active');
    }));
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('dragleave', (e) => {
      dragCounter = Math.max(0, dragCounter - 1);
      if (dragCounter === 0) dropzone.classList.remove('is-active');
    });
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      dragCounter = 0;
      dropzone.classList.remove('is-active');
      if (e.dataTransfer && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
    });
  }

  /* ---------------------------------------------------------------------
   * Search, sort, mobile sidebar, keyboard shortcuts
   * ------------------------------------------------------------------- */
  function initSearch() {
    const input = $('#searchInput');
    input.addEventListener('input', () => {
      const q = input.value;
      if (q.trim()) {
        currentView = 'search';
        $$('.view').forEach(v => v.classList.remove('is-active'));
        $('#view-search').classList.add('is-active');
        $$('.nav__item[data-view]').forEach(b => b.classList.remove('is-active'));
        $('#viewTitle').textContent = 'Search';
        $('#mheaderTitle').textContent = 'Search';
        renderSearch(q);
      } else {
        navigateTo(lastListView === 'search' ? 'all' : lastListView);
      }
    });
  }
  function initSort() { $('#sortSelect').addEventListener('change', renderAll); }

  function openMobileSidebar() { $('#sidebar').classList.add('is-open'); $('#scrim').classList.add('is-visible'); }
  function closeMobileSidebar() { $('#sidebar').classList.remove('is-open'); $('#scrim').classList.remove('is-visible'); }
  function initMobileNav() {
    $('#btnMenu').addEventListener('click', openMobileSidebar);
    $('#scrim').addEventListener('click', closeMobileSidebar);
  }

  /** Collapsible sidebar: shrinks to an icon-only rail so the library can
   *  use the full width of wide screens, with the choice remembered. */
  function initSidebarCollapse() {
    const collapsed = Prefs.getSettings().sidebarCollapsed;
    $('#app').classList.toggle('sidebar-collapsed', collapsed);
    $('#btnCollapseSidebar').addEventListener('click', () => {
      const nowCollapsed = !$('#app').classList.contains('sidebar-collapsed');
      $('#app').classList.toggle('sidebar-collapsed', nowCollapsed);
      Prefs.saveSettings({ sidebarCollapsed: nowCollapsed });
      $('#btnCollapseSidebar').setAttribute('aria-label', nowCollapsed ? 'Expand sidebar' : 'Collapse sidebar');
      $('#btnCollapseSidebar').title = nowCollapsed ? 'Expand sidebar' : 'Collapse sidebar';
    });
  }

  function initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea' || e.target.isContentEditable) return;
      switch (e.key) {
        case ' ':
          e.preventDefault(); Player.toggle(); break;
        case 'ArrowRight':
          if (e.shiftKey) Player.next(true); else Player.seekTo(Math.min(Player.audioElement.currentTime + 5, Player.audioElement.duration || 0));
          break;
        case 'ArrowLeft':
          if (e.shiftKey) Player.prev(); else Player.seekTo(Math.max(Player.audioElement.currentTime - 5, 0));
          break;
        case 'ArrowUp': {
          e.preventDefault();
          const v = Math.min(Number($('#volumeBar').value) + 5, Number($('#volumeBar').max));
          $('#volumeBar').value = v; $('#volumeBar').dispatchEvent(new Event('input'));
          break;
        }
        case 'ArrowDown': {
          e.preventDefault();
          const v = Math.max(Number($('#volumeBar').value) - 5, 0);
          $('#volumeBar').value = v; $('#volumeBar').dispatchEvent(new Event('input'));
          break;
        }
        case 'm': case 'M': $('#btnMute').click(); break;
        case 's': case 'S': setShuffle(!Player.shuffleOn); break;
        case 'r': case 'R': updateRepeatUI(Player.cycleRepeat()); break;
      }
    });
  }

  /* ---------------------------------------------------------------------
   * Settings view
   * ------------------------------------------------------------------- */
  function initSettings() {
    const settings = Prefs.getSettings();
    $('#previewToggle').checked = settings.previewEnabled;
    $('#previewToggle').addEventListener('change', (e) => Prefs.saveSettings({ previewEnabled: e.target.checked }));

    $('#btnClearHistory').addEventListener('click', () => confirmAction('Clear recently played?', 'Your playback history will be cleared.', () => { Prefs.clearRecent(); showToast('History cleared'); if (currentView === 'recent') renderRecent(); renderHome(); }, 'Clear'));
    $('#btnClearRecent').addEventListener('click', () => $('#btnClearHistory').click());
    $('#btnClearImported').addEventListener('click', () => confirmAction('Clear imported music?', 'All songs you imported from your device will be removed from this browser. This can\'t be undone.', async () => { await LibraryData.clearImported(); showToast('Imported music cleared'); refreshEverything(); }, 'Clear'));
    $('#btnResetAll').addEventListener('click', () => confirmAction('Reset all application data?', 'This clears playlists, favorites, history and settings, and removes imported music. This can\'t be undone.', async () => { await LibraryData.clearImported(); Prefs.resetAll(); showToast('Application reset'); location.reload(); }, 'Reset'));
  }

  function refreshEverything() {
    renderHome();
    Playlists.renderSidebar();
    Playlists.renderHomeGrid();
    if (currentView === 'all') renderAll();
    if (currentView === 'favorites') renderFavorites();
    if (currentView === 'recent') renderRecent();
    if (currentView === 'playlist') Playlists.openDetail(Playlists.getActiveId());
  }

  /* ---------------------------------------------------------------------
   * Multi-select + bulk delete (All Songs, Favorites)
   * ------------------------------------------------------------------- */
  const selectionState = {}; // tableId -> Set of selected song ids
  function selectionFor(tableId) { return selectionState[tableId] || (selectionState[tableId] = new Set()); }

  function updateBulkBar(tableId) {
    const count = selectionFor(tableId).size;
    const bar = document.querySelector(`.bulk-bar[data-target="${tableId}"]`);
    if (bar) {
      bar.querySelector('.bulk-bar__count').textContent = `${count} selected`;
      bar.querySelector('.bulk-delete').disabled = count === 0;
    }
  }

  function onRowCheckboxChange(tableId, songId, checked) {
    const set = selectionFor(tableId);
    if (checked) set.add(songId); else set.delete(songId);
    updateBulkBar(tableId);
  }

  /** Re-render (e.g. re-sorting) replaces row DOM nodes, which resets their
   *  checkboxes to unchecked — this re-applies whatever was actually still
   *  selected in selectionState so the UI doesn't silently drift out of
   *  sync with what "Delete Selected" would actually act on. */
  function syncSelectionCheckboxes(tableId) {
    const table = document.getElementById(tableId);
    if (!table || !table.classList.contains('is-select-mode')) return;
    const set = selectionFor(tableId);
    table.querySelectorAll('.song-row').forEach(row => {
      const cb = row.querySelector('.row-checkbox');
      if (cb) cb.checked = set.has(row.dataset.songId);
    });
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
  function cancelAllSelections() {
    $$('.song-table.is-select-mode').forEach(t => exitSelectMode(t.id));
  }

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
    confirmAction(`Delete ${n} selected song${n === 1 ? '' : 's'}?`,
      `They'll be removed from your library, playlists, favorites, and history. This can't be undone.`,
      async () => {
        await LibraryData.removeManyImported(ids);
        showToast(`Deleted ${n} song${n === 1 ? '' : 's'}`);
        exitSelectMode(tableId);
        refreshEverything();
      }, 'Delete');
  }

  function initSelection() {
    $$('.btn-select-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.target;
        const table = document.getElementById(id);
        if (table && table.classList.contains('is-select-mode')) exitSelectMode(id);
        else enterSelectMode(id);
      });
    });
    $$('.bulk-cancel').forEach(btn => btn.addEventListener('click', () => exitSelectMode(btn.dataset.target)));
    $$('.bulk-select-all').forEach(btn => btn.addEventListener('click', () => bulkSelectAll(btn.dataset.target)));
    $$('.bulk-delete').forEach(btn => btn.addEventListener('click', () => bulkDeleteSelected(btn.dataset.target)));
  }

  /* ---------------------------------------------------------------------
   * Modals: generic open/close plumbing + new-playlist flow
   * ------------------------------------------------------------------- */
  function initModals() {
    $('#modalBackdrop').addEventListener('click', closeAllModals);
    $$('[data-close-modal]').forEach(btn => btn.addEventListener('click', closeAllModals));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAllModals(); });

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

    $('#btnConfirmAction').addEventListener('click', () => {
      const cb = confirmCallback;
      closeAllModals();
      if (cb) cb();
    });
  }

  /* ---------------------------------------------------------------------
   * Boot
   * ------------------------------------------------------------------- */
  async function init() {
    await LibraryData.init();

    const settings = Prefs.getSettings();
    Player.setRepeat(settings.repeatMode);
    updateRepeatUI(settings.repeatMode);
    setShuffle(settings.shuffle);
    applyVolumeUI(Math.min(settings.volume, 100), settings.muted);

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

    Playlists.renderSidebar();
    navigateTo('home');
  }

  document.addEventListener('DOMContentLoaded', init);

  return {
    navigateTo, showPreviewHint, onFavoritesChanged, openRowMenu, setShuffle,
    startRenamePlaylist, confirmDeletePlaylist, onRowCheckboxChange,
  };
})();
