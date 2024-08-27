use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared(
            r#"
DO $$
DECLARE
    rec RECORD;
    new_history JSONB;
    best_set JSONB;
    history_element JSONB;
BEGIN
    -- Loop through each row in the user_to_entity table where exercise_extra_information is not null
    FOR rec IN
        SELECT id, exercise_extra_information
        FROM "user_to_entity"
        WHERE exercise_extra_information IS NOT NULL
    LOOP
        -- Initialize an empty array to store the new history with best_set
        new_history := '[]'::jsonb;

        -- Loop through each history element in exercise_extra_information
        FOR history_element IN
            SELECT * FROM jsonb_array_elements(rec.exercise_extra_information->'history')
        LOOP
            -- Build the new history element with the value
            new_history := new_history || jsonb_set(
                history_element,
                '{workout_end_on}',
                '"2024-08-26 00:43:30 +00:00"'
            );
        END LOOP;

        -- Update the exercise_extra_information field with the new history format
        UPDATE "user_to_entity"
        SET exercise_extra_information = jsonb_set(
            exercise_extra_information,
            '{history}',
            new_history
        )
        WHERE id = rec.id;
    END LOOP;
END $$;
"#,
        )
        .await?;
        if !manager.has_column("review", "exercise_id").await? {
            db.execute_unprepared(
            r#"
ALTER TABLE "review" ADD COLUMN "exercise_id" TEXT;
ALTER TABLE "review" ADD CONSTRAINT "review_to_exercise_foreign_key" FOREIGN KEY ("exercise_id") REFERENCES "exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;
            "#,
        )
        .await?;
        }
        if !manager.has_column("review", "entity_id").await? {
            db.execute_unprepared(
                r#"
ALTER TABLE "review" ADD COLUMN "entity_id" TEXT NOT NULL GENERATED ALWAYS AS (
    COALESCE(
        "metadata_id",
        "person_id",
        "metadata_group_id",
        "collection_id",
        "exercise_id"
    )
) STORED;
"#,
            )
            .await?;
        }
        db.execute_unprepared(
            r#"
ALTER TABLE "review" DROP COLUMN "entity_lot";
ALTER TABLE "review" ADD COLUMN "entity_lot" TEXT GENERATED ALWAYS AS (
    CASE
        WHEN "metadata_id" IS NOT NULL THEN 'metadata'
        WHEN "person_id" IS NOT NULL THEN 'person'
        WHEN "metadata_group_id" IS NOT NULL THEN 'metadata_group'
        WHEN "collection_id" IS NOT NULL THEN 'collection'
        WHEN "exercise_id" IS NOT NULL THEN 'exercise'
    END
) STORED;
"#,
        )
        .await?;
        db.execute_unprepared(
            r#"
ALTER TABLE "daily_user_activity" ADD COLUMN IF NOT EXISTS "exercise_review_count" INTEGER NOT NULL DEFAULT 0;
"#,
        )
        .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
