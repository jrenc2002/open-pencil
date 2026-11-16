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
 * Team default: once someone signs in to the Home server and it offers AI, a device that has never
 * saved model settings of its own gets the server's default model for the Design, Review and Fast
 * roles. Each device does this once; later choices, such as Claude Code or Codex, stay as they are.
 */
const APPLIED_KEY = 'openpencil:team-ai-default'

function alreadyApplied(): boolean {
  try {
    return localStorage.getItem(APPLIED_KEY) !== null
  } catch {
    return true
  }
}

function markApplied(): void {
  try {
    localStorage.setItem(APPLIED_KEY, new Date().toISOString())
  } catch {
    // Storage blocked: the default is applied again next time, which changes nothing new.
  }
}

const configuredBefore = readAIModelSettingsStorage() !== null
let running = false

async function applyTeamDefault(): Promise<void> {
  if (running || alreadyApplied()) return
  if (configuredBefore) {
    markApplied()
    return
  }
  running = true
  try {
    // The company workspace pays for team AI when the account is in it; otherwise its first one.
    const workspaces = await cloudAIWorkspaces().catch(() => [])
    const workspace = workspaces.find((candidate) => candidate.name === COMPANY_NAME) ?? workspaces[0]
    if (!workspace) return
    const client = cloudAIClient(workspace.id)
    const catalog = client ? await client.catalog().catch(() => null) : null
    if (!catalog || readAIModelSettingsStorage() !== null || alreadyApplied()) return
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
    setModelRoleAssignment('design', profile.id)
    setModelRoleAssignment('review', 'design')
    setModelRoleAssignment('fast', 'design')
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
