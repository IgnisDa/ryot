use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();

        // Update workout table
        db.execute_unprepared(
            r#"
            WITH user_unit_systems AS (
                SELECT
                    id,
                    preferences->'fitness'->'exercises'->>'unit_system' as unit_system
                FROM "user"
            )
            UPDATE workout
            SET information = jsonb_set(
                information,
                '{exercises}',
                (
                    SELECT jsonb_agg(
                        CASE
                            WHEN exercise ? 'unit_system' THEN
                                exercise
                            ELSE
                                jsonb_set(
                                    exercise,
                                    '{unit_system}',
                                    to_jsonb(us.unit_system)
                                )
                        END
                    )
                    FROM jsonb_array_elements(information->'exercises') exercise
                ),
                true
            )
            FROM user_unit_systems us
            WHERE workout.user_id = us.id
            AND information ? 'exercises'
            AND jsonb_array_length(information->'exercises') > 0;
            "#,
        )
        .await?;

        // Update workout table - summary column
        db.execute_unprepared(
            r#"
            WITH user_unit_systems AS (
                SELECT
                    id,
                    preferences->'fitness'->'exercises'->>'unit_system' as unit_system
                FROM "user"
            )
            UPDATE workout
            SET summary = jsonb_set(
                summary,
                '{exercises}',
                (
                    SELECT jsonb_agg(
                        CASE
                            WHEN exercise ? 'unit_system' THEN
                                exercise
                            ELSE
                                jsonb_set(
                                    exercise,
                                    '{unit_system}',
                                    to_jsonb(us.unit_system)
                                )
                        END
                    )
                    FROM jsonb_array_elements(summary->'exercises') exercise
                ),
                true
            )
            FROM user_unit_systems us
            WHERE workout.user_id = us.id
            AND summary ? 'exercises'
            AND jsonb_array_length(summary->'exercises') > 0;
            "#,
        )
        .await?;

        // Update workout_template table
        db.execute_unprepared(
            r#"
            WITH user_unit_systems AS (
                SELECT
                    id,
                    preferences->'fitness'->'exercises'->>'unit_system' as unit_system
                FROM "user"
            )
            UPDATE workout_template
            SET information = jsonb_set(
                information,
                '{exercises}',
                (
                    SELECT jsonb_agg(
                        CASE
                            WHEN exercise ? 'unit_system' THEN
                                exercise
                            ELSE
                                jsonb_set(
                                    exercise,
                                    '{unit_system}',
                                    to_jsonb(us.unit_system)
                                )
                        END
                    )
                    FROM jsonb_array_elements(information->'exercises') exercise
                ),
                true
            )
            FROM user_unit_systems us
            WHERE workout_template.user_id = us.id
            AND information ? 'exercises'
            AND jsonb_array_length(information->'exercises') > 0;
            "#,
        )
        .await?;

        // Update workout_template table - summary column
        db.execute_unprepared(
            r#"
            WITH user_unit_systems AS (
                SELECT
                    id,
                    preferences->'fitness'->'exercises'->>'unit_system' as unit_system
                FROM "user"
            )
            UPDATE workout_template
            SET summary = jsonb_set(
                summary,
                '{exercises}',
                (
                    SELECT jsonb_agg(
                        CASE
                            WHEN exercise ? 'unit_system' THEN
                                exercise
                            ELSE
                                jsonb_set(
                                    exercise,
                                    '{unit_system}',
                                    to_jsonb(us.unit_system)
                                )
                        END
                    )
                    FROM jsonb_array_elements(summary->'exercises') exercise
                ),
                true
            )
            FROM user_unit_systems us
            WHERE workout_template.user_id = us.id
            AND summary ? 'exercises'
            AND jsonb_array_length(summary->'exercises') > 0;
            "#,
        )
        .await?;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
