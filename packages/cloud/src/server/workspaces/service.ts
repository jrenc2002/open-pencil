import type { CreateWorkspaceInput, WorkspaceSummary } from '#cloud/contract'
import type { CloudDatabase } from '#cloud/server/db'
import {
  findWorkspace,
  insertWorkspace,
  insertWorkspaceMember,
  listWorkspaces
} from '#cloud/server/workspaces/repository'
import type { Kysely } from 'kysely'

export class WorkspaceSlugConflictError extends Error {
  constructor(readonly slug: string) {
    super(`Workspace slug is already in use: ${slug}`)
    this.name = 'WorkspaceSlugConflictError'
  }
}

function fallbackSlug(name: string): string {
  const normalized = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
  return normalized.length >= 3 ? normalized : 'workspace'
}

function generatedSlug(name: string): string {
  return `${fallbackSlug(name)}-${crypto.randomUUID().slice(0, 8)}`
}

function personalWorkspaceName(name: string): string {
  const first = name.trim().split(/\s+/)[0]
  return first ? `${first} 的个人空间` : '个人空间'
}

/** 词元开物: the workspace every approved account joins, beside its own personal one. */
export const COMPANY_WORKSPACE_SLUG = 'company'
export const COMPANY_WORKSPACE_NAME = '词元开物'

export function createWorkspaceService(database: Kysely<CloudDatabase>) {
  return {
    list(userId: string): Promise<WorkspaceSummary[]> {
      return listWorkspaces(database, userId)
    },

    get(userId: string, workspaceId: string): Promise<WorkspaceSummary | undefined> {
      return findWorkspace(database, userId, workspaceId)
    },

    async create(userId: string, input: CreateWorkspaceInput): Promise<WorkspaceSummary> {
      const workspaceId = crypto.randomUUID()
      const slug = input.slug ?? generatedSlug(input.name)
      await database.transaction().execute(async (transaction) => {
        const inserted = await insertWorkspace(transaction, userId, {
          ...input,
          id: workspaceId,
          slug
        })
        if (!inserted) throw new WorkspaceSlugConflictError(slug)
        await insertWorkspaceMember(transaction, workspaceId, userId, 'admin')
      })
      const workspace = await findWorkspace(database, userId, workspaceId)
      if (!workspace) throw new Error('Created workspace could not be read')
      return workspace
    },

    /**
     * Gives an active account with no workspace one of its own, so it has somewhere to save. The
     * slug is fixed per person, so concurrent calls make one workspace and later calls none.
     */
    async ensurePersonal(user: { userId: string; name: string }): Promise<void> {
      // By its own slug: membership of the company workspace must not stand in for it.
      const slug = `personal-${user.userId}`
      const existing = await database
        .selectFrom('workspace')
        .select('id')
        .where('slug', '=', slug)
        .executeTakeFirst()
      if (existing) return
      const workspaceId = crypto.randomUUID()
      await database.transaction().execute(async (transaction) => {
        const inserted = await insertWorkspace(transaction, user.userId, {
          id: workspaceId,
          name: personalWorkspaceName(user.name),
          slug: `personal-${user.userId}`
        })
        if (inserted) await insertWorkspaceMember(transaction, workspaceId, user.userId, 'admin')
      })
    },

    /**
     * Puts an active account in the company workspace, creating it the first time. Its owner is
     * the earliest deployment administrator, so the company's plan, not a member's, backs it.
     * Deployment administrators join as workspace admins, everyone else as editors; a role an
     * administrator changed later is kept.
     */
    async ensureCompanyMember(user: { userId: string }): Promise<string> {
      let workspace = await database
        .selectFrom('workspace')
        .select('id')
        .where('slug', '=', COMPANY_WORKSPACE_SLUG)
        .executeTakeFirst()
      if (!workspace) {
        const owner = await database
          .selectFrom('user')
          .select('id')
          .where('role', '=', 'admin')
          .orderBy('createdAt', 'asc')
          .executeTakeFirst()
        await insertWorkspace(database, owner?.id ?? user.userId, {
          id: crypto.randomUUID(),
          name: COMPANY_WORKSPACE_NAME,
          slug: COMPANY_WORKSPACE_SLUG
        })
        workspace = await database
          .selectFrom('workspace')
          .select('id')
          .where('slug', '=', COMPANY_WORKSPACE_SLUG)
          .executeTakeFirstOrThrow()
      }
      const account = await database
        .selectFrom('user')
        .select('role')
        .where('id', '=', user.userId)
        .executeTakeFirst()
      await database
        .insertInto('workspaceMember')
        .values({
          workspaceId: workspace.id,
          userId: user.userId,
          role: account?.role === 'admin' ? 'admin' : 'editor'
        })
        .onConflict((conflict) => conflict.columns(['workspaceId', 'userId']).doNothing())
        .execute()
      return workspace.id
    }
  }
}

export type WorkspaceService = ReturnType<typeof createWorkspaceService>
