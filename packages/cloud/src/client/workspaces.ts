import {
  teamFontDownloadSchema,
  teamFontListSchema,
  teamFontResponseSchema,
  type TeamFont,
  type TeamFontLicense,
  createdWorkspaceInvitationSchema,
  workspaceEntitlementsSchema,
  workspaceListSchema,
  workspaceMembersSchema,
  workspaceSummarySchema,
  workspaceUsageSchema,
  type CreatedWorkspaceInvitation,
  type CreateWorkspaceInvitationInput,
  type WorkspaceEntitlements,
  type WorkspaceList,
  type WorkspaceMembers,
  type WorkspaceRole,
  type WorkspaceSummary,
  type WorkspaceUsage
} from '#cloud/contract'
import type { CloudAPI } from '#cloud/server/api'
import type { hc } from 'hono/client'
import * as v from 'valibot'

import { parseResponse, responseBody, type CloudClientDiagnostic } from './response'

const workspaceResponseSchema = v.object({ workspace: workspaceSummarySchema })
const usageResponseSchema = v.object({ usage: workspaceUsageSchema })
const entitlementResponseSchema = v.object({ entitlements: workspaceEntitlementsSchema })

/** Workspaces, their members, invitations, entitlements, and storage use. */
export function createWorkspaceRequests(
  client: ReturnType<typeof hc<CloudAPI>>,
  onDiagnostic?: CloudClientDiagnostic
) {
  return {
    async listWorkspaces(): Promise<WorkspaceList> {
      return parseResponse(client.workspaces.$get(), workspaceListSchema, onDiagnostic)
    },
    async createWorkspace(name: string): Promise<WorkspaceSummary> {
      const response = await parseResponse(
        client.workspaces.$post({ json: { name } }),
        workspaceResponseSchema,
        onDiagnostic
      )
      return response.workspace
    },
    async renameWorkspace(workspaceId: string, name: string): Promise<WorkspaceSummary> {
      const response = await parseResponse(
        client.workspaces[':workspaceId'].$patch({ param: { workspaceId }, json: { name } }),
        workspaceResponseSchema,
        onDiagnostic
      )
      return response.workspace
    },
    /** Deletes an empty workspace; the server refuses one that still holds documents. */
    async deleteWorkspace(workspaceId: string): Promise<void> {
      await responseBody(
        await client.workspaces[':workspaceId'].$delete({ param: { workspaceId } }),
        onDiagnostic
      )
    },
    /** The workspace's members, and for administrators its pending invitations. */
    async listWorkspaceMembers(workspaceId: string): Promise<WorkspaceMembers> {
      return parseResponse(
        client.workspaces[':workspaceId'].members.$get({ param: { workspaceId } }),
        workspaceMembersSchema,
        onDiagnostic
      )
    },
    async inviteToWorkspace(
      workspaceId: string,
      input: CreateWorkspaceInvitationInput
    ): Promise<CreatedWorkspaceInvitation> {
      return parseResponse(
        client.workspaces[':workspaceId'].invitations.$post({
          param: { workspaceId },
          json: input
        }),
        createdWorkspaceInvitationSchema,
        onDiagnostic
      )
    },
    /** Sends a waiting invitation again; its earlier link stops working. */
    async resendWorkspaceInvitation(
      workspaceId: string,
      invitationId: string
    ): Promise<CreatedWorkspaceInvitation> {
      return parseResponse(
        client.workspaces[':workspaceId'].invitations[':invitationId'].resend.$post({
          param: { workspaceId, invitationId }
        }),
        createdWorkspaceInvitationSchema,
        onDiagnostic
      )
    },
    async revokeWorkspaceInvitation(workspaceId: string, invitationId: string): Promise<void> {
      await responseBody(
        await client.workspaces[':workspaceId'].invitations[':invitationId'].$delete({
          param: { workspaceId, invitationId }
        }),
        onDiagnostic
      )
    },
    async updateWorkspaceMember(
      workspaceId: string,
      userId: string,
      role: WorkspaceRole
    ): Promise<void> {
      await responseBody(
        await client.workspaces[':workspaceId'].members[':userId'].$patch({
          param: { workspaceId, userId },
          json: { role }
        }),
        onDiagnostic
      )
    },
    /** Removes someone from the workspace; with the person's own id, leaves it. */
    async removeWorkspaceMember(workspaceId: string, userId: string): Promise<void> {
      await responseBody(
        await client.workspaces[':workspaceId'].members[':userId'].$delete({
          param: { workspaceId, userId }
        }),
        onDiagnostic
      )
    },
    /** 词元开物: the faces in the team font library. */
    async listTeamFonts(): Promise<TeamFont[]> {
      const response = await parseResponse(client.fonts.$get(), teamFontListSchema, onDiagnostic)
      return response.fonts
    },
    /** Where to fetch a face's bytes from object storage; null when there is no such face. */
    async teamFontDownloadURL(id: string): Promise<string | null> {
      const response = await client.fonts[':id'].download.$get({ param: { id } })
      if (!response.ok) return null
      return v.parse(teamFontDownloadSchema, await response.json()).url
    },
    /** Adds a font file to the company font space. */
    async uploadTeamFont(file: File, license?: TeamFontLicense): Promise<TeamFont> {
      const form: { file: File; license?: TeamFontLicense } = { file }
      if (license) form.license = license
      const response = await parseResponse(
        client.fonts.$post({ form }),
        teamFontResponseSchema,
        onDiagnostic
      )
      return response.font
    },
    async setTeamFontLicense(id: string, license: TeamFontLicense): Promise<TeamFont> {
      const response = await parseResponse(
        client.fonts[':id'].$patch({ param: { id }, json: { license } }),
        teamFontResponseSchema,
        onDiagnostic
      )
      return response.font
    },
    async deleteTeamFont(id: string): Promise<void> {
      await responseBody(await client.fonts[':id'].$delete({ param: { id } }), onDiagnostic)
    },
    async getWorkspaceEntitlements(workspaceId: string): Promise<WorkspaceEntitlements> {
      const response = await parseResponse(
        client.workspaces[':workspaceId'].entitlements.$get({ param: { workspaceId } }),
        entitlementResponseSchema,
        onDiagnostic
      )
      return response.entitlements
    },
    async getUsage(workspaceId: string): Promise<WorkspaceUsage> {
      const response = await parseResponse(
        client.workspaces[':workspaceId'].usage.$get({
          param: { workspaceId }
        }),
        usageResponseSchema,
        onDiagnostic
      )
      return response.usage
    }
  }
}
