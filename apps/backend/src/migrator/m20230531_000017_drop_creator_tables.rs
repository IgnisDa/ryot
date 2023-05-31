use sea_orm_migration::prelude::*;

use super::{m20230416_000002_create_creator::MetadataToCreator, Creator};

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230531_000017_drop_creator_tables"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(MetadataToCreator::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(Creator::Table).to_owned())
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
