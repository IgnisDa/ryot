use sea_orm_migration::prelude::*;

use crate::m20241004_create_application_cache::{
    APPLICATION_CACHE_EXPIRES_AT_INDEX, APPLICATION_CACHE_SANITIZED_KEY_TRIGRAM_INDEX,
};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();

        db.execute_unprepared(r#"CREATE EXTENSION IF NOT EXISTS "pg_trgm";"#)
            .await?;
        db.execute_unprepared(&format!(
            r#"CREATE INDEX IF NOT EXISTS "{}" ON application_cache USING gin (sanitized_key gin_trgm_ops);"#,
            APPLICATION_CACHE_SANITIZED_KEY_TRIGRAM_INDEX
        ))
        .await?;
        db.execute_unprepared(&format!(
            r#"CREATE INDEX IF NOT EXISTS "{}" ON application_cache (expires_at);"#,
            APPLICATION_CACHE_EXPIRES_AT_INDEX
        ))
        .await?;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
