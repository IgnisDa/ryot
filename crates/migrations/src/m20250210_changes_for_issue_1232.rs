use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        if !manager.has_column("integration", "trigger_result").await? {
            db.execute_unprepared(
                r#"
ALTER TABLE "integration" ADD COLUMN "trigger_result" JSONB NOT NULL DEFAULT '[]'::JSONB;

UPDATE "integration" i SET "trigger_result" = JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('finished_at', i."last_triggered_on"))
WHERE i."last_triggered_on" IS NOT NULL;
"#,
            )
            .await?;
        }
        if !manager
            .has_column("integration", "last_finished_at")
            .await?
        {
            db.execute_unprepared(
                r#"
ALTER TABLE "integration" ADD COLUMN "last_finished_at" TIMESTAMPTZ;

UPDATE "integration" i SET "last_finished_at" = i."last_triggered_on"
WHERE i."last_triggered_on" IS NOT NULL;
                "#,
            )
            .await?;
        }
        if manager
            .has_column("integration", "last_triggered_on")
            .await?
        {
            db.execute_unprepared(r#"ALTER TABLE "integration" DROP COLUMN "last_triggered_on";"#)
                .await?;
        }
        db.execute_unprepared(
            r#"
UPDATE
  "user"
SET
  preferences = JSONB_SET(
    preferences,
    '{notifications,to_send}',
    (preferences -> 'notifications' -> 'to_send') || '"IntegrationDisabledDueToTooManyErrors"'
  )
where
  NOT (
    preferences -> 'notifications' -> 'to_send' ? 'IntegrationDisabledDueToTooManyErrors'
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
