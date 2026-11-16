/**
 * 词元开物: the names a font file gives itself, read from its `name` table the way the desktop app
 * reads installed fonts (`desktop/src/fonts/names.rs`): the typographic family and subfamily
 * first, then the legacy ones; Windows English records first, then Mac English, then the rest.
 * Also the license text and address the font carries, which say whether it may be used commercially.
 */

export type FontNames = {
  family: string
  style: string
  license: string | null
  licenseURL: string | null
}

const FAMILY = 1
const SUBFAMILY = 2
const LICENSE = 13
const LICENSE_URL = 14
const TYPOGRAPHIC_FAMILY = 16
const TYPOGRAPHIC_SUBFAMILY = 17

type NameRecord = { platform: number; encoding: number; language: number; id: number; text: string }

function tag(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3)
  )
}

function decodeName(bytes: Uint8Array, platform: number, encoding: number): string {
  // Windows and Unicode records are UTF-16BE; Mac Roman records are close enough to Latin-1.
  if (platform === 0 || platform === 3) {
    let text = ''
    for (let index = 0; index + 1 < bytes.length; index += 2) {
      text += String.fromCharCode(((bytes[index] ?? 0) << 8) | (bytes[index + 1] ?? 0))
    }
    return text
  }
  if (platform === 1 && encoding === 0) return new TextDecoder('latin1').decode(bytes)
  return new TextDecoder().decode(bytes)
}

function nameRecords(table: Uint8Array): NameRecord[] {
  const view = new DataView(table.buffer, table.byteOffset, table.byteLength)
  const count = view.getUint16(2)
  const storage = view.getUint16(4)
  const records: NameRecord[] = []
  for (let index = 0; index < count; index++) {
    const at = 6 + index * 12
    if (at + 12 > table.byteLength) break
    const platform = view.getUint16(at)
    const encoding = view.getUint16(at + 2)
    const language = view.getUint16(at + 4)
    const id = view.getUint16(at + 6)
    const length = view.getUint16(at + 8)
    const offset = view.getUint16(at + 10)
    const start = storage + offset
    if (start + length > table.byteLength) continue
    const text = decodeName(table.subarray(start, start + length), platform, encoding)
      .replace(/\0/g, '')
      .trim()
    if (text) records.push({ platform, encoding, language, id, text })
  }
  return records
}

function pick(records: NameRecord[], id: number): string | null {
  const matching = records.filter((record) => record.id === id)
  const rank = (record: NameRecord) => {
    if (record.platform === 3 && record.language === 0x0409) return 0
    if (record.platform === 1 && record.language === 0) return 1
    return 2
  }
  return matching.sort((a, b) => rank(a) - rank(b))[0]?.text ?? null
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(bytes)])
    .stream()
    .pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** The `name` table of an OpenType font starting at `start` (a TrueType, CFF or collection face). */
function sfntNameTable(bytes: Uint8Array, start: number): Uint8Array | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tables = view.getUint16(start + 4)
  for (let index = 0; index < tables; index++) {
    const at = start + 12 + index * 16
    if (at + 16 > bytes.byteLength) return null
    if (tag(view, at) !== 'name') continue
    const offset = view.getUint32(at + 8)
    const length = view.getUint32(at + 12)
    return offset + length <= bytes.byteLength ? bytes.subarray(offset, offset + length) : null
  }
  return null
}

async function woffNameTable(bytes: Uint8Array): Promise<Uint8Array | null> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tables = view.getUint16(12)
  for (let index = 0; index < tables; index++) {
    const at = 44 + index * 20
    if (at + 20 > bytes.byteLength) return null
    if (tag(view, at) !== 'name') continue
    const offset = view.getUint32(at + 4)
    const compressed = view.getUint32(at + 8)
    const original = view.getUint32(at + 12)
    const data = bytes.subarray(offset, offset + compressed)
    return compressed < original ? inflate(data) : data
  }
  return null
}

/** The font's own names and license, or null for a file this reader cannot parse (WOFF2). */
export async function readFontNames(bytes: Uint8Array): Promise<FontNames | null> {
  try {
    if (bytes.byteLength < 12) return null
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const signature = tag(view, 0)
    let table: Uint8Array | null = null
    if (signature === 'ttcf') table = sfntNameTable(bytes, view.getUint32(12))
    else if (signature === 'wOFF') table = await woffNameTable(bytes)
    else if (signature === 'OTTO' || signature === 'true' || view.getUint32(0) === 0x00010000) {
      table = sfntNameTable(bytes, 0)
    }
    if (!table) return null
    const records = nameRecords(table)
    const family = pick(records, TYPOGRAPHIC_FAMILY) ?? pick(records, FAMILY)
    if (!family) return null
    return {
      family,
      style: pick(records, TYPOGRAPHIC_SUBFAMILY) ?? pick(records, SUBFAMILY) ?? 'Regular',
      license: pick(records, LICENSE),
      licenseURL: pick(records, LICENSE_URL)
    }
  } catch {
    return null
  }
}

export type FontLicense = 'commercial' | 'non_commercial' | 'unknown'

const COMMERCIAL_TERMS = [
  /open font license|\bofl\b|scripts\.sil\.org\/ofl|openfontlicense\.org/i,
  /apache license|apache\.org\/licenses/i,
  /ubuntu font licen[cs]e/i,
  /free for (commercial|personal and commercial)/i,
  /commercial use (is )?(allowed|permitted)/i,
  /免费商用|可商用|可免费商用|允许商用|商业用途免费/
]
const NON_COMMERCIAL_TERMS = [
  /personal use only|for personal use|non[- ]?commercial|not for commercial/i,
  /个人(非商业|使用|免费)|非商用|仅限个人|不可商用|禁止商用|商用需授权|商业授权/
]
/** Families published free for commercial use, by a name they commonly carry. */
const KNOWN_COMMERCIAL_FAMILIES = [
  /source ?han|思源/i,
  /alibaba ?puhui|阿里巴巴普惠/i,
  /zcool|站酷/i,
  /youshe|优设/i,
  /pangmen|庞门正道/i,
  /lxgw|霞鹜/i,
  /smiley ?sans|得意黑/i,
  /harmony ?os ?sans|鸿蒙/i,
  /misans/i,
  /oppo ?sans/i,
  /noto (sans|serif)/i,
  /jiangxi ?zhuokai|江西拙楷/i,
  /上图东观体/,
  /汇文明朝/,
  /inter\b|roboto|open sans|lato|montserrat|poppins/i
]

/** Whether the font's own license text, or its family, says it may be used commercially. */
export function licenseFromNames(
  family: string,
  license: string | null,
  url: string | null
): FontLicense {
  const text = `${license ?? ''} ${url ?? ''}`
  if (NON_COMMERCIAL_TERMS.some((term) => term.test(text))) return 'non_commercial'
  if (COMMERCIAL_TERMS.some((term) => term.test(text))) return 'commercial'
  if (KNOWN_COMMERCIAL_FAMILIES.some((name) => name.test(family))) return 'commercial'
  return 'unknown'
}
