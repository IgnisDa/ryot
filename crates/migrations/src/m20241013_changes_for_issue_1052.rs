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
DELETE FROM "daily_user_activity";
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
            db.execute_unprepared(&format!(
            r#"
DO $$
DECLARE
    workout_row RECORD;
    exercise_row jsonb;
    superset_with jsonb;
    superset_array jsonb := '[]'::jsonb;
    color_array text[] := ARRAY['red', 'pink', 'gray', 'teal', 'orange', 'yellow'];
    color_index int := 1;
    superset_exercises text[];
    exercise_identifier text;
    new_supersets jsonb;
BEGIN
    FOR workout_row IN SELECT id, information FROM "{x}"
    LOOP
        superset_array := '[]'::jsonb;
        color_index := 1;
        new_supersets := '[]'::jsonb;

        FOR exercise_row IN SELECT * FROM jsonb_array_elements(workout_row.information->'exercises')
        LOOP
            IF jsonb_array_length(exercise_row->'superset_with') > 0 THEN
                superset_exercises := array_append(superset_exercises, exercise_row->>'identifier');

                FOR superset_with IN SELECT * FROM jsonb_array_elements(exercise_row->'superset_with')
                LOOP
                    superset_exercises := array_append(superset_exercises, (workout_row.information->'exercises'->(superset_with::int))->>'identifier');
                END LOOP;

                superset_exercises := array(
                    SELECT unnest(superset_exercises) ORDER BY 1
                );

                IF NOT EXISTS (
                    SELECT 1
                    FROM jsonb_array_elements(new_supersets) AS existing_superset
                    WHERE (existing_superset->'exercises')::text = to_jsonb(superset_exercises)::text
                ) THEN
                    superset_array := jsonb_build_object(
                        'color', color_array[color_index],
                        'exercises', to_jsonb(superset_exercises),
                        'identifier', gen_random_uuid()
                    );

                    color_index := (color_index + 1) % array_length(color_array, 1);

                    new_supersets := new_supersets || superset_array;
                END IF;

                superset_exercises := ARRAY[]::text[];
            END IF;
        END LOOP;

        UPDATE "{x}"
        SET information = jsonb_set(
            workout_row.information,
            '{{supersets}}',
            new_supersets
        )
        WHERE id = workout_row.id;
    END LOOP;
END $$;
    "#
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
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
