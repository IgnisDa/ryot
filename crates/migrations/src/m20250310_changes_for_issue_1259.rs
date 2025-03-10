use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        if !manager
            .has_column("application_cache", "sanitized_key")
            .await?
        {
            db.execute_unprepared(
                r#"
ALTER TABLE "application_cache" ADD COLUMN "sanitized_key" TEXT;

UPDATE "application_cache" SET "sanitized_key" = 'dummy-key';

ALTER TABLE "application_cache" ALTER COLUMN "sanitized_key" SET NOT NULL;
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
