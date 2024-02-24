use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

pub static METADATA_UNIQUE_INDEX: &str = "metadata-identifier-source-lot__unique-index";

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
    // the original language
    OriginalLanguage,
    // all the images for this media item
    Images,
    // all the videos for this media item
    Videos,
    // the unique identifier that is returned by the metadata provider
    Identifier,
    // the provider source
    Source,
    // the rating from the provider
    ProviderRating,
    // whether the entire data for this has been downloaded
    IsPartial,
    // whether it is not safe for work
    IsNsfw,
    // those creators who can not be created as a `person` due to incomplete info
    FreeCreators,
    // specifics for each type of media
    AudioBookSpecifics,
    AnimeSpecifics,
    BookSpecifics,
    PodcastSpecifics,
    MangaSpecifics,
    MovieSpecifics,
    ShowSpecifics,
    VideoGameSpecifics,
    VisualNovelSpecifics,
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
                    .col(ColumnDef::new(Metadata::Lot).text().not_null())
                    .col(
                        ColumnDef::new(Metadata::LastUpdatedOn)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(ColumnDef::new(Metadata::Title).text().not_null())
                    .col(ColumnDef::new(Metadata::Description).text())
                    .col(ColumnDef::new(Metadata::PublishYear).integer())
                    .col(ColumnDef::new(Metadata::PublishDate).date())
                    .col(ColumnDef::new(Metadata::Identifier).text().not_null())
                    .col(ColumnDef::new(Metadata::Source).text().not_null())
                    .col(ColumnDef::new(Metadata::ProductionStatus).text())
                    .col(ColumnDef::new(Metadata::ProviderRating).decimal())
                    .col(ColumnDef::new(Metadata::IsNsfw).boolean())
                    .col(ColumnDef::new(Metadata::Images).json_binary())
                    .col(ColumnDef::new(Metadata::Videos).json_binary())
                    .col(ColumnDef::new(Metadata::FreeCreators).json_binary())
                    .col(ColumnDef::new(Metadata::OriginalLanguage).text())
                    .col(ColumnDef::new(Metadata::IsPartial).boolean())
                    .col(ColumnDef::new(Metadata::AudioBookSpecifics).json_binary())
                    .col(ColumnDef::new(Metadata::AnimeSpecifics).json_binary())
                    .col(ColumnDef::new(Metadata::BookSpecifics).json_binary())
                    .col(ColumnDef::new(Metadata::PodcastSpecifics).json_binary())
                    .col(ColumnDef::new(Metadata::MangaSpecifics).json_binary())
                    .col(ColumnDef::new(Metadata::MovieSpecifics).json_binary())
                    .col(ColumnDef::new(Metadata::ShowSpecifics).json_binary())
                    .col(ColumnDef::new(Metadata::VideoGameSpecifics).json_binary())
                    .col(ColumnDef::new(Metadata::VisualNovelSpecifics).json_binary())
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
