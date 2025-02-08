use sea_orm_migration::prelude::*;

use crate::m20230419_create_seen::{Seen, SEEN_UPDATED_AT_GIN_IDX};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name(SEEN_UPDATED_AT_GIN_IDX)
                    .table(Seen::Table)
                    .col(Seen::UpdatedAt)
                    .full_text()
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
