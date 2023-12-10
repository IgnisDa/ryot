use sea_orm_migration::prelude::*;

use crate::migrations::m20230410_create_metadata::Metadata;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Metadata::Table)
                    .add_column_if_not_exists(ColumnDef::new(Metadata::OriginalLanguage).string())
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
