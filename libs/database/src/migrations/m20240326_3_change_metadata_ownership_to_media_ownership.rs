use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager
            .has_column("user_to_entity", "media_ownership")
            .await?
        {
            let db = manager.get_connection();
            db.execute_unprepared(
                r#"ALTER TABLE "user_to_entity" RENAME COLUMN "metadata_ownership" TO "media_ownership";"#,
            )
            .await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
