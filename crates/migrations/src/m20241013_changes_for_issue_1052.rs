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
SET "preferences" = jsonb_set(
    "preferences",
    '{fitness,exercises,set_rest_timers}',
    jsonb_build_object('normal', 60)
);
ALTER TABLE "workout_template" DROP COLUMN IF EXISTS "default_rest_timer";
        "#,
        )
        .await?;
        for x in ["workout", "workout_template"] {
            db.execute_unprepared(&format!(
                r#"
UPDATE "{x}"
SET "information" = jsonb_set(
    "information",
    '{{exercises}}',
    (
    SELECT jsonb_agg(
        jsonb_set(
            exercise,
            '{{identifier}}',
            to_jsonb(gen_random_uuid())
            )
        )
        FROM jsonb_array_elements("information"->'exercises') AS exercise
    )
);

UPDATE "{x}"
SET "summary" = jsonb_set(
    "summary",
    '{{exercises}}',
    (
        SELECT jsonb_agg(
            jsonb_set(
                exercise - 'id',
                '{{name}}',
                exercise->'id'
            )
        )
        FROM jsonb_array_elements("summary"->'exercises') AS exercise
    )
);
                    "#,
            ))
            .await?;
        }
        db.execute_unprepared(
            r#"
UPDATE "user_to_entity"
SET "exercise_extra_information" = jsonb_set(
    "exercise_extra_information",
    '{settings}',
    jsonb_build_object('set_rest_timers', jsonb_build_object('normal', 60))
)
WHERE "user_to_entity"."exercise_extra_information" IS NOT NULL;
        "#,
        )
        .await?;
        db.execute_unprepared(
            r#"
DO $$
DECLARE
    workout_row RECORD;
BEGIN
    FOR workout_row IN SELECT id, information FROM workout
    LOOP
        UPDATE workout
        SET information = jsonb_set(
            workout_row.information,
            '{exercises}',
            (
                SELECT jsonb_agg(
                    CASE
                        WHEN (exercise->>'rest_time')::int > 0 THEN
                            jsonb_set(exercise, '{sets}', (
                                SELECT jsonb_agg(jsonb_set(set_row, '{rest_time}', exercise->'rest_time'))
                                FROM jsonb_array_elements(exercise->'sets') AS set_row
                            ))
                        ELSE
                            exercise
                    END
                )
                FROM jsonb_array_elements(workout_row.information->'exercises') AS exercise
            )
        )
        WHERE id = workout_row.id;
    END LOOP;
END $$;
        "#,
        )
        .await?;
        db.execute_unprepared(&format!(
            r#"
UPDATE "workout" SET "information" = jsonb_set("information", '{{supersets}}', '[]'::jsonb);
UPDATE "workout_template" SET "information" = jsonb_set("information", '{{supersets}}', '[]'::jsonb);
    "#
        ))
        .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
