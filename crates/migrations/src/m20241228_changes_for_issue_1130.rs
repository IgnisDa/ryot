use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        if !manager
            .has_column("user_notification", "is_addressed")
            .await?
        {
            db.execute_unprepared(
                r#"ALTER TABLE "user_notification" ADD COLUMN "is_addressed" boolean"#,
            )
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
    (preferences -> 'notifications' -> 'to_send') || '"NewWorkoutCreated"'
  )
where
  NOT (
    preferences -> 'notifications' -> 'to_send' ? 'NewWorkoutCreated'
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
