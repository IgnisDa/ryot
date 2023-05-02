use sea_orm_migration::prelude::*;

use super::Metadata;

static GENRE_NAME_INDEX: &str = "genre_name_index";

pub struct Migration;

#[derive(Iden)]
pub enum MetadataToGenre {
    Table,
    MetadataId,
    GenreId,
}

#[derive(Iden)]
pub enum Genre {
    Table,
    Id,
    MetadataId,
    Name,
}

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230502_000009_create_genre"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(MetadataToGenre::Table)
                    .col(
                        ColumnDef::new(MetadataToGenre::MetadataId)
                            .integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(MetadataToGenre::GenreId)
                            .integer()
                            .not_null(),
                    )
                    .primary_key(
                        Index::create()
                            .name("pk-metadata_genre")
                            .col(MetadataToGenre::MetadataId)
                            .col(MetadataToGenre::GenreId),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk-media-item_media-item-genre_id")
                            .from(MetadataToGenre::Table, MetadataToGenre::MetadataId)
                            .to(Metadata::Table, Metadata::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk-creator-item_media-item-genre_id")
                            .from(MetadataToGenre::Table, MetadataToGenre::GenreId)
                            .to(Genre::Table, Genre::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .create_table(
                Table::create()
                    .table(Genre::Table)
                    .col(
                        ColumnDef::new(Genre::MetadataId)
                            .integer()
                            .primary_key()
                            .unique_key()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("video_game_to_metadata_foreign_key")
                            .from(Genre::Table, Genre::MetadataId)
                            .to(Metadata::Table, Metadata::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .col(ColumnDef::new(Genre::Name).string().not_null())
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name(GENRE_NAME_INDEX)
                    .table(Genre::Table)
                    .col(Genre::Name)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(MetadataToGenre::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(Genre::Table).to_owned())
            .await?;
        Ok(())
    }
}
