<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import type { TeamFont } from '@open-pencil/cloud/contract'

import { usePortal } from '@/app/cloud-portal/context'
import AppButton from '@/components/ui/button/AppButton.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'

/**
 * 词元开物: the team font library. Fonts uploaded here are stored in the company bucket and show
 * up in every member's font list, on the web and in the desktop app, without installing anything.
 */
const portal = usePortal()
const fonts = ref<TeamFont[]>([])
const loading = ref(true)
const busy = ref(false)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)
const input = ref<HTMLInputElement | null>(null)

const families = computed(() => {
  const byFamily = new Map<string, TeamFont[]>()
  for (const font of fonts.value)
    byFamily.set(font.family, [...(byFamily.get(font.family) ?? []), font])
  return [...byFamily].map(([family, faces]) => ({ family, faces }))
})

function size(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.ceil(bytes / 1024)} KB`
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

async function load() {
  loading.value = true
  try {
    fonts.value = (await portal.api.fonts()).fonts
  } catch (cause) {
    error.value = message(cause)
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
    try {
      await portal.api.uploadFont(file)
      added++
    } catch (cause) {
      failed.push(`${file.name}：${message(cause)}`)
    }
  }
  if (input.value) input.value.value = ''
  busy.value = false
  if (added) notice.value = `已添加 ${added} 个字体文件。成员刷新或重新打开编辑器后即可使用。`
  if (failed.length) error.value = failed.join('\n')
  await load()
}

async function remove(font: TeamFont) {
  if (
    busy.value ||
    !confirm(`从字体库删除「${font.family} ${font.style}」？用到它的稿件会改用替代字体显示。`)
  )
    return
  busy.value = true
  error.value = null
  try {
    await portal.api.deleteFont(font.id)
    await load()
  } catch (cause) {
    error.value = message(cause)
  } finally {
    busy.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="flex flex-col gap-4">
    <section class="flex flex-col gap-2 rounded-lg border border-border p-4">
      <div class="flex items-center justify-between gap-3">
        <p class="text-xs text-muted">
          支持 TTF、OTF、WOFF、WOFF2，单个文件最大 30
          MB。文件名按「字体名-字重.ttf」命名可自动识别，例如
          <code>SourceHanSans-Bold.otf</code>、<code>Inter-SemiBoldItalic.ttf</code>。
        </p>
        <AppButton variant="solid" size="sm" :disabled="busy" @click="input?.click()">
          {{ busy ? '上传中…' : '上传字体' }}
        </AppButton>
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
      <AppAlert v-if="error" tone="error" heading="有文件没有添加成功" :description="error" />
    </section>

    <p v-if="loading" class="text-xs text-muted">正在读取字体库…</p>
    <p v-else-if="!families.length" class="text-xs text-muted">
      字体库还是空的，先上传一些公司常用字体吧。
    </p>
    <section
      v-for="group in families"
      :key="group.family"
      class="flex flex-col gap-1 rounded-lg border border-border p-4"
    >
      <h3 class="text-sm font-semibold">{{ group.family }}</h3>
      <div
        v-for="font in group.faces"
        :key="font.id"
        class="flex items-center justify-between gap-3 border-t border-border py-1 text-xs"
      >
        <span>{{ font.style }} · {{ font.weight }}{{ font.italic ? ' 斜体' : '' }}</span>
        <span class="flex items-center gap-3 text-muted">
          {{ size(font.byteLength) }}
          <AppButton variant="ghost" size="xs" :disabled="busy" @click="remove(font)"
            >删除</AppButton
          >
        </span>
      </div>
    </section>
  </div>
</template>
