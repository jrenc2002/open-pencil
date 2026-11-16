import { sql, type Kysely } from 'kysely'

/**
 * 词元开物: whether each team font may be used commercially, as its own license text or an
 * administrator says, and that text kept beside it.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .alterTable('team_font')
    .addColumn('license', 'text', (column) =>
      column
        .notNull()
        .defaultTo('unknown')
        .check(sql`license in ('commercial', 'non_commercial', 'unknown')`)
    )
    .addColumn('license_note', 'text')
    .execute()
  await database.schema
    .createIndex('team_font_license_idx')
    .on('team_font')
    .column('license')
    .execute()
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema.dropIndex('team_font_license_idx').execute()
  await database.schema
    .alterTable('team_font')
    .dropColumn('license_note')
    .dropColumn('license')
    .execute()
}
