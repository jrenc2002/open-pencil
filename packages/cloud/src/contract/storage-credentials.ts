import * as v from 'valibot'

/** 词元开物: temporary AWS credentials for the editors' storage workspace in the company bucket. */
export const storageCredentialsSchema = v.object({
  endpoint: v.string(),
  region: v.string(),
  bucket: v.string(),
  accessKeyId: v.string(),
  secretAccessKey: v.string(),
  sessionToken: v.string(),
  expiresAt: v.string()
})
export type StorageCredentials = v.InferOutput<typeof storageCredentialsSchema>
