import * as v from 'valibot'

const uuidSchema = v.pipe(v.string(), v.uuid())
/** Accounts and access requests are named by UUID; anything else names no row. */
export const isUUID = (value: string) => v.is(uuidSchema, value)

/** The most rows one admin list request returns. */
export const ADMIN_LIST_MAXIMUM = 500

export const enrollmentStatusSchema = v.picklist(['pending', 'approved', 'rejected', 'revoked'])
export const enrollmentReviewSchema = v.object({
  note: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(1000)))
})
export const userRoleMutationSchema = v.object({
  userId: v.pipe(v.string(), v.trim(), v.minLength(1)),
  enabled: v.boolean()
})

export const userMutationSchema = v.object({
  userId: v.pipe(v.string(), v.trim(), v.minLength(1)),
  reason: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(500)))
})

/** Why an administrator takes a document down, which the audit log keeps. */
export const documentTakedownSchema = v.object({
  reason: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(500)))
})

export type EnrollmentReview = v.InferOutput<typeof enrollmentReviewSchema>

export const parseEnrollmentReview = (input: unknown) => v.parse(enrollmentReviewSchema, input)
export const parseUserMutation = (input: unknown) => v.parse(userMutationSchema, input)
export const parseUserRoleMutation = (input: unknown) => v.parse(userRoleMutationSchema, input)

export const createMembersSchema = v.object({
  members: v.pipe(
    v.array(
      v.object({
        email: v.pipe(v.string(), v.trim(), v.toLowerCase(), v.email(), v.maxLength(254)),
        name: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(80)))
      })
    ),
    v.minLength(1),
    v.maxLength(100)
  )
})
export const parseCreateMembers = (input: unknown) => v.parse(createMembersSchema, input)
export const parseDocumentTakedown = (input: unknown) => v.parse(documentTakedownSchema, input)
