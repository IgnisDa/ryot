use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

pub const WEEKLY_USER_ACTIVITY_VIEW: &str = "weekly_user_activity";
const WEEKLY_USER_ACTIVITY_SQL: &str =
    include_str!("sql/m20240826_create_weekly_user_activity.sql");

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared(WEEKLY_USER_ACTIVITY_SQL).await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
