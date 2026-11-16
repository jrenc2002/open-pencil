import type { StorageCredentials } from '#cloud/contract'
import type { CloudServerConfig } from '#cloud/server/config'
import { GetFederationTokenCommand, STSClient } from '@aws-sdk/client-sts'

/** Where the editors' storage workspace keeps its files in the company bucket. */
export const STORAGE_WORKSPACE_PREFIX = 'open_pencil_storage/'
/** How long the credentials an editor gets stay valid; editors fetch new ones before then. */
const CREDENTIAL_SECONDS = 12 * 60 * 60

/**
 * 词元开物: short-lived AWS credentials for the editors' storage workspace, so nobody types or
 * ships a key. Each set reaches only the storage workspace's prefix of the company bucket.
 * Null when object storage is not AWS S3, which has no STS to issue them.
 */
export function createStorageCredentialService(config: CloudServerConfig) {
  const endpoint = new URL(config.s3Endpoint)
  if (!endpoint.hostname.endsWith('.amazonaws.com')) return null
  const sts = new STSClient({
    region: config.s3Region,
    credentials: { accessKeyId: config.s3AccessKeyId, secretAccessKey: config.s3SecretAccessKey }
  })
  const bucket = `arn:aws:s3:::${config.s3Bucket}`
  const policy = JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: ['s3:ListBucket'],
        Resource: bucket,
        Condition: { StringLike: { 's3:prefix': [`${STORAGE_WORKSPACE_PREFIX}*`] } }
      },
      {
        Effect: 'Allow',
        Action: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject', 's3:AbortMultipartUpload'],
        Resource: `${bucket}/${STORAGE_WORKSPACE_PREFIX}*`
      }
    ]
  })
  return {
    async issue(user: { userId: string }): Promise<StorageCredentials> {
      const result = await sts.send(
        new GetFederationTokenCommand({
          // Names are at most 32 characters of [\w+=,.@-]; the account id keeps sessions apart.
          Name: `ciyuan-${user.userId.replace(/[^\w]/g, '').slice(0, 24)}`,
          Policy: policy,
          DurationSeconds: CREDENTIAL_SECONDS
        })
      )
      const credentials = result.Credentials
      if (
        !credentials?.AccessKeyId ||
        !credentials.SecretAccessKey ||
        !credentials.SessionToken ||
        !credentials.Expiration
      ) {
        throw new Error('STS returned no credentials')
      }
      return {
        endpoint: endpoint.origin,
        region: config.s3Region,
        bucket: config.s3Bucket,
        accessKeyId: credentials.AccessKeyId,
        secretAccessKey: credentials.SecretAccessKey,
        sessionToken: credentials.SessionToken,
        expiresAt: credentials.Expiration.toISOString()
      }
    }
  }
}

export type StorageCredentialService = NonNullable<
  ReturnType<typeof createStorageCredentialService>
>
