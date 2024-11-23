use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        if !manager
            .has_column("daily_user_activity", "hour_records")
            .await?
        {
            db.execute_unprepared(
                r#"
DELETE FROM "daily_user_activity";
ALTER TABLE "daily_user_activity" ADD COLUMN "hour_records" JSONB NOT NULL DEFAULT '[]';
        "#,
            )
            .await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
