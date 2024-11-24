use sea_orm_migration::prelude::*;

const NEW_DUA_COLUMNS: [&str; 3] = ["workout_muscles", "workout_exercises", "workout_equipments"];

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared("TRUNCATE daily_user_activity")
            .await?;
        for col in NEW_DUA_COLUMNS {
            if !manager.has_column("daily_user_activity", col).await? {
                db.execute_unprepared(&format!(
                    r#"ALTER TABLE "daily_user_activity" ADD COLUMN "{}" TEXT[] NOT NULL DEFAULT '{{}}'"#,
                    col,
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
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
