use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager
            .has_column("metadata", "last_processed_on_for_calendar")
            .await?
        {
            let db = manager.get_connection();
            db.execute_unprepared(
                r#"ALTER TABLE metadata DROP COLUMN last_processed_on_for_calendar"#,
            )
            .await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
