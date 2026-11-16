export type S3CompatibleConfig = {
  /** Set for temporary credentials, such as those the company server issues. */
  sessionToken?: string
  endpoint: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  region?: string
}

export type S3ConnectionResult = {
  ok: boolean
  message: string
  corsApplied: boolean
  isCORSFailure: boolean
  corsError: string | null
}
