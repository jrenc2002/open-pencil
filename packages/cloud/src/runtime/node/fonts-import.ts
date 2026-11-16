#!/usr/bin/env node
/**
 * 词元开物: adds every font file under a directory to the company font space, reading each face's
 * own names and license. Faces already in the space are skipped.
 *   node fonts-import.mjs <directory> [--dry-run]
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { createS3ObjectStore } from '#cloud/runtime/s3/objects'
import { createTeamFontService, TeamFontError } from '#cloud/server/fonts'
import { readFontNames } from '#cloud/server/fonts/names'

import { createMigratedNodeCloudDatabase } from './bootstrap'

const FONT_FILE = /\.(ttf|otf|ttc|woff2?)$/i

async function fontFiles(directory: string): Promise<string[]> {
  const found: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      for (const nested of await fontFiles(path)) found.push(nested)
    } else if (FONT_FILE.test(entry.name)) found.push(path)
  }
  return found.sort()
}

const [directory, flag] = process.argv.slice(2)
if (!directory || !(await stat(directory)).isDirectory()) {
  throw new Error('Usage: fonts-import <directory> [--dry-run]')
}
const dryRun = flag === '--dry-run'
const files = await fontFiles(directory)
const { config, database } = await createMigratedNodeCloudDatabase(process.env)
const fonts = createTeamFontService(database, createS3ObjectStore(config))
const tally = { added: 0, skipped: 0, failed: 0 }
try {
  for (const path of files) {
    const name = path.slice(directory.length).replace(/^\/+/, '')
    const bytes = new Uint8Array(await readFile(path))
    if (dryRun) {
      const own = await readFontNames(bytes)
      console.log(
        `${name}\t${own?.family ?? '?'}\t${own?.style ?? '?'}\t${own?.license?.slice(0, 60) ?? ''}`
      )
      continue
    }
    try {
      const font = await fonts.add({
        fileName: name.split('/').pop() ?? name,
        bytes,
        uploadedBy: null
      })
      tally.added++
      console.log(`added\t${font.family}\t${font.style}\t${font.license}`)
    } catch (error) {
      if (error instanceof TeamFontError && error.code === 'duplicate') {
        tally.skipped++
        continue
      }
      tally.failed++
      console.log(`failed\t${name}\t${error instanceof Error ? error.message : String(error)}`)
    }
  }
} finally {
  await database.destroy()
}
console.log(JSON.stringify({ files: files.length, ...tally }))
