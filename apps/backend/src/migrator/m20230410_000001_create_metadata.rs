use async_graphql::Enum;
use sea_orm::{DeriveActiveEnum, EnumIter};
use sea_orm_migration::prelude::*;
use serde::{Deserialize, Serialize};

pub struct Migration;

#[derive(Debug, Clone, Copy, PartialEq, Eq, EnumIter, DeriveActiveEnum, Deserialize, Serialize)]
#[sea_orm(rs_type = "String", db_type = "String(None)")]
pub enum MetadataImageLot {
    #[sea_orm(string_value = "B")]
    Backdrop,
    #[sea_orm(string_value = "P")]
    Poster,
}

// This is responsible for storing common metadata about all media items
#[derive(Iden)]
pub enum MetadataImage {
    Table,
    Id,
    Lot,
    Url,
    MetadataId,
}

// The different types of media that can be stored
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, EnumIter, DeriveActiveEnum, Deserialize, Serialize, Enum,
)]
#[sea_orm(rs_type = "String", db_type = "String(None)")]
pub enum MetadataLot {
    #[sea_orm(string_value = "AB")]
    AudioBook,
    #[sea_orm(string_value = "BO")]
    Book,
    #[sea_orm(string_value = "PO")]
    Podcast,
    #[sea_orm(string_value = "MO")]
    Movie,
    #[sea_orm(string_value = "SH")]
    Show,
    #[sea_orm(string_value = "VG")]
    VideoGame,
}

// This is responsible for storing common metadata about all media items
#[derive(Iden)]
pub enum Metadata {
    Table,
    Id,
    CreatedOn,
    Lot,
    // the time when this entry was last updated internally, this can only be
    // updated using jobs
    LastUpdatedOn,
    Title,
    Description,
    // the year this media item was released
    PublishYear,
    // the date which this media was released. Should take precedence if present
    PublishDate,
    // all the images for this media item
    Images,
    // the unique identifier that is returned by the metadata provider
    Identifier,
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
                    .table(Metadata::Table)
                    .col(
                        ColumnDef::new(Metadata::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(Metadata::CreatedOn)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(ColumnDef::new(Metadata::Lot).string_len(2).not_null())
                    .col(
                        ColumnDef::new(Metadata::LastUpdatedOn)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(ColumnDef::new(Metadata::Title).string().not_null())
                    .col(ColumnDef::new(Metadata::Description).text())
                    .col(ColumnDef::new(Metadata::PublishYear).integer())
                    .col(ColumnDef::new(Metadata::PublishDate).date())
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("metadata__title__index")
                    .table(Metadata::Table)
                    .col(Metadata::Title)
                    .to_owned(),
            )
            .await?;
        manager
            .create_table(
                Table::create()
                    .table(MetadataImage::Table)
                    .col(
                        ColumnDef::new(MetadataImage::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(MetadataImage::Url)
                            .string()
                            .unique_key()
                            .not_null(),
                    )
                    .col(ColumnDef::new(MetadataImage::Lot).string_len(1).not_null())
                    .col(ColumnDef::new(MetadataImage::MetadataId).integer())
                    .foreign_key(
                        ForeignKey::create()
                            .name("metadata_to_image_foreign_key")
                            .from(MetadataImage::Table, MetadataImage::MetadataId)
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
                    .name("metadata-image__url__index")
                    .table(MetadataImage::Table)
                    .col(MetadataImage::Url)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(MetadataImage::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(Metadata::Table).to_owned())
            .await?;
        Ok(())
    }
}
