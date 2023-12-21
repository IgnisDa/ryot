use sea_orm::{DeriveActiveEnum, EnumIter};
use sea_orm_migration::prelude::*;
use serde::{Deserialize, Serialize};

use super::{m20230410_create_metadata::Metadata, m20230501_create_metadata_group::MetadataGroup};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Debug, Clone, Copy, PartialEq, Eq, EnumIter, DeriveActiveEnum, Deserialize, Serialize)]
#[sea_orm(rs_type = "String", db_type = "String(None)")]
pub enum MetadataToMetadataRelation {
    #[sea_orm(string_value = "SU")]
    Suggestion,
}

#[derive(Iden)]
pub enum MetadataToMetadata {
    Table,
    Id,
    FromMetadataId,
    ToMetadataId,
    Relation,
}

#[derive(Iden)]
pub enum MetadataToMetadataGroup {
    Table,
    MetadataId,
    MetadataGroupId,
    Part,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(MetadataToMetadata::Table)
                    .col(
                        ColumnDef::new(MetadataToMetadata::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(MetadataToMetadata::FromMetadataId)
                            .integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(MetadataToMetadata::Relation)
                            .string_len(2)
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(MetadataToMetadata::ToMetadataId)
                            .integer()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .from(
                                MetadataToMetadata::Table,
                                MetadataToMetadata::FromMetadataId,
                            )
                            .to(Metadata::Table, Metadata::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .from(MetadataToMetadata::Table, MetadataToMetadata::ToMetadataId)
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
                    .table(MetadataToMetadata::Table)
                    .col(MetadataToMetadata::FromMetadataId)
                    .col(MetadataToMetadata::Relation)
                    .col(MetadataToMetadata::ToMetadataId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_table(
                Table::create()
                    .table(MetadataToMetadataGroup::Table)
                    .col(
                        ColumnDef::new(MetadataToMetadataGroup::Part)
                            .integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(MetadataToMetadataGroup::MetadataGroupId)
                            .integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(MetadataToMetadataGroup::MetadataId)
                            .integer()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .from(
                                MetadataToMetadataGroup::Table,
                                MetadataToMetadataGroup::MetadataGroupId,
                            )
                            .to(MetadataGroup::Table, MetadataGroup::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .from(
                                MetadataToMetadataGroup::Table,
                                MetadataToMetadataGroup::MetadataId,
                            )
                            .to(Metadata::Table, Metadata::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .primary_key(
                        Index::create()
                            .col(MetadataToMetadataGroup::MetadataId)
                            .col(MetadataToMetadataGroup::MetadataGroupId),
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
