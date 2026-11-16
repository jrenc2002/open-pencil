import * as v from 'valibot'

/** 词元开物: a face in the team font library, as editors and the console list it. */
export const teamFontSchema = v.object({
  id: v.string(),
  family: v.string(),
  style: v.string(),
  weight: v.number(),
  italic: v.boolean(),
  byteLength: v.number(),
  createdAt: v.string()
})
export const teamFontListSchema = v.object({ fonts: v.array(teamFontSchema) })
export const teamFontResponseSchema = v.object({ font: teamFontSchema })
export type TeamFont = v.InferOutput<typeof teamFontSchema>
