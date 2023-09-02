use sea_orm_migration::prelude::*;

use super::{
    m20230825_create_suggestion::{MetadataToSuggestion, Suggestion},
    m20230901_create_metadata_group::MetadataToMetadataGroup,
};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager.has_table("metadata_to_suggestion").await? {
            manager
                .drop_table(Table::drop().table(MetadataToSuggestion::Table).to_owned())
                .await?;
        }
        if manager.has_table("suggestion").await? {
            manager
                .drop_table(Table::drop().table(Suggestion::Table).to_owned())
                .await?;
        }
        if manager.has_table("metadata_to_metadata_group").await? {
            manager
                .drop_table(
                    Table::drop()
                        .table(MetadataToMetadataGroup::Table)
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
