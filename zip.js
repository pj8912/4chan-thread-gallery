(function () {
  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let value = n;
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      table[n] = value >>> 0;
    }
    return table;
  })();

  function crc32(data) {
    let crc = 0xffffffff;
    for (let index = 0; index < data.length; index += 1) {
      crc = CRC_TABLE[(crc ^ data[index]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function getDosDateTime(date) {
    const year = Math.max(1980, date.getFullYear());
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const seconds = Math.floor(date.getSeconds() / 2);

    return {
      time: (hours << 11) | (minutes << 5) | seconds,
      date: ((year - 1980) << 9) | (month << 5) | day
    };
  }

  function build(files, options = {}) {
    const encoder = new TextEncoder();
    const parts = [];
    const entries = [];
    const stamp = getDosDateTime(options.date instanceof Date ? options.date : new Date());
    let offset = 0;

    for (const file of files) {
      const name = String(file.name || "image");
      const nameBytes = encoder.encode(name);
      const data = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data);

      if (data.length > 0xfffffffe) {
        throw new Error(`File is too large for this ZIP: ${name}`);
      }

      if (nameBytes.length > 0xffff) {
        throw new Error(`File name is too long: ${name}`);
      }

      const checksum = crc32(data);
      const localHeader = new Uint8Array(30 + nameBytes.length);
      const localView = new DataView(localHeader.buffer);

      localView.setUint32(0, 0x04034b50, true);
      localView.setUint16(4, 20, true);
      localView.setUint16(6, 0x0800, true);
      localView.setUint16(8, 0, true);
      localView.setUint16(10, stamp.time, true);
      localView.setUint16(12, stamp.date, true);
      localView.setUint32(14, checksum, true);
      localView.setUint32(18, data.length, true);
      localView.setUint32(22, data.length, true);
      localView.setUint16(26, nameBytes.length, true);
      localView.setUint16(28, 0, true);
      localHeader.set(nameBytes, 30);

      parts.push(localHeader, data);
      entries.push({
        nameBytes,
        checksum,
        size: data.length,
        offset
      });

      offset += localHeader.length + data.length;
    }

    const centralStart = offset;

    for (const entry of entries) {
      const centralHeader = new Uint8Array(46 + entry.nameBytes.length);
      const centralView = new DataView(centralHeader.buffer);

      centralView.setUint32(0, 0x02014b50, true);
      centralView.setUint16(4, 20, true);
      centralView.setUint16(6, 20, true);
      centralView.setUint16(8, 0x0800, true);
      centralView.setUint16(10, 0, true);
      centralView.setUint16(12, stamp.time, true);
      centralView.setUint16(14, stamp.date, true);
      centralView.setUint32(16, entry.checksum, true);
      centralView.setUint32(20, entry.size, true);
      centralView.setUint32(24, entry.size, true);
      centralView.setUint16(28, entry.nameBytes.length, true);
      centralView.setUint16(30, 0, true);
      centralView.setUint16(32, 0, true);
      centralView.setUint16(34, 0, true);
      centralView.setUint16(36, 0, true);
      centralView.setUint32(38, 0, true);
      centralView.setUint32(42, entry.offset, true);
      centralHeader.set(entry.nameBytes, 46);

      parts.push(centralHeader);
      offset += centralHeader.length;
    }

    const centralSize = offset - centralStart;
    const endRecord = new Uint8Array(22);
    const endView = new DataView(endRecord.buffer);

    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(4, 0, true);
    endView.setUint16(6, 0, true);
    endView.setUint16(8, entries.length, true);
    endView.setUint16(10, entries.length, true);
    endView.setUint32(12, centralSize, true);
    endView.setUint32(16, centralStart, true);
    endView.setUint16(20, 0, true);

    parts.push(endRecord);

    return {
      parts,
      entries: entries.length,
      size: offset + endRecord.length
    };
  }

  globalThis.FourChanZip = { build, crc32 };
})();
