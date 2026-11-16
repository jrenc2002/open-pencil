import type { TeamFont } from '#cloud/contract'
import type { CloudDatabase } from '#cloud/server/db'
import type { ObjectStore } from '#cloud/server/objects'
import { sha256 } from '@noble/hashes/sha2.js'
import { fromUint8Array } from 'js-base64'
import type { Kysely } from 'kysely'

/** The largest font file the library takes. */
export const TEAM_FONT_MAX_BYTES = 30 * 1024 * 1024

const CONTENT_TYPES: Record<string, string> = {
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttc: 'font/collection'
}

/** Style words in a file or style name, heaviest match first, with the weight they stand for. */
const WEIGHTS: Array<[RegExp, number]> = [
  [/(extra|ultra)[ -]?black|heavy[ -]?black/i, 950],
  [/black|heavy/i, 900],
  [/(extra|ultra)[ -]?bold/i, 800],
  [/(semi|demi)[ -]?bold/i, 600],
  [/bold/i, 700],
  [/medium/i, 500],
  [/(extra|ultra)[ -]?light/i, 200],
  [/thin|hairline/i, 100],
  [/light/i, 300]
]

export class TeamFontError extends Error {
  constructor(
    readonly code: 'unsupported_format' | 'too_large' | 'duplicate' | 'not_found',
    message: string
  ) {
    super(message)
    this.name = 'TeamFontError'
  }
}

/** The weight and slant a style name such as "Semi Bold Italic" describes. */
export function styleFace(style: string): { weight: number; italic: boolean } {
  const italic = /italic|oblique/i.test(style)
  const weight = WEIGHTS.find(([pattern]) => pattern.test(style))?.[1] ?? 400
  return { weight, italic }
}

/**
 * A family and style read from a file name such as "SourceHanSans-BoldItalic.otf" or
 * "Inter Semi Bold.ttf"; the administrator can change both before saving.
 */
export function guessFromFileName(fileName: string): { family: string; style: string } {
  const base = fileName.replace(/\.[^.]+$/, '').trim()
  const [family, style] = base.includes('-')
    ? [base.slice(0, base.lastIndexOf('-')), base.slice(base.lastIndexOf('-') + 1)]
    : [base, 'Regular']
  const spaced = style.replace(/([a-z])([A-Z])/g, '$1 $2').trim() || 'Regular'
  return { family: family.trim() || base, style: spaced }
}

function row(font: {
  id: string
  family: string
  style: string
  weight: number
  italic: boolean
  byteLength: number
  createdAt: Date | string
}): TeamFont {
  return {
    id: font.id,
    family: font.family,
    style: font.style,
    weight: font.weight,
    italic: font.italic,
    byteLength: font.byteLength,
    createdAt: new Date(font.createdAt).toISOString()
  }
}

export function createTeamFontService(database: Kysely<CloudDatabase>, objects: ObjectStore) {
  return {
    async list(): Promise<TeamFont[]> {
      const fonts = await database
        .selectFrom('teamFont')
        .select(['id', 'family', 'style', 'weight', 'italic', 'byteLength', 'createdAt'])
        .orderBy('family')
        .orderBy('weight')
        .orderBy('italic')
        .execute()
      return fonts.map(row)
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

    async add(input: {
      fileName: string
      bytes: Uint8Array
      family?: string
      style?: string
      uploadedBy: string
    }): Promise<TeamFont> {
      const extension = input.fileName.split('.').pop()?.toLowerCase() ?? ''
      const contentType = CONTENT_TYPES[extension]
      if (!contentType) {
        throw new TeamFontError('unsupported_format', 'Font files must be TTF, OTF, WOFF or WOFF2')
      }
      if (input.bytes.byteLength > TEAM_FONT_MAX_BYTES) {
        throw new TeamFontError('too_large', 'Font files can be at most 30 MB')
      }
      const guessed = guessFromFileName(input.fileName)
      const family = input.family?.trim() || guessed.family
      const style = input.style?.trim() || guessed.style
      const { weight, italic } = styleFace(style)
      const existing = await database
        .selectFrom('teamFont')
        .select('id')
        .where('family', '=', family)
        .where('style', '=', style)
        .executeTakeFirst()
      if (existing) {
        throw new TeamFontError('duplicate', `${family} ${style} is already in the library`)
      }
      const id = crypto.randomUUID()
      const objectKey = `fonts/${id}.${extension}`
      await objects.write({
        key: objectKey,
        bytes: input.bytes,
        contentType,
        checksum: fromUint8Array(sha256(input.bytes))
      })
      const inserted = await database
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
          uploadedBy: input.uploadedBy
        })
        .returning(['id', 'family', 'style', 'weight', 'italic', 'byteLength', 'createdAt'])
        .executeTakeFirstOrThrow()
      return row(inserted)
    },

    async remove(id: string): Promise<void> {
      const font = await database
        .deleteFrom('teamFont')
        .where('id', '=', id)
        .returning('objectKey')
        .executeTakeFirst()
      if (!font) throw new TeamFontError('not_found', 'No such font')
      await objects.delete(font.objectKey)
    }
  }
}

export type TeamFontService = ReturnType<typeof createTeamFontService>
