import { Transform } from 'node:stream';

// Node's Zstandard decoder can accept truncated input. Check frame boundaries
// before decoding; leave block decoding and checksum verification to Node.
// Format: https://github.com/facebook/zstd/blob/dev/doc/zstd_compression_format.md
export function createZstdFrameGuard() {
  let frames = 0;
  function invalid() { throw Object.assign(new Error('Incomplete or invalid Zstandard frame.'), { code: 'INVALID_ZSTD_FRAME' }); }
  function* fields() {
    for (;;) {
      const magic = (yield { size: 4, capture: true, boundary: true }).readUInt32LE();
      if (magic >= 0x184D2A50 && magic <= 0x184D2A5F) {
        const size = (yield { size: 4, capture: true }).readUInt32LE();
        if (size) yield { size };
      } else {
        if (magic !== 0xFD2FB528) invalid();
        const descriptor = (yield { size: 1, capture: true })[0];
        if (descriptor & 8) invalid();
        const single = Boolean(descriptor & 32);
        const contentSize = [single ? 1 : 0, 2, 4, 8][descriptor >> 6];
        const headerSize = (single ? 0 : 1) + [0, 1, 2, 4][descriptor & 3] + contentSize;
        if (headerSize) yield { size: headerSize };
        let last;
        do {
          const block = (yield { size: 3, capture: true }).readUIntLE(0, 3);
          last = Boolean(block & 1);
          const type = (block >> 1) & 3;
          const size = block >> 3;
          if (type === 3 || size > 131072) invalid();
          const bytes = type === 1 ? 1 : size;
          if (bytes) yield { size: bytes };
        } while (!last);
        if (descriptor & 4) yield { size: 4 };
      }
      frames += 1;
    }
  }
  const parser = fields();
  let field = parser.next().value;
  let filled = 0;
  const header = Buffer.alloc(4);
  return new Transform({
    transform(chunk, encoding, callback) {
      try {
        let offset = 0;
        while (offset < chunk.length) {
          const length = Math.min(field.size - filled, chunk.length - offset);
          if (field.capture) chunk.copy(header, filled, offset, offset + length);
          offset += length; filled += length;
          if (filled === field.size) {
            field = parser.next(field.capture ? header.subarray(0, field.size) : undefined).value;
            filled = 0;
          }
        }
        callback(null, chunk);
      } catch (error) { callback(error); }
    },
    flush(callback) {
      try { if (!frames || filled || !field.boundary) invalid(); callback(); }
      catch (error) { callback(error); }
    },
  });
}
