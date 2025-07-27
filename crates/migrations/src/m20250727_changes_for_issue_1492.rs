use sea_orm::Statement;
use sea_orm_migration::prelude::*;

use crate::m20241004_create_application_cache::{
    APPLICATION_CACHE_KEY_HASH_INDEX, ApplicationCache,
};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();

        let result = db.query_one(Statement::from_string(
            manager.get_database_backend(),
            "SELECT data_type FROM information_schema.columns WHERE table_name = 'application_cache' AND column_name = 'key'"
        )).await?;

        if let Some(row) = result {
            let data_type: String = row.try_get("", "data_type")?;

            if data_type != "text" {
                db.execute_unprepared(
                    "ALTER TABLE application_cache ALTER COLUMN key TYPE text USING key::text",
                )
                .await?;
            }
        }

        manager
            .create_index(
                Index::create()
                    .name(APPLICATION_CACHE_KEY_HASH_INDEX)
                    .table(ApplicationCache::Table)
                    .col(ApplicationCache::Key)
                    .index_type(IndexType::Hash)
                    .if_not_exists()
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
