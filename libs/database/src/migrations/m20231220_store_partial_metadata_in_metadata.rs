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
"#,
        )
        .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
