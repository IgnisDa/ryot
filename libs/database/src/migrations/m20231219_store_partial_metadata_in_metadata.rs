use sea_orm_migration::prelude::*;

use super::m20230410_create_metadata::Metadata;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_column("metadata", "is_partial").await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(Metadata::Table)
                        .add_column(ColumnDef::new(Metadata::IsPartial).boolean())
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
