// Just enough Parquet to read a flat table (the public model rankings come only as Parquet): the
// footer's Thrift metadata, Snappy or uncompressed pages (v1 and v2), PLAIN and dictionary
// encodings; booleans, int32/64, double and strings. readParquet(buffer, ['a', 'b']) → [{ a, b }, …]
// ponytail: no nested columns, no other codecs (zstd, gzip) or encodings (delta): an error says so.

// Thrift compact protocol: a struct as { fieldId: value }
function thrift(buf, pos) {
  const varint = () => {
    let n = 0n
    let shift = 0n
    for (;;) {
      const b = buf[pos++]
      n |= BigInt(b & 0x7f) << shift
      if (!(b & 0x80)) return n
      shift += 7n
    }
  }
  const zigzag = () => {
    const n = varint()
    return Number((n >> 1n) ^ -(n & 1n))
  }
  const value = (type) => {
    switch (type) {
      case 1:
        return true
      case 2:
        return false
      case 3:
        return buf.readInt8(pos++)
      case 4:
      case 5:
      case 6:
        return zigzag()
      case 7:
        return (pos += 8), buf.readDoubleLE(pos - 8)
      case 8: {
        const len = Number(varint())
        return (pos += len), buf.subarray(pos - len, pos)
      }
      case 9:
      case 10: {
        const head = buf[pos++]
        const size = head >> 4 === 15 ? Number(varint()) : head >> 4
        const t = head & 15
        return Array.from({ length: size }, () => (t === 1 || t === 2 ? buf[pos++] === 1 : value(t)))
      }
      case 12:
        return struct()
      default:
        throw new Error(`parquet: thrift type ${type} not read`)
    }
  }
  const struct = () => {
    const out = {}
    let id = 0
    for (;;) {
      const head = buf[pos++]
      if (!head) return out
      id = head >> 4 ? id + (head >> 4) : zigzag()
      out[id] = value(head & 15)
    }
  }
  const s = struct()
  return { value: s, end: pos }
}

function snappy(src) {
  let pos = 0
  let len = 0
  for (let shift = 0; ; shift += 7) {
    const b = src[pos++]
    len |= (b & 0x7f) << shift
    if (!(b & 0x80)) break
  }
  const out = Buffer.alloc(len)
  let o = 0
  while (pos < src.length) {
    const tag = src[pos++]
    if ((tag & 3) === 0) {
      let n = (tag >> 2) + 1
      if (n > 60) {
        const bytes = n - 60
        n = src.readUIntLE(pos, bytes) + 1
        pos += bytes
      }
      src.copy(out, o, pos, pos + n)
      pos += n
      o += n
      continue
    }
    let n, off
    if ((tag & 3) === 1) (n = ((tag >> 2) & 7) + 4), (off = ((tag >> 5) << 8) | src[pos++])
    else if ((tag & 3) === 2) (n = (tag >> 2) + 1), (off = src.readUInt16LE(pos)), (pos += 2)
    else (n = (tag >> 2) + 1), (off = src.readUInt32LE(pos)), (pos += 4)
    for (let i = 0; i < n; i++, o++) out[o] = out[o - off] // overlapping copies repeat
  }
  return out
}

// RLE / bit-packed hybrid: `count` values of `width` bits
function hybrid(buf, pos, end, width, count) {
  const out = []
  const bytes = Math.ceil(width / 8)
  while (out.length < count && pos < end) {
    let head = 0
    for (let shift = 0; ; shift += 7) {
      const b = buf[pos++]
      head += (b & 0x7f) * 2 ** shift
      if (!(b & 0x80)) break
    }
    if (head & 1) {
      const n = Math.floor(head / 2) * 8
      let bit = 0
      for (let i = 0; i < n; i++) {
        let v = 0
        for (let k = 0; k < width; k++, bit++) v |= ((buf[pos + (bit >> 3)] >> (bit & 7)) & 1) << k
        out.push(v)
      }
      pos += Math.floor(head / 2) * width
    } else {
      const v = bytes ? buf.readUIntLE(pos, bytes) : 0
      pos += bytes
      for (let i = Math.floor(head / 2); i > 0; i--) out.push(v)
    }
  }
  return out.slice(0, count)
}

function plain(buf, type, count) {
  const out = []
  let pos = 0
  for (let i = 0; i < count; i++) {
    if (type === 6) {
      const len = buf.readUInt32LE(pos)
      out.push(buf.toString('utf8', pos + 4, pos + 4 + len))
      pos += 4 + len
    } else if (type === 5) out.push(buf.readDoubleLE(pos)), (pos += 8)
    else if (type === 2) out.push(Number(buf.readBigInt64LE(pos))), (pos += 8)
    else if (type === 1) out.push(buf.readInt32LE(pos)), (pos += 4)
    else if (type === 0) out.push(((buf[i >> 3] >> (i & 7)) & 1) === 1) // bit-packed
    else throw new Error(`parquet: column type ${type} not read`)
  }
  return out
}

function readColumn(file, meta, optional) {
  const type = meta[1]
  const codec = meta[4]
  if (codec !== 0 && codec !== 1) throw new Error(`parquet: codec ${codec} not read (only none and snappy)`)
  const inflate = (b) => (codec === 1 ? snappy(b) : b)
  let pos = Number(meta[11] ?? meta[9])
  const total = Number(meta[5])
  let dict = null
  const out = []
  while (out.length < total) {
    const { value: page, end } = thrift(file, pos)
    const body = file.subarray(end, end + page[3])
    pos = end + page[3]
    if (page[1] === 2) {
      dict = plain(inflate(body), type, page[7][1])
      continue
    }
    let data, n, defs, encoding
    if (page[1] === 0) {
      ;[n, encoding] = [page[5][1], page[5][2]]
      data = inflate(body)
      let at = 0
      if (optional) {
        const len = data.readUInt32LE(0)
        defs = hybrid(data, 4, 4 + len, 1, n)
        at = 4 + len
      }
      data = data.subarray(at)
    } else if (page[1] === 3) {
      const h = page[8]
      ;[n, encoding] = [h[1], h[4]]
      const dl = h[5]
      const rl = h[6]
      if (optional && dl) defs = hybrid(body, rl, rl + dl, 1, n)
      data = h[7] === false ? body.subarray(rl + dl) : inflate(body.subarray(rl + dl))
    } else continue // index pages and the like
    const present = defs ? defs.filter((d) => d === 1).length : n
    const values = encoding === 0 ? plain(data, type, present) : encoding === 2 || encoding === 8 ? hybrid(data, 1, data.length, data[0], present).map((i) => dict[i]) : null
    if (!values) throw new Error(`parquet: encoding ${encoding} not read`)
    let k = 0
    for (let i = 0; i < n; i++) out.push(!defs || defs[i] === 1 ? values[k++] : null)
  }
  return out
}

export function readParquet(file, columns) {
  if (file.toString('latin1', file.length - 4) !== 'PAR1') throw new Error('not a Parquet file')
  const len = file.readUInt32LE(file.length - 8)
  const { value: meta } = thrift(file, file.length - 8 - len)
  const schema = meta[2].slice(1) // the root first, then a flat table's columns
  const rows = []
  for (const group of meta[4]) {
    const cols = {}
    for (const chunk of group[1]) {
      const name = chunk[3][3].map((b) => b.toString()).join('.')
      if (!columns.includes(name)) continue
      const el = schema.find((e) => e[4].toString() === name)
      cols[name] = readColumn(file, chunk[3], el?.[3] === 1)
    }
    const n = Number(group[3])
    for (let i = 0; i < n; i++) rows.push(Object.fromEntries(columns.map((c) => [c, cols[c]?.[i] ?? null])))
  }
  return rows
}
