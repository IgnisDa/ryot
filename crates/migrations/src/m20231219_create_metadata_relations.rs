use sea_orm_migration::prelude::*;

use super::{m20230410_create_metadata::Metadata, m20230411_create_metadata_group::MetadataGroup};

#[derive(DeriveMigrationName)]
pub struct Migration;

// FIXME: Remove in the next major release
#[derive(Iden)]
pub enum MetadataToMetadata {
    Table,
    Id,
    FromMetadataId,
    ToMetadataId,
    Relation,
}

// FIXME: Remove in the next major release
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
                        ColumnDef::new(MetadataToMetadata::Relation)
                            .text()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(MetadataToMetadata::FromMetadataId)
                            .text()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(MetadataToMetadata::ToMetadataId)
                            .text()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(MetadataToMetadata::Id)
                            .uuid()
                            .not_null()
                            .default(PgFunc::gen_random_uuid())
                            .primary_key(),
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
                            .text()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(MetadataToMetadataGroup::MetadataId)
                            .text()
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
