use async_graphql::Enum;
use enum_meta::{Meta, meta};
use schematic::ConfigEnum;
use sea_orm::{DeriveActiveEnum, EnumIter};
use sea_orm_migration::prelude::*;
use serde::{Deserialize, Serialize};

/// The different types of media that can be stored.
#[derive(
    Eq,
    Enum,
    Copy,
    Hash,
    Debug,
    Clone,
    Default,
    EnumIter,
    PartialEq,
    Serialize,
    ConfigEnum,
    Deserialize,
    DeriveActiveEnum,
)]
#[sea_orm(
    rs_type = "String",
    rename_all = "snake_case",
    db_type = "String(StringLen::None)"
)]
#[serde(rename_all = "snake_case")]
pub enum MediaLot {
    #[default]
    Book,
    Show,
    Movie,
    Anime,
    Manga,
    Music,
    Podcast,
    AudioBook,
    VideoGame,
    VisualNovel,
}

meta! {
    MediaLot, Vec<MediaSource>;

    AudioBook, vec![MediaSource::Audible];
    Book, vec![
        MediaSource::Openlibrary,
        MediaSource::GoogleBooks,
        MediaSource::Hardcover,
    ];
    Podcast, vec![
        MediaSource::Itunes,
        MediaSource::Listennotes,
    ];
    VideoGame, vec![MediaSource::Igdb, MediaSource::GiantBomb];
    Anime, vec![
        MediaSource::Anilist,
        MediaSource::Myanimelist,
    ];
    Manga, vec![
        MediaSource::Anilist,
        MediaSource::MangaUpdates,
        MediaSource::Myanimelist,
    ];
    Movie, vec![MediaSource::Tmdb];
    Music, vec![MediaSource::YoutubeMusic, MediaSource::Spotify];
    Show, vec![MediaSource::Tmdb];
    VisualNovel, vec![MediaSource::Vndb];
}

/// The different sources (or providers) from which data can be obtained from.
#[derive(
    Eq,
    Copy,
    Enum,
    Hash,
    Clone,
    Debug,
    Default,
    EnumIter,
    PartialEq,
    Serialize,
    ConfigEnum,
    Deserialize,
    DeriveActiveEnum,
)]
#[sea_orm(
    rs_type = "String",
    rename_all = "snake_case",
    db_type = "String(StringLen::None)"
)]
#[serde(rename_all = "snake_case")]
pub enum MediaSource {
    Igdb,
    Tmdb,
    Vndb,
    #[default]
    Custom,
    Itunes,
    Anilist,
    Audible,
    Spotify,
    GiantBomb,
    Hardcover,
    Myanimelist,
    Listennotes,
    GoogleBooks,
    Openlibrary,
    MangaUpdates,
    YoutubeMusic,
}

meta! {
    MediaSource, Option<MediaLot>;

    Vndb, None;
    Custom, None;
    Itunes, None;
    Anilist, None;
    Audible, None;
    Myanimelist, None;
    Listennotes, None;
    GoogleBooks, None;
    Openlibrary, None;
    MangaUpdates, None;
    Tmdb, Some(MediaLot::Movie);
    Spotify, Some(MediaLot::Music);
    Igdb, Some(MediaLot::VideoGame);
    Hardcover, Some(MediaLot::Book);
    YoutubeMusic, Some(MediaLot::Music);
    GiantBomb, Some(MediaLot::VideoGame);
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, EnumIter, DeriveActiveEnum, Deserialize, Serialize)]
#[sea_orm(
    rs_type = "String",
    rename_all = "snake_case",
    db_type = "String(StringLen::None)"
)]
pub enum MetadataToMetadataRelation {
    Suggestion,
}
