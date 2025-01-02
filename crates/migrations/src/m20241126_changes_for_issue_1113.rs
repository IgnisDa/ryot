use sea_orm_migration::prelude::*;

use super::{
    m20230822_create_exercise::EXERCISE_NAME_INDEX,
    m20240827_create_daily_user_activity::create_daily_user_activity_table,
};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        if !manager.has_column("daily_user_activity", "id").await? {
            db.execute_unprepared("DROP TABLE daily_user_activity")
                .await?;
            create_daily_user_activity_table(manager).await?;
        }
        if !manager.has_column("exercise", "name").await? {
            db.execute_unprepared(&format!(
                r#"
UPDATE exercise SET identifier = id;
ALTER TABLE exercise RENAME COLUMN identifier TO name;
DROP INDEX "exercise__identifier__index";
CREATE INDEX "{}" ON "exercise" ("name");
              "#,
                EXERCISE_NAME_INDEX
            ))
            .await?;
            for table in ["workout", "workout_template"] {
                db.execute_unprepared(&format!(
                    r#"
UPDATE "{table}"
SET information =
    JSONB_SET(
        information,
        '{{exercises}}',
        (
            SELECT JSONB_AGG(
                JSONB_SET(
                    exercise,
                    '{{id}}',
                    exercise->'name',
                    true
                ) - 'name'
            )
            FROM JSONB_ARRAY_ELEMENTS(information->'exercises') AS exercise
        )
    ),
    summary =
    JSONB_SET(
        summary,
        '{{exercises}}',
        (
            SELECT JSONB_AGG(
                JSONB_SET(
                    exercise,
                    '{{id}}',
                    exercise->'name',
                    true
                ) - 'name'
            )
            FROM JSONB_ARRAY_ELEMENTS(summary->'exercises') AS exercise
        )
    );
            "#,
                ))
                .await?;
            }
        }
        db.execute_unprepared(
            r#"
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'exercise'
          AND column_name = 'muscles'
          AND data_type = 'jsonb'
    ) THEN
        ALTER TABLE exercise ADD COLUMN muscles_text_array text[];
        UPDATE exercise
        SET muscles_text_array = ARRAY(SELECT jsonb_array_elements_text(muscles));
        ALTER TABLE exercise DROP COLUMN muscles;
        ALTER TABLE exercise RENAME COLUMN muscles_text_array TO muscles;
    END IF;
END $$;
        "#,
        )
        .await?;
        if !manager.has_column("application_cache", "value").await? {
            db.execute_unprepared(
                r#"
ALTER TABLE "application_cache" ADD COLUMN "value" JSONB;
UPDATE "application_cache" SET "value" = '"Empty"'::jsonb;
ALTER TABLE "application_cache" ALTER COLUMN "value" SET NOT NULL;
"#,
            )
            .await?;
        }
        db.execute_unprepared(
            r#"
UPDATE "user" SET "extra_information" = JSONB_BUILD_OBJECT('scheduled_for_workout_revision', true);
        "#,
        )
        .await?;
        db.execute_unprepared(
            r#"
UPDATE "user" SET "preferences" = jsonb_set(
    "preferences", '{features_enabled,analytics}',
    JSONB_BUILD_OBJECT('enabled', true)
);
        "#,
        )
        .await?;
        db.execute_unprepared(
            r#"
UPDATE "integration" SET "provider" = 'plex_sink' WHERE "provider" = 'plex';
UPDATE "integration" SET "provider_specifics" = jsonb_set(
    "provider_specifics",
    '{plex_sink_username}',
    "provider_specifics"->'plex_username'
) - 'plex_username' WHERE "provider_specifics" -> 'plex_username' IS NOT NULL;
            "#,
        )
        .await?;
        db.execute_unprepared(
            r#"
UPDATE "user_to_entity" SET "exercise_extra_information" = jsonb_set("exercise_extra_information", '{settings,exclude_from_analytics}', 'false')
WHERE "exercise_extra_information" IS NOT NULL;
            "#,
        )
        .await?;
        db.execute_unprepared(
            r#"
UPDATE "user"
SET preferences =
    jsonb_set(
        preferences,
        '{general, dashboard}',
        (
            SELECT jsonb_agg(element)
            FROM jsonb_array_elements(preferences->'general'->'dashboard') AS element
            WHERE element->>'section' != 'ACTIVITY'
        )
    );
            "#,
        )
        .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
