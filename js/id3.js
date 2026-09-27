const ID3 = (() => {

  function readSyncSafeInt(bytes) {
    // ID3v2 sizes are "synchsafe": 4 bytes, 7 significant bits each.
    return (bytes[0] << 21) | (bytes[1] << 14) | (bytes[2] << 7) | bytes[3];
  }

  function decodeText(bytes) {
    if (!bytes.length) return '';
    const encodingByte = bytes[0];
    const body = bytes.subarray(1);
    try {
      if (encodingByte === 1 || encodingByte === 2) {
        // UTF-16 (with or without BOM)
        return new TextDecoder('utf-16').decode(body).replace(/\u0000/g, '').trim();
      }
      // 0 = ISO-8859-1, 3 = UTF-8
      return new TextDecoder(encodingByte === 3 ? 'utf-8' : 'iso-8859-1').decode(body)
        .replace(/\u0000/g, '').trim();
    } catch {
      return '';
    }
  }

  async function parse(file) {
    try {
      // ID3v2 tags live at the start of the file; 512KB comfortably covers
      // typical tag sizes (including embedded album art) without reading
      // the whole track into memory.
      const headSlice = await file.slice(0, 512 * 1024).arrayBuffer();
      const bytes = new Uint8Array(headSlice);

      if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return null; // "ID3"

      const majorVersion = bytes[3];
      const tagSize = readSyncSafeInt(bytes.subarray(6, 10));
      const hasExtHeader = (bytes[5] & 0x40) !== 0;
      let offset = 10;

      if (hasExtHeader) {
        const extSize = majorVersion >= 4
          ? readSyncSafeInt(bytes.subarray(offset, offset + 4))
          : new DataView(bytes.buffer).getUint32(offset);
        offset += extSize;
      }

      const tagEnd = Math.min(10 + tagSize, bytes.length);
      const result = { title: null, artist: null, album: null, picture: null };

      while (offset < tagEnd - 10) {
        const frameId = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
        if (!/^[A-Z0-9]{4}$/.test(frameId)) break; // padding / garbage reached

        const frameSize = majorVersion >= 4
          ? readSyncSafeInt(bytes.subarray(offset + 4, offset + 8))
          : new DataView(bytes.buffer).getUint32(offset + 4);
        const frameStart = offset + 10;
        const frameEnd = frameStart + frameSize;
        if (frameSize <= 0 || frameEnd > bytes.length) break;

        const frameBytes = bytes.subarray(frameStart, frameEnd);

        if (frameId === 'TIT2') result.title = decodeText(frameBytes);
        else if (frameId === 'TPE1') result.artist = decodeText(frameBytes);
        else if (frameId === 'TALB') result.album = decodeText(frameBytes);
        else if (frameId === 'APIC' && !result.picture) {
          result.picture = parseApic(frameBytes);
        }

        offset = frameEnd;
      }

      return result;
    } catch {
      return null;
    }
  }

  function parseApic(bytes) {
    try {
      const encoding = bytes[0];
      let i = 1;
      let mime = '';
      while (bytes[i] !== 0 && i < bytes.length) { mime += String.fromCharCode(bytes[i]); i++; }
      i++; // skip null terminator
      i++; // skip picture type byte
      // skip description (null-terminated, possibly UTF-16 double-null)
      if (encoding === 1 || encoding === 2) {
        while (i < bytes.length - 1 && !(bytes[i] === 0 && bytes[i + 1] === 0)) i += 2;
        i += 2;
      } else {
        while (i < bytes.length && bytes[i] !== 0) i++;
        i += 1;
      }
      const imgBytes = bytes.subarray(i);
      if (!imgBytes.length || !mime.startsWith('image')) return null;
      const blob = new Blob([imgBytes], { type: mime || 'image/jpeg' });
      return { url: URL.createObjectURL(blob), blob, mime };
    } catch {
      return null;
    }
  }

  return { parse };
})();
