import type { Kysely } from 'kysely'

import { now, required } from './schema'

/**
 * 词元开物: the team font library. Administrators upload font files once; every editor signed in
 * to the server lists the families and loads a face's bytes from object storage when it draws it.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('team_font')
    .addColumn('id', 'uuid', (column) => column.primaryKey())
    .addColumn('family', 'text', required)
    .addColumn('style', 'text', required)
    .addColumn('weight', 'integer', required)
    .addColumn('italic', 'boolean', required)
    .addColumn('object_key', 'text', (column) => column.notNull().unique())
    .addColumn('byte_length', 'integer', required)
    .addColumn('content_type', 'text', required)
    .addColumn('uploaded_by', 'text')
    .addColumn('created_at', 'timestamptz', now)
    .execute()
  await database.schema
    .createIndex('team_font_family_style_key')
    .on('team_font')
    .columns(['family', 'style'])
    .unique()
    .execute()
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema.dropTable('team_font').execute()
}
