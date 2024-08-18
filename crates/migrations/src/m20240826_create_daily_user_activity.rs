use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

pub const DAILY_USER_ACTIVITY_VIEW: &str = "daily_user_activity";
const DAILY_USER_ACTIVITY_VIEW_SQL: &str = include_str!("sql/create_daily_user_activity.sql");

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared(DAILY_USER_ACTIVITY_VIEW_SQL).await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
