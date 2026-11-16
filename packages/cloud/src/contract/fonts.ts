import * as v from 'valibot'

/** Whether a font may be used commercially, as its license text or a person says. */
export const teamFontLicenseSchema = v.picklist(['commercial', 'non_commercial', 'unknown'])
export type TeamFontLicense = v.InferOutput<typeof teamFontLicenseSchema>

/** 词元开物: a face in the company font space, as editors and the console list it. */
export const teamFontSchema = v.object({
  id: v.string(),
  family: v.string(),
  style: v.string(),
  weight: v.number(),
  italic: v.boolean(),
  byteLength: v.number(),
  license: teamFontLicenseSchema,
  licenseNote: v.nullable(v.string()),
  uploadedBy: v.nullable(v.string()),
  uploaderName: v.nullable(v.string()),
  createdAt: v.string()
})
export const teamFontListSchema = v.object({ fonts: v.array(teamFontSchema) })
export const teamFontResponseSchema = v.object({ font: teamFontSchema })
export const teamFontDownloadSchema = v.object({ url: v.string() })
export const teamFontLicenseUpdateSchema = v.object({ license: teamFontLicenseSchema })
export type TeamFont = v.InferOutput<typeof teamFontSchema>
