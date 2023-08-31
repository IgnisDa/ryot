use sea_orm_migration::prelude::*;

use super::Metadata;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Iden)]
pub enum MetadataGroup {
    Table,
    Id,
    Identifier,
    Title,
    Image,
    Lot,
    Source,
}

#[derive(Iden)]
pub enum MetadataToMetadataGroup {
    Table,
    MetadataId,
    MediaGroupId,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(MetadataGroup::Table)
                    .col(
                        ColumnDef::new(MetadataGroup::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(MetadataGroup::Identifier)
                            .string()
                            .not_null(),
                    )
                    .col(ColumnDef::new(MetadataGroup::Title).string().not_null())
                    .col(ColumnDef::new(MetadataGroup::Image).text().null())
                    .col(ColumnDef::new(MetadataGroup::Lot).string_len(2).not_null())
                    .col(
                        ColumnDef::new(MetadataGroup::Source)
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
                    .name("metadata_group-identifier-source-lot__unique-index")
                    .table(MetadataGroup::Table)
                    .col(MetadataGroup::Identifier)
                    .col(MetadataGroup::Source)
                    .col(MetadataGroup::Lot)
                    .to_owned(),
            )
            .await?;
        manager
            .create_table(
                Table::create()
                    .table(MetadataToMetadataGroup::Table)
                    .col(
                        ColumnDef::new(MetadataToMetadataGroup::MetadataId)
                            .integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(MetadataToMetadataGroup::MediaGroupId)
                            .integer()
                            .not_null(),
                    )
                    .primary_key(
                        Index::create()
                            .name("pk-metadata_to_metadata-group")
                            .col(MetadataToMetadataGroup::MetadataId)
                            .col(MetadataToMetadataGroup::MediaGroupId),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk-metadata_id-metadata-group_id")
                            .from(
                                MetadataToMetadataGroup::Table,
                                MetadataToMetadataGroup::MetadataId,
                            )
                            .to(Metadata::Table, Metadata::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk-metadata-group_id-metadata_id")
                            .from(
                                MetadataToMetadataGroup::Table,
                                MetadataToMetadataGroup::MediaGroupId,
                            )
                            .to(MetadataGroup::Table, MetadataGroup::Id)
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
