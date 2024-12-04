use sea_orm_migration::prelude::*;

use crate::m20240827_create_daily_user_activity::create_daily_user_activity_table;

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
            db.execute_unprepared(r#"ALTER TABLE "application_cache" ADD COLUMN "value" JSONB;"#)
                .await?;
        }
        db.execute_unprepared(r#"
UPDATE "user" SET "preferences" = jsonb_set("preferences", '{features_enabled,fitness,analytics}', 'true');
        "#)
        .await?;
        db.execute_unprepared(
            r#"ALTER TABLE application_cache ALTER COLUMN expires_at SET NOT NULL;"#,
        )
        .await?;
        db.execute_unprepared(
            r#"
UPDATE "user_to_entity" SET "exercise_extra_information" = jsonb_set("exercise_extra_information", '{settings,exclude_from_analytics}', 'false')
WHERE "exercise_extra_information" IS NOT NULL;
            "#,
        )
        .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
