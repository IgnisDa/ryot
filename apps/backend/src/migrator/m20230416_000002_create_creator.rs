use sea_orm_migration::prelude::*;

use super::Metadata;

static PRIMARY_KEY_INDEX: &str = "pk-media-item_creator";
static CREATOR_NAME_INDEX: &str = "creator__name__index";

pub struct Migration;

#[derive(Iden)]
pub enum MetadataToCreator {
    Table,
    MetadataId,
    CreatorId,
}

#[derive(Iden)]
pub enum Creator {
    Table,
    Id,
    Name,
}

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230416_000002_create_creator"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
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
                    .primary_key(
                        Index::create()
                            .name(PRIMARY_KEY_INDEX)
                            .col(MetadataToCreator::MetadataId)
                            .col(MetadataToCreator::CreatorId),
                    )
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
                            .unique_key()
                            .string()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name(CREATOR_NAME_INDEX)
                    .table(Creator::Table)
                    .col(Creator::Name)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(Creator::Table).to_owned())
            .await?;
        manager
            .drop_index(Index::drop().name(CREATOR_NAME_INDEX).to_owned())
            .await?;
        Ok(())
    }
}
