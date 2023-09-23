use sea_orm_migration::prelude::*;

use super::Metadata;

#[derive(DeriveMigrationName)]
pub struct Migration;

pub static METADATA_IDENTIFIER_INDEX: &str = "metadata_identifier__index";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_column("metadata", "free_creators").await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(Metadata::Table)
                        .add_column(ColumnDef::new(Metadata::FreeCreators).json())
                        .to_owned(),
                )
                .await?;
        }
        if manager
            .has_index("metadata", METADATA_IDENTIFIER_INDEX)
            .await?
        {
            manager
                .drop_index(Index::drop().name(METADATA_IDENTIFIER_INDEX).to_owned())
                .await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
