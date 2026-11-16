import { StorageSerializers, useLocalStorage } from '@vueuse/core'
import { watch } from 'vue'

import { cloudCatalogModels } from '@/app/ai/providers/openpencil/catalog'
import { OPENPENCIL_AI_PROVIDER } from '@/app/ai/providers/openpencil/provider'
import { cloudAIClient, cloudAIIdentity, cloudAIWorkspaces } from '@/app/cloud/integration'
import { COMPANY_NAME } from '@/constants'

import { readAIModelSettingsStorage } from './storage'
import {
  aiModelSettings,
  createModelProfileDraft,
  saveModelProfileDraft,
  setModelRoleAssignment
} from './store'

/**
 * Team default: once someone signs in to the Home server and it offers AI, every device lists the
 * server's default model (Baidu Qianfan DeepSeek through the company server, no key to type). A
 * device that never saved model settings of its own also uses it for the Design, Review and Fast
 * roles, once; later choices, such as Claude Code or Codex, stay as they are.
 */
const APPLIED_KEY = 'openpencil:team-ai-default'

const appliedAt = useLocalStorage<string | null>(APPLIED_KEY, null, {
  serializer: StorageSerializers.string,
  writeDefaults: false
})

function alreadyApplied(): boolean {
  return appliedAt.value !== null
}

function markApplied(): void {
  appliedAt.value = new Date().toISOString()
}

const configuredBefore = readAIModelSettingsStorage() !== null
let running = false

async function applyTeamDefault(): Promise<void> {
  if (running) return
  running = true
  try {
    // The company workspace pays for team AI when the account is in it; otherwise its first one.
    const workspaces = await cloudAIWorkspaces().catch(() => [])
    const workspace =
      workspaces.find((candidate) => candidate.name === COMPANY_NAME) ?? workspaces.at(0)
    if (!workspace) return
    const client = cloudAIClient(workspace.id)
    const catalog = client ? await client.catalog().catch(() => null) : null
    if (!catalog) return
    const model = cloudCatalogModels(catalog).find((option) => option.id === catalog.defaultModelID)
    if (!model) return
    const existing = aiModelSettings.value.models.find((profile) => {
      const connection = aiModelSettings.value.connections.find(
        (candidate) => candidate.id === profile.connectionId
      )
      return connection?.providerID === OPENPENCIL_AI_PROVIDER && profile.modelID === model.id
    })
    const capabilities = model.capabilities?.length ? [...model.capabilities] : ['tools' as const]
    const profile =
      existing ??
      saveModelProfileDraft({
        ...createModelProfileDraft(),
        profileId: null,
        sourceConnectionId: null,
        name: model.name,
        providerID: OPENPENCIL_AI_PROVIDER,
        modelID: model.id,
        customModelID: '',
        customBaseURL: '',
        customAPIType: 'completions',
        cloudWorkspaceId: workspace.id,
        capabilities
      })
    // Every device gets the team model; only one that never chose its own models also uses it
    // for the Design, Review and Fast roles. Choices made later are left alone.
    if (!configuredBefore && !alreadyApplied()) {
      setModelRoleAssignment('design', profile.id)
      setModelRoleAssignment('review', 'design')
      setModelRoleAssignment('fast', 'design')
    }
    markApplied()
  } finally {
    running = false
  }
}

export function installTeamAIDefault(): void {
  watch(
    cloudAIIdentity,
    (identity) => {
      if (identity) void applyTeamDefault()
    },
    { immediate: true }
  )
}
