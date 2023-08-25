use sea_orm_migration::prelude::*;

use super::Metadata;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Iden)]
pub enum MetadataSuggestion {
    Table,
    Id,
    Identifier,
    Title,
    Image,
    Lot,
    Source,
}

#[derive(Iden)]
pub enum MetadataToSuggestion {
    Table,
    MetadataId,
    SuggestionId,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(MetadataSuggestion::Table)
                    .col(
                        ColumnDef::new(MetadataSuggestion::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(MetadataSuggestion::Identifier)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(MetadataSuggestion::Title)
                            .string()
                            .not_null(),
                    )
                    .col(ColumnDef::new(MetadataSuggestion::Image).text().null())
                    .col(
                        ColumnDef::new(MetadataSuggestion::Lot)
                            .string_len(2)
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(MetadataSuggestion::Source)
                            .string_len(2)
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .unique()
                    .name("metadata_suggestion-identifier-source-lot__unique-index")
                    .table(MetadataSuggestion::Table)
                    .col(MetadataSuggestion::Identifier)
                    .col(MetadataSuggestion::Source)
                    .col(MetadataSuggestion::Lot)
                    .to_owned(),
            )
            .await?;
        manager
            .create_table(
                Table::create()
                    .table(MetadataToSuggestion::Table)
                    .col(
                        ColumnDef::new(MetadataToSuggestion::MetadataId)
                            .integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(MetadataToSuggestion::SuggestionId)
                            .integer()
                            .not_null(),
                    )
                    .primary_key(
                        Index::create()
                            .name("pk-metadata_to_suggestion")
                            .col(MetadataToSuggestion::MetadataId)
                            .col(MetadataToSuggestion::SuggestionId),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk-metadata_id-suggestion_id")
                            .from(
                                MetadataToSuggestion::Table,
                                MetadataToSuggestion::MetadataId,
                            )
                            .to(Metadata::Table, Metadata::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk-suggestion_id-metadata_id")
                            .from(
                                MetadataToSuggestion::Table,
                                MetadataToSuggestion::SuggestionId,
                            )
                            .to(MetadataSuggestion::Table, MetadataSuggestion::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
