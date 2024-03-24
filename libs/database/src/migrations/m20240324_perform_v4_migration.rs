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
        // for user_to_entity
        db.execute_unprepared(
            r#"
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT id, exercise_extra_information FROM user_to_entity
    LOOP
        UPDATE user_to_entity
        SET exercise_extra_information = jsonb_set(
            r.exercise_extra_information,
            '{personal_bests}',
            (
                SELECT jsonb_agg(
                    jsonb_set(
                        pb,
                        '{sets}',
                        (
                            SELECT jsonb_agg(
                                jsonb_set(set, '{exercise_idx}', '0')
                            )
                            FROM jsonb_array_elements(pb->'sets') AS set
                        )
                    )
                )
                FROM jsonb_array_elements(r.exercise_extra_information->'personal_bests') AS pb
            )
        )
        WHERE id = r.id;
    END LOOP;
END $$;

DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT id, exercise_extra_information FROM user_to_entity
    LOOP
        UPDATE user_to_entity
        SET exercise_extra_information = jsonb_set(
            r.exercise_extra_information,
            '{personal_bests}',
            (
                SELECT jsonb_agg(
                    jsonb_set(
                        pb,
                        '{sets}',
                        (
                            SELECT jsonb_agg(
                                jsonb_set(set, '{workout_done_on}', '2022-08-18T02:05:03Z')
                            )
                            FROM jsonb_array_elements(pb->'sets') AS set
                        )
                    )
                )
                FROM jsonb_array_elements(r.exercise_extra_information->'personal_bests') AS pb
            )
        )
        WHERE id = r.id;
    END LOOP;
END $$;
"#,
        )
        .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
