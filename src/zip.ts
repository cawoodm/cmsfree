// .zip writer for the "Download .zip" button: deflate via the browser's CompressionStream, CRC-32, UTF-8 names.
// No storage and no page access, apart from download() clicking a temporary link.

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c
})

function crc32(bytes: Uint8Array): number {
  let c = ~0
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8)
  return ~c >>> 0
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

// One zip archive: { "path/in/zip": text }.
export async function zip(files: Record<string, string>): Promise<Blob> {
  const enc = new TextEncoder()
  const d = new Date()
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  const local: BlobPart[] = []
  const central: BlobPart[] = []
  let offset = 0
  let centralSize = 0
  for (const [path, text] of Object.entries(files)) {
    const name = enc.encode(path)
    const raw = enc.encode(text)
    const data = await deflate(raw)
    const crc = crc32(raw)
    // Local file header (30 bytes) and central directory entry (46 bytes); flag 0x800 = UTF-8 name, method 8 = deflate.
    const l = new DataView(new ArrayBuffer(30))
    l.setUint32(0, 0x04034b50, true)
    l.setUint16(4, 20, true)
    l.setUint16(6, 0x800, true)
    l.setUint16(8, 8, true)
    l.setUint16(10, time, true)
    l.setUint16(12, date, true)
    l.setUint32(14, crc, true)
    l.setUint32(18, data.length, true)
    l.setUint32(22, raw.length, true)
    l.setUint16(26, name.length, true)
    const c = new DataView(new ArrayBuffer(46))
    c.setUint32(0, 0x02014b50, true)
    c.setUint16(4, 20, true)
    c.setUint16(6, 20, true)
    c.setUint16(8, 0x800, true)
    c.setUint16(10, 8, true)
    c.setUint16(12, time, true)
    c.setUint16(14, date, true)
    c.setUint32(16, crc, true)
    c.setUint32(20, data.length, true)
    c.setUint32(24, raw.length, true)
    c.setUint16(28, name.length, true)
    c.setUint32(42, offset, true)
    local.push(l, name as BlobPart, data as BlobPart)
    central.push(c, name as BlobPart)
    offset += 30 + name.length + data.length
    centralSize += 46 + name.length
  }
  const n = Object.keys(files).length
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, n, true)
  end.setUint16(10, n, true)
  end.setUint32(12, centralSize, true)
  end.setUint32(16, offset, true)
  return new Blob([...local, ...central, end], { type: 'application/zip' })
}

// Saves a blob as a file download.
export function download(blob: Blob, name: string): void {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
