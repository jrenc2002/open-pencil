import type { StorageCredentials } from '@open-pencil/cloud/contract'

import { StorageUnavailableError } from '@/app/integrations/storage/errors'
import type { S3CompatibleConfig } from '@/app/integrations/storage/s3/types'

import { homeCloudServer } from '../servers/store'
import { cloudAPIClient, cloudConnection } from '../sessions/connection'

/** 词元开物: the storage workspace in the company bucket, reached with the server's credentials. */
export const COMPANY_STORAGE_PROVIDER_ID = 'ciyuan-aws'

/** Credentials are fetched again this long before they expire. */
const REFRESH_MARGIN_MS = 10 * 60 * 1000

let cached: { key: string; credentials: StorageCredentials } | null = null
let pending: Promise<StorageCredentials> | null = null

/** The storage workspace's config, with temporary credentials for the account on Home. */
export async function companyStorageConfig(): Promise<S3CompatibleConfig> {
  const server = homeCloudServer.value
  const connection = server ? cloudConnection(server.id) : null
  if (
    !server ||
    connection?.state !== 'signed-in' ||
    !connection.discovery ||
    !connection.account
  ) {
    throw new StorageUnavailableError('登录词元开物后即可使用 AWS 存储工作区')
  }
  const key = `${server.id}:${connection.account.id}`
  const fresh =
    cached?.key === key && Date.parse(cached.credentials.expiresAt) - Date.now() > REFRESH_MARGIN_MS
  if (!fresh) {
    pending ??= cloudAPIClient(server, connection.discovery)
      .storageCredentials()
      .finally(() => {
        pending = null
      })
    cached = { key, credentials: await pending }
  }
  const credentials = cached?.credentials
  if (!credentials) throw new StorageUnavailableError('AWS 存储工作区暂时不可用')
  return {
    endpoint: credentials.endpoint,
    bucket: credentials.bucket,
    region: credentials.region,
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    sessionToken: credentials.sessionToken
  }
}
