use migrations_utils::create_trigram_index_if_required;
use sea_orm_migration::prelude::*;

use super::m20230404_create_user::User;

#[derive(DeriveMigrationName)]
pub struct Migration;

pub static METADATA_TO_USER_FOREIGN_KEY: &str = "metadata_to_user_foreign_key";
pub static METADATA_UNIQUE_INDEX: &str = "metadata-identifier-source-lot__unique-index";
pub static METADATA_TITLE_TRIGRAM_INDEX: &str = "metadata_title_trigram_idx";
pub static METADATA_DESCRIPTION_TRIGRAM_INDEX: &str = "metadata_description_trigram_idx";

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
    SourceUrl,
    Description,
    // the year this media item was released
    PublishYear,
    // the date which this media was released. Should take precedence if present
    PublishDate,
    // production status
    ProductionStatus,
    // the original language
    OriginalLanguage,
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
    CreatedByUserId,
    VideoGameSpecifics,
    VisualNovelSpecifics,
    MusicSpecifics,
    WatchProviders,
    ExternalIdentifiers,
    Assets,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Metadata::Table)
                    .col(ColumnDef::new(Metadata::Id).text().not_null().primary_key())
                    .col(ColumnDef::new(Metadata::Lot).text().not_null())
                    .col(ColumnDef::new(Metadata::ProductionStatus).text())
                    .col(ColumnDef::new(Metadata::Identifier).text().not_null())
                    .col(ColumnDef::new(Metadata::Source).text().not_null())
                    .col(
                        ColumnDef::new(Metadata::CreatedOn)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
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
                    .col(ColumnDef::new(Metadata::ProviderRating).decimal())
                    .col(ColumnDef::new(Metadata::IsNsfw).boolean())
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
                    .col(ColumnDef::new(Metadata::WatchProviders).json_binary())
                    .col(ColumnDef::new(Metadata::ExternalIdentifiers).json_binary())
                    .col(ColumnDef::new(Metadata::MusicSpecifics).json_binary())
                    .col(ColumnDef::new(Metadata::SourceUrl).text())
                    .col(ColumnDef::new(Metadata::CreatedByUserId).text())
                    .col(ColumnDef::new(Metadata::Assets).json_binary().not_null())
                    .foreign_key(
                        ForeignKey::create()
                            .name(METADATA_TO_USER_FOREIGN_KEY)
                            .from(Metadata::Table, Metadata::CreatedByUserId)
                            .to(User::Table, User::Id)
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::Cascade),
                    )
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

        create_trigram_index_if_required(
            manager,
            "metadata",
            "title",
            METADATA_TITLE_TRIGRAM_INDEX,
        )
        .await?;
        create_trigram_index_if_required(
            manager,
            "metadata",
            "description",
            METADATA_DESCRIPTION_TRIGRAM_INDEX,
        )
        .await?;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
