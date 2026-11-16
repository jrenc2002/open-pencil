import { computed, ref, watch } from 'vue'

import type { TeamFont } from '@open-pencil/cloud/contract'
import type { HostFontFamily } from '@open-pencil/core/text'

import { homeCloudServer } from '@/app/cloud/servers/store'
import { cloudAPIClient, cloudConnection } from '@/app/cloud/sessions/connection'

/**
 * 词元开物: the team font library. While someone is signed in to the Home server, its fonts are
 * listed with the installed ones and their bytes are fetched from the server when a face is drawn.
 */
export const teamFonts = ref<TeamFont[]>([])

const home = computed(() => {
  const server = homeCloudServer.value
  if (!server) return null
  const connection = cloudConnection(server.id)
  if (connection.state !== 'signed-in' || !connection.discovery || !connection.account) return null
  return { server, discovery: connection.discovery, key: `${server.id}:${connection.account.id}` }
})

const files = new Map<string, Promise<ArrayBuffer | null>>()
let listed: string | null = null

async function refresh(): Promise<void> {
  const current = home.value
  if (!current) {
    teamFonts.value = []
    listed = null
    return
  }
  const key = current.key
  try {
    const fonts = await cloudAPIClient(current.server, current.discovery).listTeamFonts()
    if (home.value?.key !== key) return
    teamFonts.value = fonts
    listed = key
  } catch (error) {
    console.warn('[Fonts] Could not list the team fonts', error)
  }
}

watch(
  () => home.value?.key ?? null,
  (key) => {
    if (key !== listed) files.clear()
    void refresh()
  },
  { immediate: true }
)

/** Lists the library again, after an administrator added or removed fonts. */
export function refreshTeamFonts(): Promise<void> {
  return refresh()
}

/** The library's families with their faces, in the form the font manager lists hosts' fonts. */
export const teamFontCatalog = computed<HostFontFamily[]>(() => {
  const byFamily = new Map<string, HostFontFamily['faces'][number][]>()
  for (const font of teamFonts.value) {
    const faces = byFamily.get(font.family) ?? []
    faces.push({ style: font.style, weight: font.weight, italic: font.italic })
    byFamily.set(font.family, faces)
  }
  return [...byFamily].map(([family, faces]) => ({ family, faces }))
})

function normalized(style: string): string {
  return style.toLowerCase().replace(/[\s_-]+/g, '')
}

/** A library face's bytes, fetched once per sign-in; null for a face the library lacks. */
export function loadTeamFont(family: string, style: string): Promise<ArrayBuffer | null> {
  const current = home.value
  if (!current) return Promise.resolve(null)
  const wanted = normalized(style || 'Regular')
  const font = teamFonts.value.find(
    (candidate) => candidate.family === family && normalized(candidate.style) === wanted
  )
  if (!font) return Promise.resolve(null)
  let file = files.get(font.id)
  if (!file) {
    file = cloudAPIClient(current.server, current.discovery)
      .teamFontFile(font.id)
      .catch((error: unknown) => {
        console.warn(`[Fonts] Could not load team font ${family} ${style}`, error)
        files.delete(font.id)
        return null
      })
    files.set(font.id, file)
  }
  return file
}
