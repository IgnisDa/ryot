use crate::entities::{
    metadata,
    prelude::{AudioBook, Book, Metadata, Movie, Podcast, Show, VideoGame},
};
use async_graphql::Enum;
use sea_orm::{ActiveModelTrait, ActiveValue, DeriveActiveEnum, EntityTrait, EnumIter};
use sea_orm_migration::prelude::*;
use serde::{Deserialize, Serialize};

use super::{
    AudioBookSource, BookSource, Metadata as MetadataModel, MetadataLot, MovieSource,
    PodcastSource, ShowSource, VideoGameSource,
};

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230607_000021_hoist_source"
    }
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
)]
#[sea_orm(rs_type = "String", db_type = "String(None)")]
pub enum MetadataSource {
    #[default]
    #[sea_orm(string_value = "AU")]
    Audible,
    #[sea_orm(string_value = "CU")]
    Custom,
    #[sea_orm(string_value = "GO")]
    Goodreads,
    #[sea_orm(string_value = "IG")]
    Igdb,
    #[sea_orm(string_value = "LI")]
    Listennotes,
    #[sea_orm(string_value = "OL")]
    Openlibrary,
    #[sea_orm(string_value = "TM")]
    Tmdb,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(MetadataModel::Table)
                    .add_column_if_not_exists(
                        ColumnDef::new(MetadataModel::Source)
                            .string_len(2)
                            .default("CU"),
                    )
                    .to_owned(),
            )
            .await
            .ok();
        let db = manager.get_connection();
        let metadatas = Metadata::find().all(db).await.unwrap();
        for metadata in metadatas {
            let source = match metadata.lot {
                MetadataLot::AudioBook => {
                    match AudioBook::find_by_id(metadata.id)
                        .one(db)
                        .await?
                        .unwrap()
                        .source
                    {
                        AudioBookSource::Audible => MetadataSource::Audible,
                        AudioBookSource::Custom => MetadataSource::Custom,
                    }
                }
                MetadataLot::Book => {
                    match Book::find_by_id(metadata.id).one(db).await?.unwrap().source {
                        BookSource::Goodreads => MetadataSource::Goodreads,
                        BookSource::OpenLibrary => MetadataSource::Openlibrary,
                        BookSource::Custom => MetadataSource::Custom,
                    }
                }
                MetadataLot::Movie => {
                    match Movie::find_by_id(metadata.id)
                        .one(db)
                        .await?
                        .unwrap()
                        .source
                    {
                        MovieSource::Tmdb => MetadataSource::Tmdb,
                        MovieSource::Custom => MetadataSource::Custom,
                    }
                }
                MetadataLot::Podcast => {
                    match Podcast::find_by_id(metadata.id)
                        .one(db)
                        .await?
                        .unwrap()
                        .source
                    {
                        PodcastSource::Listennotes => MetadataSource::Listennotes,
                        PodcastSource::Custom => MetadataSource::Custom,
                    }
                }
                MetadataLot::Show => {
                    match Show::find_by_id(metadata.id).one(db).await?.unwrap().source {
                        ShowSource::Tmdb => MetadataSource::Tmdb,
                        ShowSource::Custom => MetadataSource::Custom,
                    }
                }
                MetadataLot::VideoGame => {
                    match VideoGame::find_by_id(metadata.id)
                        .one(db)
                        .await?
                        .unwrap()
                        .source
                    {
                        VideoGameSource::Igdb => MetadataSource::Igdb,
                        VideoGameSource::Custom => MetadataSource::Custom,
                    }
                }
            };
            let mut metadata: metadata::ActiveModel = metadata.into();
            metadata.source = ActiveValue::Set(source);
            metadata.save(db).await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
