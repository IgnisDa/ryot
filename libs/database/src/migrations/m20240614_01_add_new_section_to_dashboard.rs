use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared(
            r#"
UPDATE "user"
SET preferences = jsonb_set(
  preferences,
  '{general, dashboard}',
  (
    COALESCE(
      preferences->'general'->'dashboard'::text, '[]'::jsonb) ||
      '[{"hidden": false, "section": "RECOMMENDATIONS", "numElements": 8}]'
  )::jsonb,
  false
)
WHERE preferences->'general'->'dashboard' IS NOT NULL;
            "#,
        )
        .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
