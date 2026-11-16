import type { TeamFont, TeamFontLicense } from '#cloud/contract'
import type { CloudDatabase } from '#cloud/server/db'
import type { ObjectStore } from '#cloud/server/objects'
import { sha256 } from '@noble/hashes/sha2.js'
import { compact, uniq } from 'es-toolkit'
import { fromUint8Array } from 'js-base64'
import type { Kysely } from 'kysely'

import { licenseFromNames, readFontNames } from './names'

/** The largest font file the font space takes; large CJK families run to tens of megabytes. */
export const TEAM_FONT_MAX_BYTES = 80 * 1024 * 1024
/** How long a download address for a face stays valid. */
const DOWNLOAD_LIFETIME_MS = 60 * 60 * 1000

const CONTENT_TYPES: Record<string, string> = {
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttc: 'font/collection'
}

/** Style words in a style name, heaviest match first, with the weight they stand for. */
const WEIGHTS: Array<[RegExp, number]> = [
  [/(extra|ultra)[ -]?black|heavy[ -]?black/i, 950],
  [/black|heavy|特黑/i, 900],
  [/(extra|ultra)[ -]?bold|特粗|超粗/i, 800],
  [/(semi|demi)[ -]?bold|半粗/i, 600],
  [/bold|粗/i, 700],
  [/medium|中等|中黑/i, 500],
  [/(extra|ultra)[ -]?light|特细|超细/i, 200],
  [/thin|hairline|极细|纤细/i, 100],
  [/light|细/i, 300]
]

export class TeamFontError extends Error {
  constructor(
    readonly code: 'unsupported_format' | 'too_large' | 'duplicate' | 'not_found' | 'forbidden',
    message: string
  ) {
    super(message)
    this.name = 'TeamFontError'
  }
}

/** The weight and slant a style name such as "Semi Bold Italic" or "粗体" describes. */
export function styleFace(style: string): { weight: number; italic: boolean } {
  const italic = /italic|oblique|斜/i.test(style)
  const weight = WEIGHTS.find(([pattern]) => pattern.test(style))?.[1] ?? 400
  return { weight, italic }
}

/**
 * A family and style read from a file name such as "SourceHanSans-BoldItalic.otf", for a file
 * whose own names cannot be read.
 */
export function guessFromFileName(fileName: string): { family: string; style: string } {
  const base = fileName.replace(/\.[^.]+$/, '').trim()
  const cut = base.lastIndexOf('-')
  const [family, style] = cut > 0 ? [base.slice(0, cut), base.slice(cut + 1)] : [base, 'Regular']
  const spaced = style.replace(/([a-z])([A-Z])/g, '$1 $2').trim() || 'Regular'
  return { family: family.trim() || base, style: spaced }
}

/** The stored extension and content type of a font file, or why it is refused. */
function fileType(
  fileName: string,
  byteLength: number
): { extension: string; contentType: string } {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? ''
  const contentType = CONTENT_TYPES[extension]
  if (!contentType) {
    throw new TeamFontError('unsupported_format', 'Font files must be TTF, OTF, TTC, WOFF or WOFF2')
  }
  if (byteLength > TEAM_FONT_MAX_BYTES) {
    throw new TeamFontError('too_large', 'Font files can be at most 80 MB')
  }
  return { extension, contentType }
}

/**
 * A face's family, style, weight and license: what the uploader typed, else what the font says
 * of itself, else what its file name suggests.
 */
async function describe(input: {
  fileName: string
  bytes: Uint8Array
  family?: string
  style?: string
  license?: TeamFontLicense
}) {
  const own = await readFontNames(input.bytes)
  const guessed = guessFromFileName(input.fileName)
  const family = input.family?.trim() || own?.family || guessed.family
  const style = input.style?.trim() || own?.style || guessed.style
  const license =
    input.license ?? licenseFromNames(family, own?.license ?? null, own?.licenseURL ?? null)
  const note = compact([own?.license, own?.licenseURL]).join('\n').slice(0, 2000)
  return { family, style, ...styleFace(style), license, licenseNote: note || null }
}

type FontRow = {
  id: string
  family: string
  style: string
  weight: number
  italic: boolean
  byteLength: number
  license: string
  licenseNote: string | null
  uploadedBy: string | null
  uploaderName: string | null
  createdAt: Date | string
}

function toTeamFont(font: FontRow): TeamFont {
  return {
    id: font.id,
    family: font.family,
    style: font.style,
    weight: font.weight,
    italic: font.italic,
    byteLength: font.byteLength,
    license: font.license as TeamFontLicense,
    licenseNote: font.licenseNote,
    uploadedBy: font.uploadedBy,
    uploaderName: font.uploaderName,
    createdAt: new Date(font.createdAt).toISOString()
  }
}

/** Who acts on a face: its uploader and deployment administrators may change or remove it. */
export type TeamFontActor = { userId: string; deploymentRole?: 'user' | 'admin' }

export function createTeamFontService(database: Kysely<CloudDatabase>, objects: ObjectStore) {
  function rows() {
    return database
      .selectFrom('teamFont')
      .select([
        'id',
        'family',
        'style',
        'weight',
        'italic',
        'byteLength',
        'license',
        'licenseNote',
        'uploadedBy',
        'createdAt'
      ])
  }

  /** The fonts with their uploaders' names, which accounts keep by the same id. */
  async function withUploaders(fonts: Array<Omit<FontRow, 'uploaderName'>>): Promise<TeamFont[]> {
    const ids = uniq(fonts.flatMap((font) => (font.uploadedBy ? [font.uploadedBy] : [])))
    const names = new Map<string, string>()
    if (ids.length) {
      const users = await database
        .selectFrom('user')
        .select(['id', 'name'])
        .where('id', 'in', ids)
        .execute()
      for (const user of users) names.set(String(user.id), user.name)
    }
    return fonts.map((font) =>
      toTeamFont({
        ...font,
        uploaderName: font.uploadedBy ? (names.get(font.uploadedBy) ?? null) : null
      })
    )
  }

  async function one(id: string): Promise<TeamFont> {
    const [font] = await withUploaders([
      await rows().where('id', '=', id).executeTakeFirstOrThrow()
    ])
    if (!font) throw new TeamFontError('not_found', 'No such font')
    return font
  }

  async function requireEditable(id: string, actor: TeamFontActor) {
    const font = await database
      .selectFrom('teamFont')
      .select(['objectKey', 'uploadedBy'])
      .where('id', '=', id)
      .executeTakeFirst()
    if (!font) throw new TeamFontError('not_found', 'No such font')
    if (actor.deploymentRole !== 'admin' && font.uploadedBy !== actor.userId) {
      throw new TeamFontError(
        'forbidden',
        'Only the uploader or an administrator can change this font'
      )
    }
    return font
  }

  return {
    async list(): Promise<TeamFont[]> {
      return withUploaders(
        await rows().orderBy('family').orderBy('weight').orderBy('italic').execute()
      )
    },

    /** A face's bytes, or null when there is no such face. */
    async read(id: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
      const font = await database
        .selectFrom('teamFont')
        .select(['objectKey', 'contentType'])
        .where('id', '=', id)
        .executeTakeFirst()
      if (!font) return null
      const bytes = await objects.read(font.objectKey)
      return bytes ? { bytes, contentType: font.contentType } : null
    },

    /**
     * A short-lived address to fetch a face straight from object storage, which is nearer to the
     * people using it than the server's tunnel; null when there is no such face.
     */
    async downloadURL(id: string): Promise<string | null> {
      const font = await database
        .selectFrom('teamFont')
        .select('objectKey')
        .where('id', '=', id)
        .executeTakeFirst()
      if (!font) return null
      const download = await objects.createDownload({
        key: font.objectKey,
        expiresAt: new Date(Date.now() + DOWNLOAD_LIFETIME_MS)
      })
      return download.url
    },

    async add(input: {
      fileName: string
      bytes: Uint8Array
      family?: string
      style?: string
      license?: TeamFontLicense
      uploadedBy: string | null
    }): Promise<TeamFont> {
      const { extension, contentType } = fileType(input.fileName, input.bytes.byteLength)
      const { family, style, weight, italic, license, licenseNote } = await describe(input)
      const existing = await database
        .selectFrom('teamFont')
        .select('id')
        .where('family', '=', family)
        .where('style', '=', style)
        .executeTakeFirst()
      if (existing) {
        throw new TeamFontError('duplicate', `${family} ${style} is already in the font space`)
      }
      const id = crypto.randomUUID()
      const objectKey = `fonts/${id}.${extension}`
      await objects.write({
        key: objectKey,
        bytes: input.bytes,
        contentType,
        checksum: fromUint8Array(sha256(input.bytes))
      })
      await database
        .insertInto('teamFont')
        .values({
          id,
          family,
          style,
          weight,
          italic,
          objectKey,
          byteLength: input.bytes.byteLength,
          contentType,
          uploadedBy: input.uploadedBy,
          license,
          licenseNote
        })
        .execute()
      return one(id)
    },

    async setLicense(
      id: string,
      license: TeamFontLicense,
      actor: TeamFontActor
    ): Promise<TeamFont> {
      await requireEditable(id, actor)
      await database.updateTable('teamFont').set({ license }).where('id', '=', id).execute()
      return one(id)
    },

    async remove(id: string, actor: TeamFontActor): Promise<void> {
      const font = await requireEditable(id, actor)
      await database.deleteFrom('teamFont').where('id', '=', id).execute()
      await objects.delete(font.objectKey)
    }
  }
}

export type TeamFontService = ReturnType<typeof createTeamFontService>
