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
)
WHERE jsonb_array_length("information"->'exercises') > 0;

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
)
WHERE jsonb_array_length("summary"->'exercises') > 0;
                    "#,
            ))
            .await?;
            db.execute_unprepared(&format!(
            r#"
DO $$
DECLARE
    workout_record RECORD;
    workout_json jsonb;
    updated_json jsonb;
    superset_with jsonb;
    exercise jsonb;
    exercise_index int;
    superset_array jsonb := '[]'::jsonb;
    superset jsonb;
    color_options text[] := ARRAY['red', 'pink', 'yellow', 'gray', 'teal', 'green'];
BEGIN
    FOR workout_record IN SELECT id, information FROM "{x}" LOOP
        workout_json := workout_record.information;

        FOR exercise_index IN 0..jsonb_array_length(workout_json->'exercises')-1 LOOP
            exercise := workout_json->'exercises'->exercise_index;
            superset_with := exercise->'superset_with';

            IF jsonb_array_length(superset_with) > 0 THEN
                superset := jsonb_build_array(exercise_index) || superset_with;
                superset := (SELECT jsonb_agg(elem ORDER BY elem) FROM jsonb_array_elements(superset) AS elem);

                superset_array := jsonb_insert(superset_array, '{{-1}}', superset);
            END IF;
        END LOOP;

        IF jsonb_array_length(superset_array) > 0 THEN
            superset_array := (SELECT jsonb_agg(DISTINCT elem) FROM jsonb_array_elements(superset_array) AS elem);
	        superset_array := (
	            SELECT jsonb_agg(
	                jsonb_build_object('color', color_options[(row_num - 1) % array_length(color_options, 1) + 1], 'exercises', elem)
	            )
	            FROM (
	                SELECT elem, row_number() OVER () as row_num
	                FROM jsonb_array_elements(superset_array) AS elem
	            ) subquery
	        );

		END IF;

        updated_json := jsonb_set(workout_json, '{{supersets}}', superset_array);
        UPDATE "{x}" SET information = updated_json WHERE id = workout_record.id;

        superset_array := '[]'::jsonb;
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
