<script setup lang="ts">
import * as v from 'valibot'
import { computed, onMounted, ref } from 'vue'

import {
  teamFontListSchema,
  teamFontResponseSchema,
  type TeamFont,
  type TeamFontLicense
} from '@open-pencil/cloud/contract'

import { usePortal } from '@/app/cloud-portal/context'
import AppButton from '@/components/ui/button/AppButton.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'

/**
 * 词元开物: the company font space. Everyone signed in can add fonts; they show up in every
 * member's font list on the web and in the desktop app. Each face says whether it may be used
 * commercially; its uploader and administrators can correct that or remove the face.
 */
const portal = usePortal()
const fonts = ref<TeamFont[]>([])
const loading = ref(true)
const busy = ref(false)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)
const input = ref<HTMLInputElement | null>(null)
const search = ref('')
const filter = ref<'all' | TeamFontLicense>('all')
const uploadLicense = ref<TeamFontLicense | ''>('')

const LICENSE_LABELS: Record<TeamFontLicense, string> = {
  commercial: '可商用',
  non_commercial: '不可商用',
  unknown: '未确认'
}
const FILTERS: Array<{ id: 'all' | TeamFontLicense; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'commercial', label: '可商用' },
  { id: 'non_commercial', label: '不可商用' },
  { id: 'unknown', label: '未确认' }
]

const you = computed(() => portal.account.value?.user)
const admin = computed(() => you.value?.deploymentRole === 'admin')

function canEdit(font: TeamFont): boolean {
  return admin.value || font.uploadedBy === you.value?.userId
}

function count(id: 'all' | TeamFontLicense): number {
  return id === 'all'
    ? fonts.value.length
    : fonts.value.filter((font) => font.license === id).length
}

const families = computed(() => {
  const words = search.value.trim().toLowerCase()
  const byFamily = new Map<string, TeamFont[]>()
  for (const font of fonts.value) {
    if (filter.value !== 'all' && font.license !== filter.value) continue
    if (words && !`${font.family} ${font.style}`.toLowerCase().includes(words)) continue
    byFamily.set(font.family, [...(byFamily.get(font.family) ?? []), font])
  }
  return [...byFamily].map(([family, faces]) => ({ family, faces }))
})

function size(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.ceil(bytes / 1024)} KB`
}

async function request<T>(
  path: string,
  init: RequestInit,
  schema: v.GenericSchema<unknown, T>
): Promise<T> {
  const response = await fetch(path, { credentials: 'include', ...init })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message = v.safeParse(
      v.object({ error: v.object({ message: v.optional(v.string()) }) }),
      body
    )
    throw new Error(
      (message.success && message.output.error.message) || `请求失败（${response.status}）`
    )
  }
  return v.parse(schema, body)
}

async function load() {
  loading.value = true
  try {
    fonts.value = (await request('/api/fonts', {}, teamFontListSchema)).fonts
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    loading.value = false
  }
}

async function upload(files: FileList | null) {
  if (!files?.length || busy.value) return
  busy.value = true
  error.value = null
  notice.value = null
  const failed: string[] = []
  let added = 0
  for (const file of Array.from(files)) {
    const form = new FormData()
    form.append('file', file)
    if (uploadLicense.value) form.append('license', uploadLicense.value)
    try {
      await request('/api/fonts', { method: 'POST', body: form }, teamFontResponseSchema)
      added++
    } catch (cause) {
      failed.push(`${file.name}：${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }
  if (input.value) input.value.value = ''
  busy.value = false
  if (added) notice.value = `已添加 ${added} 个字体文件，成员刷新或重新打开编辑器后即可使用。`
  if (failed.length) error.value = failed.join('\n')
  await load()
}

async function setLicense(font: TeamFont, license: TeamFontLicense) {
  if (busy.value || license === font.license) return
  busy.value = true
  error.value = null
  try {
    const { font: updated } = await request(
      `/api/fonts/${font.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ license })
      },
      teamFontResponseSchema
    )
    fonts.value = fonts.value.map((item) => (item.id === updated.id ? updated : item))
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busy.value = false
  }
}

async function remove(font: TeamFont) {
  const question = `从字体空间删除「${font.family} ${font.style}」？用到它的稿件会改用替代字体显示。`
  if (busy.value || !confirm(question)) return
  busy.value = true
  error.value = null
  try {
    await request(`/api/fonts/${font.id}`, { method: 'DELETE' }, v.object({ ok: v.literal(true) }))
    fonts.value = fonts.value.filter((item) => item.id !== font.id)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busy.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="flex flex-col gap-4">
    <section class="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <p class="text-xs text-muted">
          支持 TTF、OTF、TTC、WOFF、WOFF2，单个文件最大 80
          MB。字体名称和授权会从文件里自动读取；读不到授权的标为「未确认」，上传者和管理员可以修改。
        </p>
        <div class="flex items-center gap-2">
          <select
            v-model="uploadLicense"
            class="rounded-md border border-border bg-transparent px-2 py-1 text-xs"
            :disabled="busy"
          >
            <option value="">授权：自动识别</option>
            <option value="commercial">授权：可商用</option>
            <option value="non_commercial">授权：不可商用</option>
          </select>
          <AppButton variant="solid" size="sm" :disabled="busy" @click="input?.click()">
            {{ busy ? '处理中…' : '上传字体' }}
          </AppButton>
        </div>
        <input
          ref="input"
          type="file"
          multiple
          accept=".ttf,.otf,.woff,.woff2,.ttc"
          class="hidden"
          @change="upload(($event.target as HTMLInputElement).files)"
        />
      </div>
      <AppAlert v-if="notice" tone="success" :heading="notice" />
      <AppAlert v-if="error" tone="error" heading="有操作没有成功" :description="error" />
    </section>

    <div class="flex flex-wrap items-center gap-2">
      <AppButton
        v-for="item in FILTERS"
        :key="item.id"
        :variant="filter === item.id ? 'soft' : 'ghost'"
        size="xs"
        @click="filter = item.id"
      >
        {{ item.label }} {{ count(item.id) }}
      </AppButton>
      <input
        v-model="search"
        type="search"
        placeholder="搜索字体"
        class="ms-auto rounded-md border border-border bg-transparent px-2 py-1 text-xs"
      />
    </div>

    <p v-if="loading" class="text-xs text-muted">正在读取字体空间…</p>
    <p v-else-if="!families.length" class="text-xs text-muted">
      {{ fonts.length ? '没有符合条件的字体。' : '字体空间还是空的，上传一些常用字体吧。' }}
    </p>
    <section
      v-for="group in families"
      :key="group.family"
      class="flex flex-col gap-1 rounded-lg border border-border p-4"
    >
      <h3 class="text-sm font-semibold" :style="{ fontFamily: `'${group.family}'` }">
        {{ group.family }}
      </h3>
      <div
        v-for="font in group.faces"
        :key="font.id"
        class="flex flex-wrap items-center justify-between gap-3 border-t border-border py-1 text-xs"
      >
        <span>
          {{ font.style }} · {{ font.weight }}{{ font.italic ? ' 斜体' : '' }}
          <span class="text-muted">
            · {{ size(font.byteLength)
            }}{{ font.uploaderName ? ` · ${font.uploaderName} 上传` : '' }}</span
          >
        </span>
        <span class="flex items-center gap-2">
          <select
            v-if="canEdit(font)"
            :value="font.license"
            class="rounded-md border border-border bg-transparent px-1 py-0.5 text-xs"
            :disabled="busy"
            @change="
              setLicense(font, ($event.target as HTMLSelectElement).value as TeamFontLicense)
            "
          >
            <option v-for="(label, id) in LICENSE_LABELS" :key="id" :value="id">{{ label }}</option>
          </select>
          <span v-else class="text-muted">{{ LICENSE_LABELS[font.license] }}</span>
          <AppButton
            v-if="canEdit(font)"
            variant="ghost"
            size="xs"
            :disabled="busy"
            @click="remove(font)"
          >
            删除
          </AppButton>
        </span>
      </div>
    </section>
  </div>
</template>
