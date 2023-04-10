use chrono::Utc;
use sea_orm::{EnumIter, Iterable};
use sea_orm_migration::prelude::*;

static METADATA_TITLE_INDEX: &str = "media_item_metadata__title__index";
static METADATA_TO_IMAGE_FOREIGN_KEY: &str = "metadata_to_image_foreign_key";

pub struct Migration;

#[derive(Iden, EnumIter)]
pub enum MediaItemMetadataImageType {
    Table,
    #[iden = "poster"]
    Poster,
    #[iden = "backdrop"]
    Backdrop,
}

// This is responsible for storing common metadata about all media items
#[derive(Iden)]
enum MediaItemMetadataImage {
    Table,
    Id,
    Type,
    Url,
    MetadataId,
}
// The different types of media that can be stored
#[derive(Iden, EnumIter)]
pub enum MediaItemType {
    Table,
    #[iden = "audio_book"]
    AudioBook,
    #[iden = "book"]
    Book,
    #[iden = "movie"]
    Movie,
    #[iden = "show"]
    Show,
    #[iden = "video_game"]
    VideoGame,
}

// This is responsible for storing common metadata about all media items
#[derive(Iden)]
enum MediaItemMetadata {
    Table,
    Id,
    CreatedOn,
    Type,
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
        "m20230410_000001_create_initial_tables"
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
                        ColumnDef::new(MediaItemMetadataImage::Type)
                            .enumeration(
                                MediaItemMetadataImageType::Table,
                                MediaItemMetadataImageType::iter().skip(1),
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
                            .name(METADATA_TO_IMAGE_FOREIGN_KEY)
                            .from(
                                MediaItemMetadataImage::Table,
                                MediaItemMetadataImage::MetadataId,
                            )
                            .to(MediaItemMetadata::Table, MediaItemMetadata::Id)
                            .on_delete(ForeignKeyAction::Cascade),
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
                            .default(Utc::now()),
                    )
                    .col(
                        ColumnDef::new(MediaItemMetadata::Type)
                            .enumeration(MediaItemType::Table, MediaItemType::iter().skip(1))
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(MediaItemMetadata::LastUpdatedOn)
                            .date_time()
                            .not_null()
                            .default(Utc::now()),
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
            .drop_table(
                Table::drop()
                    .table(MediaItemMetadataImage::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_index(Index::drop().name(METADATA_TITLE_INDEX).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(MediaItemMetadata::Table).to_owned())
            .await?;
        Ok(())
    }
}
