const Queue = (() => {
  let items = []; // array of song ids
  const listeners = [];

  function persist() { Prefs.saveQueue(items); }
  function notify() { listeners.forEach(fn => fn(items.slice())); }

  function restore() {
    items = (Prefs.getQueue() || []).filter(id => LibraryData.getById(id));
  }

  return {
    onChange(fn) { listeners.push(fn); },
    restore,
    get items() { return items.slice(); },
    get length() { return items.length; },

    add(songId) {
      items.push(songId);
      persist(); notify();
    },
    addMany(songIds) {
      items.push(...songIds);
      persist(); notify();
    },
    playNext(songId) {
      items.unshift(songId);
      persist(); notify();
    },
    /** Pull the next id off the front of the queue (used by the Player). */
    shift() {
      const id = items.shift();
      persist(); notify();
      return id;
    },
    removeAt(index) {
      if (index < 0 || index >= items.length) return;
      items.splice(index, 1);
      persist(); notify();
    },
    reorder(fromIndex, toIndex) {
      if (fromIndex === toIndex) return;
      const [moved] = items.splice(fromIndex, 1);
      items.splice(toIndex, 0, moved);
      persist(); notify();
    },
    clear() {
      items = [];
      persist(); notify();
    },
    /** Build a plain song list — used to render the Queue panel and to
     *  save the queue as a playlist. */
    songs() { return items.map(id => LibraryData.getById(id)).filter(Boolean); },
  };
})();
