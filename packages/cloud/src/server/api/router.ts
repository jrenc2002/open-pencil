import { teamFontLicenseSchema, teamFontLicenseUpdateSchema } from '#cloud/contract'
import type { CloudAPIEnvironment } from '#cloud/server/api/types'
import type { CloudSessionResolver } from '#cloud/server/auth'
import { createBillingRoutes, type BillingTokenService } from '#cloud/server/billing'
import type { CollaborationTicketService } from '#cloud/server/collaboration'
import {
  createCollaborationRoutes,
  createPublicCollaborationRoutes
} from '#cloud/server/collaboration'
import { createCommunityRoutes, type CommunityService } from '#cloud/server/community'
import type { CloudDatabase } from '#cloud/server/db'
import type { DocumentService } from '#cloud/server/documents'
import { createDocumentRoutes } from '#cloud/server/documents'
import {
  createDocumentVersionRoutes,
  type DocumentVersionService
} from '#cloud/server/documents/versions'
import { TeamFontError, type TeamFontService } from '#cloud/server/fonts'
import type { EntitlementService } from '#cloud/server/policy'
import { createPublicReportRoutes, type DocumentReportService } from '#cloud/server/reports'
import { createServicesRoutes, type ServicesTokenService } from '#cloud/server/services'
import type { DocumentSharingService } from '#cloud/server/sharing'
import {
  createDocumentSharingRoutes,
  createPublicDocumentRoutes,
  createPublicSharingRoutes
} from '#cloud/server/sharing'
import type { StorageCredentialService } from '#cloud/server/storage-credentials'
import { workspaceParams, idParams, validatedJSON } from '#cloud/server/validation'
import type { WorkspaceMemberService, WorkspaceService } from '#cloud/server/workspaces'
import { createWorkspaceRoutes } from '#cloud/server/workspaces'
import { Hono, type Context } from 'hono'
import type { Kysely } from 'kysely'
import * as v from 'valibot'
export type CloudAPIServices = {
  database?: Kysely<CloudDatabase>
  rateLimitSecret?: string
  collaboration: CollaborationTicketService
  documents: DocumentService
  versions: DocumentVersionService
  /** The community gallery, which anyone may read. */
  community: CommunityService
  sharing: DocumentSharingService
  /** Reports about documents shared by link. */
  reports: DocumentReportService
  resolveSession?: CloudSessionResolver
  entitlements?: EntitlementService
  /** Signs service tokens; without it the deployment offers no services. */
  servicesTokens?: ServicesTokenService
  /** Signs billing tokens; without it the deployment sells nothing. */
  billingTokens?: BillingTokenService
  workspaces: WorkspaceService
  workspaceMembers: WorkspaceMemberService
  /** 词元开物: the team font library. */
  fonts?: TeamFontService
  /** 词元开物: temporary credentials for the editors' storage workspace. */
  storageCredentials?: StorageCredentialService | null
}

export function createPublicCloudAPIRouter(services: CloudAPIServices) {
  return new Hono<CloudAPIEnvironment>()
    .route('/', createPublicReportRoutes(services.reports, services.resolveSession))
    .route('/', createPublicSharingRoutes(services.sharing, services.resolveSession))
    .route(
      '/',
      createPublicDocumentRoutes(services.sharing, services.documents, services.resolveSession)
    )
    .route('/', createPublicCollaborationRoutes(services.collaboration, services.resolveSession))
    .route('/', createCommunityRoutes(services.community))
}

const TEAM_FONT_ERROR_STATUS = {
  not_found: 404,
  forbidden: 403,
  duplicate: 409,
  too_large: 413,
  unsupported_format: 415
} as const

const parseTeamFontLicenseUpdate = (input: unknown) => v.parse(teamFontLicenseUpdateSchema, input)

/** A font-space answer, or the error a font operation raised, with its status. */
async function fontResult<T extends object>(
  context: Context<CloudAPIEnvironment>,
  run: () => Promise<T>
) {
  try {
    return context.json(await run())
  } catch (error) {
    if (!(error instanceof TeamFontError)) throw error
    return context.json(
      { error: { code: error.code, message: error.message } },
      TEAM_FONT_ERROR_STATUS[error.code]
    )
  }
}

export function createCloudAPIRouter(services: CloudAPIServices) {
  return new Hono<CloudAPIEnvironment>()
    .route('/public', createPublicCloudAPIRouter(services))
    .get('/account/entitlements', async (context) => {
      if (!services.entitlements)
        return context.json({ error: { code: 'not_found' as const } }, 404)
      return context.json({
        entitlements: await services.entitlements.account(context.get('actor').userId)
      })
    })
    .get('/workspaces/:workspaceId/entitlements', workspaceParams, async (context) => {
      if (!services.entitlements)
        return context.json({ error: { code: 'not_found' as const } }, 404)
      return context.json({
        entitlements: await services.entitlements.workspace(
          context.get('actor').userId,
          context.req.valid('param').workspaceId
        )
      })
    })
    .get('/session', (context) => context.json({ user: context.get('actor') }))
    .get('/storage/credentials', async (context) => {
      if (!services.storageCredentials) {
        return context.json({ error: { code: 'not_found' as const } }, 404)
      }
      return context.json(await services.storageCredentials.issue(context.get('actor')))
    })
    .get('/fonts', async (context) => {
      if (!services.fonts) return context.json({ fonts: [] })
      return context.json({ fonts: await services.fonts.list() })
    })
    .get('/fonts/:id/download', idParams, async (context) => {
      const url = services.fonts
        ? await services.fonts.downloadURL(context.req.valid('param').id)
        : null
      if (!url) return context.json({ error: { code: 'not_found' as const } }, 404)
      return context.json({ url })
    })
    .get('/fonts/:id/file', idParams, async (context) => {
      const font = services.fonts ? await services.fonts.read(context.req.valid('param').id) : null
      if (!font) return context.json({ error: { code: 'not_found' as const } }, 404)
      return context.body(new Uint8Array(font.bytes), 200, {
        'Content-Type': font.contentType,
        'Cache-Control': 'private, max-age=86400'
      })
    })
    .post('/fonts', async (context) => {
      const fonts = services.fonts
      if (!fonts) return context.json({ error: { code: 'not_found' as const } }, 404)
      const form = await context.req.parseBody()
      const file = form.file
      if (!(file instanceof File)) {
        return context.json({ error: { code: 'invalid_request' as const } }, 400)
      }
      const text = (value: unknown) => (typeof value === 'string' ? value : undefined)
      const license = v.safeParse(teamFontLicenseSchema, form.license)
      return fontResult(context, async () => ({
        font: await fonts.add({
          fileName: file.name,
          bytes: new Uint8Array(await file.arrayBuffer()),
          family: text(form.family),
          style: text(form.style),
          license: license.success ? license.output : undefined,
          uploadedBy: context.get('actor').userId
        })
      }))
    })
    .patch('/fonts/:id', idParams, validatedJSON(parseTeamFontLicenseUpdate), async (context) => {
      const fonts = services.fonts
      if (!fonts) return context.json({ error: { code: 'not_found' as const } }, 404)
      const { id } = context.req.valid('param')
      const { license } = context.req.valid('json')
      return fontResult(context, async () => ({
        font: await fonts.setLicense(id, license, context.get('actor'))
      }))
    })
    .delete('/fonts/:id', idParams, async (context) => {
      const fonts = services.fonts
      if (!fonts) return context.json({ error: { code: 'not_found' as const } }, 404)
      const { id } = context.req.valid('param')
      return fontResult(context, async () => {
        await fonts.remove(id, context.get('actor'))
        return { ok: true as const }
      })
    })
    .route(
      '/',
      createServicesRoutes(
        services.servicesTokens,
        services.database && services.rateLimitSecret
          ? { database: services.database, secret: services.rateLimitSecret }
          : undefined
      )
    )
    .route(
      '/',
      createBillingRoutes(
        services.billingTokens,
        services.database && services.rateLimitSecret
          ? { database: services.database, secret: services.rateLimitSecret }
          : undefined
      )
    )
    .route(
      '/',
      createCollaborationRoutes(
        services.collaboration,
        services.database && services.rateLimitSecret
          ? { database: services.database, secret: services.rateLimitSecret }
          : undefined
      )
    )
    .route(
      '/',
      createDocumentRoutes(
        services.documents,
        services.database && services.rateLimitSecret
          ? { database: services.database, secret: services.rateLimitSecret }
          : undefined
      )
    )
    .route('/', createDocumentVersionRoutes(services.versions))
    .route(
      '/',
      createDocumentSharingRoutes(
        services.sharing,
        services.database && services.rateLimitSecret
          ? { database: services.database, secret: services.rateLimitSecret }
          : undefined
      )
    )
    .route(
      '/workspaces',
      createWorkspaceRoutes(
        services.workspaces,
        services.workspaceMembers,
        services.database && services.rateLimitSecret
          ? { database: services.database, secret: services.rateLimitSecret }
          : undefined
      )
    )
}

export type CloudAPI = ReturnType<typeof createCloudAPIRouter>
export type PublicCloudAPI = ReturnType<typeof createPublicCloudAPIRouter>
