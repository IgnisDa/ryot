use sea_orm_migration::prelude::*;

use super::Metadata;

pub struct Migration;

pub static METADATA_TO_CREATOR_PRIMARY_KEY: &str = "pk-media-item_creator";

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230730_create_creator"
    }
}

#[derive(Iden)]
pub enum Creator {
    Table,
    Id,
    Name,
    Image,
    ExtraInformation,
}

#[derive(Iden)]
pub enum MetadataToCreator {
    Table,
    MetadataId,
    CreatorId,
    Role,
    // The order in which the creator will be displayed
    Index,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Creator::Table)
                    .col(
                        ColumnDef::new(Creator::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(Creator::Name)
                            .string()
                            .unique_key()
                            .not_null(),
                    )
                    .col(ColumnDef::new(Creator::Image).string())
                    .col(ColumnDef::new(Creator::ExtraInformation).json().not_null())
                    .to_owned(),
            )
            .await?;
        manager
            .create_table(
                Table::create()
                    .table(MetadataToCreator::Table)
                    .col(
                        ColumnDef::new(MetadataToCreator::MetadataId)
                            .integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(MetadataToCreator::CreatorId)
                            .integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(MetadataToCreator::Index)
                            .integer()
                            .not_null(),
                    )
                    .primary_key(
                        Index::create()
                            .name(METADATA_TO_CREATOR_PRIMARY_KEY)
                            .col(MetadataToCreator::MetadataId)
                            .col(MetadataToCreator::CreatorId)
                            .col(MetadataToCreator::Role),
                    )
                    .col(ColumnDef::new(MetadataToCreator::Role).string().not_null())
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk-media-item_media-item-creator_id")
                            .from(MetadataToCreator::Table, MetadataToCreator::MetadataId)
                            .to(Metadata::Table, Metadata::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk-creator-item_media-item-creator_id")
                            .from(MetadataToCreator::Table, MetadataToCreator::CreatorId)
                            .to(Creator::Table, Creator::Id)
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
