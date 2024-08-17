use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager.has_column("user", "yank_integrations").await? {
            let db = manager.get_connection();
            db.execute_unprepared(r#"ALTER TABLE "user" DROP COLUMN "yank_integrations""#)
                .await?;
        }
        if manager.has_column("user", "sink_integrations").await? {
            let db = manager.get_connection();
            db.execute_unprepared(r#"ALTER TABLE "user" DROP COLUMN "sink_integrations""#)
                .await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
