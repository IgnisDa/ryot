use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();

        db.execute_unprepared(
            r#"
UPDATE "workout" SET "id" = 'wor_' || "id";
            "#,
        )
        .await?;

        db.execute_unprepared(
            r#"
UPDATE "exercise" SET "lot" = CASE "lot"
    WHEN 'Duration' THEN 'duration'
    WHEN 'DistanceAndDuration' THEN 'distance_and_duration'
    WHEN 'Reps' THEN 'reps'
    WHEN 'RepsAndWeight' THEN 'reps_and_weight'
    ELSE "lot"
END;
            "#,
        )
        .await?;

        db.execute_unprepared(
            r#"
UPDATE "user_to_entity" SET "exercise_extra_information" =
'{"history": [], "personal_bests": [], "lifetime_stats": {"personal_bests_achieved": 0,
"weight": "0", "reps": 0, "distance": "0", "duration": "0"}}'
WHERE "exercise_extra_information" IS NOT NULL;
            "#,
        )
        .await?;

        db.execute_unprepared(
            r#"
DO $$
DECLARE
    rec RECORD;
    new_information_exercises jsonb;
    exercise jsonb;
BEGIN
    FOR rec IN
        SELECT id, information
        FROM workout
    LOOP
        -- Update exercises in information
        new_information_exercises := '[]'::jsonb;
        FOR exercise IN SELECT * FROM jsonb_array_elements(rec.information->'exercises')
        LOOP
            new_information_exercises := new_information_exercises || jsonb_set(
                exercise,
                '{lot}',
                to_jsonb(CASE
                    WHEN exercise->>'lot' = 'Duration' THEN 'duration'
                    WHEN exercise->>'lot' = 'DistanceAndDuration' THEN 'distance_and_duration'
                    WHEN exercise->>'lot' = 'Reps' THEN 'reps'
                    WHEN exercise->>'lot' = 'RepsAndWeight' THEN 'reps_and_weight'
                    ELSE exercise->>'lot'
                END)
            );
        END LOOP;

        -- Update both summary and information in a single update statement
        UPDATE workout
        SET summary = '{"exercises": [], "total": {"personal_bests_achieved": 0, "weight": "0", "reps": 0, "distance": "0", "duration": "0"}}',
            information = jsonb_set(
                rec.information,
                '{exercises}',
                new_information_exercises
            )
        WHERE id = rec.id;
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
