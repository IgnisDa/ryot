use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager
            .has_column("calendar_event", "metadata_extra_information")
            .await?
        {
            let db = manager.get_connection();
            db.execute_unprepared(r#"
UPDATE "calendar_event" SET metadata_extra_information = NULL WHERE metadata_extra_information = '{"Other": null}'
        "#)
            .await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
