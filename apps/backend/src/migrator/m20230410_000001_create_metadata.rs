use sea_orm::{DeriveActiveEnum, EnumIter};
use sea_orm_migration::prelude::*;
use serde::{Deserialize, Serialize};

use super::Creator;

static METADATA_TITLE_INDEX: &str = "media_item_metadata__title__index";

pub struct Migration;

#[derive(Debug, Clone, Copy, PartialEq, Eq, EnumIter, DeriveActiveEnum, Deserialize, Serialize)]
#[sea_orm(rs_type = "String", db_type = "String(Some(1))")]
pub enum MediaItemMetadataImageLot {
    #[sea_orm(string_value = "B")]
    Backdrop,
    #[sea_orm(string_value = "P")]
    Poster,
}

// This is responsible for storing common metadata about all media items
#[derive(Iden)]
enum MediaItemMetadataImage {
    Table,
    Id,
    Lot,
    Url,
    MetadataId,
}

// The different types of media that can be stored
#[derive(Debug, Clone, Copy, PartialEq, Eq, EnumIter, DeriveActiveEnum, Deserialize, Serialize)]
#[sea_orm(rs_type = "String", db_type = "String(Some(1))")]
pub enum MediaItemLot {
    #[sea_orm(string_value = "AB")]
    AudioBook,
    #[sea_orm(string_value = "BO")]
    Book,
    #[sea_orm(string_value = "MO")]
    Movie,
    #[sea_orm(string_value = "SH")]
    Show,
    #[sea_orm(string_value = "VG")]
    VideoGame,
}

// This is responsible for storing common metadata about all media items
#[derive(Iden)]
pub enum MediaItemMetadata {
    Table,
    Id,
    CreatedOn,
    Lot,
    // the time when this entry was last updated internally, this can only be
    // updated using jobs
    LastUpdatedOn,
    Title,
    Description,
    // // URLs to the poster images for this media item
    // ImageUrls,
}

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230410_000001_create_metadata"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(MediaItemMetadataImage::Table)
                    .col(
                        ColumnDef::new(MediaItemMetadataImage::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(MediaItemMetadataImage::Url)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(MediaItemMetadataImage::Lot)
                            .enumeration(
                                MediaItemMetadataImageLotEnum.into_iden(),
                                MediaItemMetadataImageLotEnum.into_iter(),
                            )
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(MediaItemMetadataImage::MetadataId)
                            .integer()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("metadata_to_image_foreign_key")
                            .from(
                                MediaItemMetadataImage::Table,
                                MediaItemMetadataImage::MetadataId,
                            )
                            .to(MediaItemMetadata::Table, MediaItemMetadata::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("book_to_creator_foreign_key")
                            .from(MediaItemMetadata::Table, MediaItemMetadata::Id)
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
                    .table(MediaItemMetadata::Table)
                    .col(
                        ColumnDef::new(MediaItemMetadata::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(MediaItemMetadata::CreatedOn)
                            .date_time()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(
                        ColumnDef::new(MediaItemMetadata::Lot)
                            .enumeration(MediaItemLotEnum.into_iden(), MediaItemLotEnum.into_iter())
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(MediaItemMetadata::LastUpdatedOn)
                            .date_time()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(ColumnDef::new(MediaItemMetadata::Title).string().not_null())
                    .col(ColumnDef::new(MediaItemMetadata::Description).text())
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name(METADATA_TITLE_INDEX)
                    .table(MediaItemMetadata::Table)
                    .col(MediaItemMetadata::Title)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(Index::drop().name(METADATA_TITLE_INDEX).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(MediaItemMetadata::Table).to_owned())
            .await?;
        manager
            .drop_table(
                Table::drop()
                    .table(MediaItemMetadataImage::Table)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}
