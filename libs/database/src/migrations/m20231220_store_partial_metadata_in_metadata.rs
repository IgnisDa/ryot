use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let conn = manager.get_connection();
        conn.execute_unprepared(
            r#"
alter table metadata add column if not exists is_partial bool;
"#,
        )
        .await?;
        if manager.has_table("partial_metadata").await? {
            conn.execute_unprepared(
    r#"
    INSERT INTO metadata (identifier, title, source, lot, images, is_partial)
    SELECT
      identifier,
      title,
      source,
      lot,
      CASE
        WHEN image IS NOT NULL THEN jsonb_build_array(jsonb_build_object('lot', 'Poster', 'url', jsonb_build_object('Url', image)))
        ELSE NULL
      END,
      true
    FROM
      partial_metadata
    ON CONFLICT DO NOTHING;

    INSERT INTO metadata_to_metadata (to_metadata_id, from_metadata_id, relation)
    SELECT
      mtpm.metadata_id AS from_metadata_id,
      (select id from metadata where identifier = pm.identifier and source = pm.source and lot = pm.lot) AS to_metadata_id,
      mtpm.relation AS relation
    FROM
      metadata_to_partial_metadata mtpm
    JOIN
      partial_metadata pm ON mtpm.partial_metadata_id = pm.id
    ON CONFLICT DO NOTHING;

    INSERT INTO metadata_to_metadata_group (metadata_id, metadata_group_id, part)
    SELECT
      (select id from metadata where identifier = pm.identifier and source = pm.source and lot = pm.lot) AS metadata_id,
      mtpm.metadata_group_id,
      mtpm.part
    FROM
      partial_metadata_to_metadata_group mtpm
    JOIN
      partial_metadata pm ON mtpm.partial_metadata_id = pm.id
    ON CONFLICT DO NOTHING;
"#,
  )
  .await?;
        }

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
