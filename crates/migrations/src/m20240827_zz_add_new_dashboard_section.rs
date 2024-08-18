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
    CASE
      WHEN NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(preferences->'general'->'dashboard', '[]'::jsonb)) AS elem
        WHERE elem->>'section' = 'ACTIVITY'
      )
      THEN jsonb_build_array(jsonb_build_object('hidden', false, 'section', 'ACTIVITY')) || COALESCE(preferences->'general'->'dashboard', '[]'::jsonb)
      ELSE COALESCE(preferences->'general'->'dashboard', '[]'::jsonb)
    END
  )::jsonb,
  true
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