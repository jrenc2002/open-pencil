<script setup lang="ts">
import { compact } from 'es-toolkit'
import { computed, ref } from 'vue'

import type { AdminCreatedMember } from '@open-pencil/cloud/contract'

import { usePortal } from '@/app/cloud-portal/context'
import AppButton from '@/components/ui/button/AppButton.vue'
import AppCopyButton from '@/components/ui/button/AppCopyButton.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import AppTextarea from '@/components/ui/input/AppTextarea.vue'

/**
 * 词元开物: administrators add people directly, one per line as "email name". Each account is
 * verified and approved at once, joins the company workspace on first sign-in, and gets a random
 * password shown here once to hand over.
 */
const emit = defineEmits<{ created: [] }>()
const portal = usePortal()

const open = ref(false)
const text = ref('')
const busy = ref(false)
const error = ref<string | null>(null)
const results = ref<AdminCreatedMember[]>([])

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const parsed = computed(() =>
  compact(text.value.split('\n').map((line) => line.trim())).map((line) => {
    const [email = '', ...rest] = line.split(/[\s,，;；\t]+/)
    return { email: email.toLowerCase(), name: rest.join(' ').trim() || undefined }
  })
)
const invalid = computed(() => parsed.value.filter((member) => !EMAIL.test(member.email)))
const canSubmit = computed(
  () => parsed.value.length > 0 && parsed.value.length <= 100 && invalid.value.length === 0
)

const STATUS_LABELS: Record<AdminCreatedMember['status'], string> = {
  created: '已创建',
  exists: '已存在，未改动',
  failed: '失败'
}

const created = computed(() => results.value.filter((member) => member.status === 'created'))
const credentials = computed(() =>
  created.value
    .map((member) => `${member.email}\t${member.name}\t${member.password ?? ''}`)
    .join('\n')
)

async function submit() {
  if (!canSubmit.value || busy.value) return
  busy.value = true
  error.value = null
  try {
    const response = await portal.api.createMembers(parsed.value)
    results.value = response.members
    if (response.members.some((member) => member.status === 'created')) {
      text.value = ''
      emit('created')
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="flex flex-col gap-3 rounded-lg border border-border p-4">
    <div class="flex items-center justify-between gap-3">
      <div>
        <h3 class="text-sm font-semibold">添加成员</h3>
        <p class="text-xs text-muted">
          账号直接可用：已验证、已批准，首次登录自动加入「词元开物」共享工作区，并保留个人空间。
        </p>
      </div>
      <AppButton variant="outline" size="sm" @click="open = !open">
        {{ open ? '收起' : '添加成员' }}
      </AppButton>
    </div>

    <template v-if="open">
      <label class="flex flex-col gap-1 text-xs text-muted">
        每行一人：邮箱 姓名（姓名可省略），一次最多 100 人
        <AppTextarea v-model="text" :rows="6" :disabled="busy" />
      </label>
      <p v-if="invalid.length" class="text-xs text-error">
        这些邮箱格式不对：{{ invalid.map((member) => member.email).join('、') }}
      </p>
      <div class="flex items-center gap-2">
        <AppButton variant="solid" size="sm" :disabled="!canSubmit || busy" @click="submit">
          {{ busy ? '创建中…' : `创建 ${parsed.length} 个账号` }}
        </AppButton>
      </div>
      <AppAlert v-if="error" tone="error" heading="创建失败" :description="error" />

      <div v-if="results.length" class="flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <p class="text-xs text-muted">
            密码只在这里显示一次，请复制后交给成员。成员登录后可以自己修改。
          </p>
          <AppCopyButton
            v-if="created.length"
            :value="credentials"
            label="复制全部账号"
            copied-label="已复制"
          />
        </div>
        <table class="w-full text-start text-xs">
          <thead class="text-muted">
            <tr>
              <th class="py-1 font-medium">邮箱</th>
              <th class="py-1 font-medium">姓名</th>
              <th class="py-1 font-medium">密码</th>
              <th class="py-1 font-medium">状态</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="member in results" :key="member.email" class="border-t border-border">
              <td class="py-1 pe-2">{{ member.email }}</td>
              <td class="py-1 pe-2">{{ member.name }}</td>
              <td class="py-1 pe-2 font-mono">{{ member.password ?? '—' }}</td>
              <td class="py-1">
                {{ STATUS_LABELS[member.status] }}{{ member.error ? `：${member.error}` : '' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>
