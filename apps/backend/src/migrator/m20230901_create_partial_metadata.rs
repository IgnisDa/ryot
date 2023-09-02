use sea_orm::{DeriveActiveEnum, EnumIter};
use sea_orm_migration::prelude::*;
use serde::{Deserialize, Serialize};

use super::{m20230901_create_metadata_group::MetadataGroup, Metadata};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Iden)]
pub enum PartialMetadata {
    Table,
    Id,
    Identifier,
    Title,
    Image,
    Lot,
    Source,
    MetadataId,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, EnumIter, DeriveActiveEnum, Deserialize, Serialize)]
#[sea_orm(rs_type = "String", db_type = "String(None)")]
pub enum MetadataToPartialMetadataRelation {
    #[sea_orm(string_value = "SU")]
    Suggestion,
}

#[derive(Iden)]
pub enum MetadataToPartialMetadata {
    Table,
    MetadataId,
    PartialMetadataId,
    Relation,
}

#[derive(Iden)]
pub enum PartialMetadataToMetadataGroup {
    Table,
    PartialMetadataId,
    MetadataGroupId,
    Part,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(PartialMetadata::Table)
                    .col(
                        ColumnDef::new(PartialMetadata::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(PartialMetadata::Identifier)
                            .string()
                            .not_null(),
                    )
                    .col(ColumnDef::new(PartialMetadata::Title).string().not_null())
                    .col(ColumnDef::new(PartialMetadata::Image).text().null())
                    .col(
                        ColumnDef::new(PartialMetadata::Lot)
                            .string_len(2)
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(PartialMetadata::Source)
                            .string_len(2)
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(MetadataToPartialMetadata::MetadataId)
                            .integer()
                            .null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk-metadata_id-partial-metadata_id")
                            .from(PartialMetadata::Table, PartialMetadata::MetadataId)
                            .to(Metadata::Table, Metadata::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .unique()
                    .name("partial_metadata-identifier-source-lot__unique-index")
                    .table(PartialMetadata::Table)
                    .col(PartialMetadata::Identifier)
                    .col(PartialMetadata::Source)
                    .col(PartialMetadata::Lot)
                    .to_owned(),
            )
            .await?;
        manager
            .create_table(
                Table::create()
                    .table(MetadataToPartialMetadata::Table)
                    .col(
                        ColumnDef::new(MetadataToPartialMetadata::MetadataId)
                            .integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(MetadataToPartialMetadata::Relation)
                            .string_len(2)
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(MetadataToPartialMetadata::PartialMetadataId)
                            .integer()
                            .not_null(),
                    )
                    .primary_key(
                        Index::create()
                            .name("pk-metadata_to_partial-metadata")
                            .col(MetadataToPartialMetadata::MetadataId)
                            .col(MetadataToPartialMetadata::PartialMetadataId),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk-metadata_id-metadata-to-partial-metadata_id")
                            .from(
                                MetadataToPartialMetadata::Table,
                                MetadataToPartialMetadata::MetadataId,
                            )
                            .to(Metadata::Table, Metadata::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk-metadata-to-partial-metadata_id-partial-metadata_id")
                            .from(
                                MetadataToPartialMetadata::Table,
                                MetadataToPartialMetadata::PartialMetadataId,
                            )
                            .to(PartialMetadata::Table, PartialMetadata::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .create_table(
                Table::create()
                    .table(PartialMetadataToMetadataGroup::Table)
                    .col(
                        ColumnDef::new(PartialMetadataToMetadataGroup::PartialMetadataId)
                            .integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(PartialMetadataToMetadataGroup::MetadataGroupId)
                            .integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(PartialMetadataToMetadataGroup::Part)
                            .integer()
                            .not_null(),
                    )
                    .primary_key(
                        Index::create()
                            .name("pk_partial-metadata_to_metadata-group")
                            .col(PartialMetadataToMetadataGroup::PartialMetadataId)
                            .col(PartialMetadataToMetadataGroup::MetadataGroupId),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_partial-metadata-to-metadata-group_id-metadata-partial-metadata_id")
                            .from(
                                PartialMetadataToMetadataGroup::Table,
                                PartialMetadataToMetadataGroup::PartialMetadataId,
                            )
                            .to(PartialMetadata::Table, PartialMetadata::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name(
                                "fk_partial-metadata-to-metadata-group-group_id-metadata-group_id",
                            )
                            .from(
                                PartialMetadataToMetadataGroup::Table,
                                PartialMetadataToMetadataGroup::MetadataGroupId,
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
