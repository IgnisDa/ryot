use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        // for user summary
        db.execute_unprepared(
            r#"
UPDATE "user"
SET summary = jsonb_set(
  summary,
  '{media, metadata_overall}',
  '{"reviewed": 0, "interacted_with": 0}',
  false
)
WHERE summary->'media'->'metadata_overall' IS NULL;

UPDATE "user"
SET summary = jsonb_set(
  summary,
  '{media, people_overall}',
  '{"reviewed": 0, "interacted_with": 0}',
  false
)
WHERE summary->'media'->'people_overall' IS NULL;

UPDATE "user"
SET summary = jsonb_set(
  summary,
  '{fitness, workouts}',
  '{"weight": "0", "duration": 0, "recorded": 0}',
  false
)
WHERE summary->'fitness'->'workouts' IS NULL;

UPDATE "user"
SET summary = jsonb_set(
  summary,
  '{calculated_from_beginning}',
  'false',
  false
)
WHERE summary->'calculated_from_beginning' IS NULL;

UPDATE "user"
SET summary = jsonb_set(
  summary,
  '{unique_items, anime_episodes}',
  '[]',
  false
)
WHERE summary->'unique_items'->'anime_episodes' IS NULL;

UPDATE "user"
SET summary = jsonb_set(
  summary,
  '{unique_items, manga_chapters}',
  '[]',
  false
)
WHERE summary->'unique_items'->'manga_chapters' IS NULL;
"#,
        )
        .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
