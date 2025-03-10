use sea_orm_migration::prelude::*;

use crate::m20241004_create_application_cache::APPLICATION_CACHE_SANITIZED_KEY_INDEX;

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
            db.execute_unprepared(&format!(
                r#"
ALTER TABLE "application_cache" ADD COLUMN "sanitized_key" TEXT;
UPDATE "application_cache" SET "sanitized_key" = 'dummy-key';
ALTER TABLE "application_cache" ALTER COLUMN "sanitized_key" SET NOT NULL;

CREATE INDEX "{}" ON "application_cache" ("sanitized_key");
                    "#,
                APPLICATION_CACHE_SANITIZED_KEY_INDEX
            ))
            .await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
