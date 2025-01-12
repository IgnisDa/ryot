use sea_orm_migration::prelude::*;

use crate::m20240827_create_daily_user_activity::create_daily_user_activity_table;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        if !manager.has_column("workout", "calories_burnt").await? {
            db.execute_unprepared(r#"ALTER TABLE "workout" ADD COLUMN "calories_burnt" decimal"#)
                .await?;
        }
        if !manager.has_column("daily_user_activity", "id").await? {
            db.execute_unprepared("DROP TABLE daily_user_activity")
                .await?;
            create_daily_user_activity_table(manager).await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
