use sea_orm_migration::prelude::*;

use super::m20230501_create_metadata_group::MetadataGroup;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_column("metadata_group", "is_partial").await? {
            manager
                .alter_table(
                    TableAlterStatement::new()
                        .table(MetadataGroup::Table)
                        .add_column(ColumnDef::new(MetadataGroup::IsPartial).boolean())
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
