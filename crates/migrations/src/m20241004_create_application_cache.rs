use sea_orm_migration::prelude::*;

pub static APPLICATION_CACHE_SANITIZED_KEY_INDEX: &str = "application_cache_sanitized_key_index";
pub static APPLICATION_CACHE_SANITIZED_KEY_TRIGRAM_INDEX: &str =
    "application_cache_sanitized_key_trigram_idx";
pub static APPLICATION_CACHE_EXPIRES_AT_INDEX: &str = "application_cache_expires_at_index";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Iden)]
pub enum ApplicationCache {
    Table,
    Id,
    Key,
    Value,
    Version,
    ExpiresAt,
    CreatedAt,
    SanitizedKey,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(ApplicationCache::Table)
                    .col(
                        ColumnDef::new(ApplicationCache::Id)
                            .uuid()
                            .not_null()
                            .default(PgFunc::gen_random_uuid())
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(ApplicationCache::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(
                        ColumnDef::new(ApplicationCache::Key)
                            .json_binary()
                            .not_null()
                            .unique_key(),
                    )
                    .col(
                        ColumnDef::new(ApplicationCache::ExpiresAt)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(ApplicationCache::Value)
                            .json_binary()
                            .not_null(),
                    )
                    .col(ColumnDef::new(ApplicationCache::Version).text())
                    .col(
                        ColumnDef::new(ApplicationCache::SanitizedKey)
                            .text()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name(APPLICATION_CACHE_SANITIZED_KEY_INDEX)
                    .table(ApplicationCache::Table)
                    .col(ApplicationCache::SanitizedKey)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name(APPLICATION_CACHE_EXPIRES_AT_INDEX)
                    .table(ApplicationCache::Table)
                    .col(ApplicationCache::ExpiresAt)
                    .to_owned(),
            )
            .await?;

        let db = manager.get_connection();
        db.execute_unprepared(&format!(
            r#"CREATE INDEX "{}" ON application_cache USING gin (sanitized_key gin_trgm_ops);"#,
            APPLICATION_CACHE_SANITIZED_KEY_TRIGRAM_INDEX
        ))
        .await?;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
