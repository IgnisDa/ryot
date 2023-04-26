use sea_orm_migration::prelude::*;

use super::Metadata;

static EPISODE_TMDB_ID_INDEX: &str = "episode__tmdbid__index";
static SEASON_TMDB_ID_INDEX: &str = "season__tmdbid__index";
static SHOW_TMDB_ID_INDEX: &str = "show__tmdbid__index";

pub struct Migration;

#[derive(Iden)]
pub enum Episode {
    Table,
    MetadataId,
    TmdbId,
    SeasonId,
}

#[derive(Iden)]
pub enum Season {
    Table,
    ShowId,
    MetadataId,
    TmdbId,
    EpisodeCount,
    Number,
}

#[derive(Iden)]
pub enum Show {
    Table,
    TmdbId,
    MetadataId,
}

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230425_000007_create_show"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Show::Table)
                    .col(ColumnDef::new(Show::TmdbId).string().not_null())
                    .col(
                        ColumnDef::new(Show::MetadataId)
                            .integer()
                            .primary_key()
                            .unique_key()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("season_to_metadata_foreign_key")
                            .from(Show::Table, Show::MetadataId)
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
                    .name(SHOW_TMDB_ID_INDEX)
                    .table(Show::Table)
                    .col(Show::TmdbId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_table(
                Table::create()
                    .table(Season::Table)
                    .col(ColumnDef::new(Season::EpisodeCount).integer().not_null())
                    .col(ColumnDef::new(Season::TmdbId).string().not_null())
                    .col(ColumnDef::new(Season::Number).integer().not_null())
                    .col(ColumnDef::new(Season::ShowId).integer().not_null())
                    .col(
                        ColumnDef::new(Season::MetadataId)
                            .integer()
                            .primary_key()
                            .unique_key()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("season_to_metadata_foreign_key")
                            .from(Season::Table, Season::MetadataId)
                            .to(Metadata::Table, Metadata::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("season_to_show_foreign_key")
                            .from(Season::Table, Season::ShowId)
                            .to(Show::Table, Show::MetadataId)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name(SEASON_TMDB_ID_INDEX)
                    .table(Season::Table)
                    .col(Season::TmdbId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_table(
                Table::create()
                    .table(Episode::Table)
                    .col(
                        ColumnDef::new(Episode::MetadataId)
                            .integer()
                            .primary_key()
                            .unique_key()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("movie_to_metadata_foreign_key")
                            .from(Episode::Table, Episode::MetadataId)
                            .to(Metadata::Table, Metadata::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .col(ColumnDef::new(Episode::TmdbId).string().not_null())
                    .col(ColumnDef::new(Episode::SeasonId).integer().not_null())
                    .foreign_key(
                        ForeignKey::create()
                            .name("episode_to_season_foreign_key")
                            .from(Episode::Table, Episode::SeasonId)
                            .to(Season::Table, Season::MetadataId)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name(EPISODE_TMDB_ID_INDEX)
                    .table(Episode::Table)
                    .col(Episode::TmdbId)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(Episode::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(Season::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(Show::Table).to_owned())
            .await?;
        Ok(())
    }
}
