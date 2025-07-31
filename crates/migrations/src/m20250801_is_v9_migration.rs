use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared(
            r#"
ALTER TABLE "application_cache" ALTER COLUMN "version" DROP NOT NULL;
ALTER TABLE "application_cache" ALTER COLUMN "expires_at" SET NOT NULL;

ALTER TABLE "user_notification" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "user_notification" ALTER COLUMN "id" TYPE text;
ALTER TABLE "user_notification" ADD COLUMN IF NOT EXISTS "created_on" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "last_activity_on" TIMESTAMP WITH TIME ZONE;

UPDATE "user_notification" SET "lot" = 'queued' WHERE "lot" = 'immediate';

UPDATE
  "user"
SET
  preferences = JSONB_SET(
    preferences,
    '{notifications,to_send}',
    (preferences -> 'notifications' -> 'to_send') || '"OutdatedSeenEntries"'
  )
where
  NOT (
    preferences -> 'notifications' -> 'to_send' ? 'OutdatedSeenEntries'
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
