use async_graphql::Enum;
use sea_orm::{DeriveActiveEnum, EnumIter};
use sea_orm_migration::prelude::*;
use serde::{Deserialize, Serialize};
use specta::Type;
use strum::Display;

#[derive(DeriveMigrationName)]
pub struct Migration;

// TODO: Drop this index
pub static METADATA_IDENTIFIER_INDEX: &str = "metadata_identifier__index";
pub static METADATA_UNIQUE_INDEX: &str = "metadata-identifier-source-lot__unique-index";

#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    EnumIter,
    DeriveActiveEnum,
    Deserialize,
    Serialize,
    Default,
    Hash,
)]
#[sea_orm(rs_type = "String", db_type = "String(None)")]
pub enum MetadataImageLot {
    #[sea_orm(string_value = "B")]
    Backdrop,
    #[default]
    #[sea_orm(string_value = "P")]
    Poster,
}

// The different types of media that can be stored
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    EnumIter,
    DeriveActiveEnum,
    Deserialize,
    Serialize,
    Enum,
    Default,
    Type,
    Hash,
)]
#[sea_orm(rs_type = "String", db_type = "String(None)")]
pub enum MetadataSource {
    #[sea_orm(string_value = "AN")]
    Anilist,
    #[default]
    #[sea_orm(string_value = "AU")]
    Audible,
    #[sea_orm(string_value = "CU")]
    Custom,
    #[sea_orm(string_value = "GO")]
    GoogleBooks,
    #[sea_orm(string_value = "IG")]
    Igdb,
    #[sea_orm(string_value = "IT")]
    Itunes,
    #[sea_orm(string_value = "LI")]
    Listennotes,
    #[sea_orm(string_value = "OL")]
    Openlibrary,
    #[sea_orm(string_value = "TM")]
    Tmdb,
}

// The different types of media that can be stored
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    EnumIter,
    DeriveActiveEnum,
    Deserialize,
    Serialize,
    Enum,
    Default,
    Type,
    Display,
    Hash,
)]
#[sea_orm(rs_type = "String", db_type = "String(None)")]
pub enum MetadataLot {
    #[sea_orm(string_value = "AB")]
    AudioBook,
    #[sea_orm(string_value = "AN")]
    Anime,
    #[default]
    #[sea_orm(string_value = "BO")]
    Book,
    #[sea_orm(string_value = "PO")]
    Podcast,
    #[sea_orm(string_value = "MA")]
    Manga,
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
    // production status
    ProductionStatus,
    // all the images for this media item
    Images,
    // the unique identifier that is returned by the metadata provider
    Identifier,
    // the provider source
    Source,
    // details about the media
    Specifics,
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
                    .col(
                        ColumnDef::new(Metadata::ProductionStatus)
                            .string()
                            .not_null(),
                    )
                    .col(ColumnDef::new(Metadata::PublishYear).integer())
                    .col(ColumnDef::new(Metadata::PublishDate).date())
                    .col(ColumnDef::new(Metadata::Images).json())
                    .col(ColumnDef::new(Metadata::Identifier).string().not_null())
                    .col(ColumnDef::new(Metadata::Source).string_len(2).not_null())
                    .col(ColumnDef::new(Metadata::Specifics).json().not_null())
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name(METADATA_IDENTIFIER_INDEX)
                    .table(Metadata::Table)
                    .col(Metadata::Identifier)
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
            .create_index(
                Index::create()
                    .unique()
                    .name(METADATA_UNIQUE_INDEX)
                    .table(Metadata::Table)
                    .col(Metadata::Identifier)
                    .col(Metadata::Source)
                    .col(Metadata::Lot)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
