use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        if manager.has_table("user_notification").await? {
            db.execute_unprepared(r#"DROP TABLE "user_notification";"#)
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
    (preferences -> 'notifications' -> 'to_send') || '"NotificationFromReminderCollection"'
  )
where
  NOT (
    preferences -> 'notifications' -> 'to_send' ? 'NotificationFromReminderCollection'
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
