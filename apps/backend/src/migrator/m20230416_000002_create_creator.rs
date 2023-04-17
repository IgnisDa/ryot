use sea_orm_migration::prelude::*;

use super::MediaItemMetadata;

static PRIMARY_KEY_INDEX: &str = "pk-media-item_creator";

pub struct Migration;

#[derive(Iden)]
pub enum MediaItemCreator {
    Table,
    MediaItemId,
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
                    .table(MediaItemCreator::Table)
                    .col(
                        ColumnDef::new(MediaItemCreator::MediaItemId)
                            .integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(MediaItemCreator::CreatorId)
                            .integer()
                            .not_null(),
                    )
                    .primary_key(
                        Index::create()
                            .name(PRIMARY_KEY_INDEX)
                            .col(MediaItemCreator::MediaItemId)
                            .col(MediaItemCreator::CreatorId),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk-media-item_media-item-creator_id")
                            .from(MediaItemCreator::Table, MediaItemCreator::MediaItemId)
                            .to(MediaItemMetadata::Table, MediaItemMetadata::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk-creator-item_media-item-creator_id")
                            .from(MediaItemCreator::Table, MediaItemCreator::CreatorId)
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
                    .col(ColumnDef::new(Creator::Name).string().not_null())
                    .foreign_key(
                        ForeignKey::create()
                            .name("creator_to_book_foreign_key")
                            .from(Creator::Table, Creator::Id)
                            .to(MediaItemMetadata::Table, MediaItemMetadata::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(Creator::Table).to_owned())
            .await?;
        Ok(())
    }
}
