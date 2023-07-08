use async_graphql::SimpleObject;
use enum_meta::{meta, Meta};
use sea_orm::FromJsonQueryResult;
use serde::{Deserialize, Serialize};
use strum::{Display, EnumIter};

use crate::{
    migrator::MetadataImageLot,
    models::media::{
        AnimeSpecifics, AudioBookSpecifics, BookSpecifics, MangaSpecifics, MovieSpecifics,
        PodcastSpecifics, ShowSpecifics, VideoGameSpecifics,
    },
    traits::MediaProviderLanguages,
};

pub mod resolver;

#[derive(Debug, Serialize, Deserialize, Clone, FromJsonQueryResult, Eq, PartialEq, Default)]
#[serde(tag = "t", content = "d")]
pub enum MediaSpecifics {
    AudioBook(AudioBookSpecifics),
    Book(BookSpecifics),
    Movie(MovieSpecifics),
    Podcast(PodcastSpecifics),
    Show(ShowSpecifics),
    VideoGame(VideoGameSpecifics),
    Anime(AnimeSpecifics),
    Manga(MangaSpecifics),
    #[default]
    Unknown,
}

#[derive(Debug, Serialize, Deserialize, Clone, Eq, PartialEq, Hash)]
pub enum MetadataImageUrl {
    S3(String),
    Url(String),
}

impl Default for MetadataImageUrl {
    fn default() -> Self {
        Self::Url("".to_owned())
    }
}

#[derive(
    Clone, Debug, PartialEq, FromJsonQueryResult, Eq, Serialize, Deserialize, Default, Hash,
)]
pub struct MetadataImage {
    pub url: MetadataImageUrl,
    pub lot: MetadataImageLot,
}

#[derive(Clone, Debug, PartialEq, FromJsonQueryResult, Eq, Serialize, Deserialize, Default)]
pub struct MetadataImages(pub Vec<MetadataImage>);

#[derive(
    Clone,
    Debug,
    PartialEq,
    FromJsonQueryResult,
    Eq,
    Serialize,
    Deserialize,
    SimpleObject,
    Default,
    Hash,
)]
pub struct MetadataCreator {
    pub name: String,
    pub role: String,
    pub image_urls: Vec<String>,
}

#[derive(
    Clone, Debug, PartialEq, FromJsonQueryResult, Eq, Serialize, Deserialize, Default, Hash,
)]
pub struct MetadataCreators(pub Vec<MetadataCreator>);

#[derive(Display, EnumIter)]
pub enum DefaultCollection {
    Custom,
    #[strum(serialize = "In Progress")]
    InProgress,
    Watchlist,
}

meta! {
    DefaultCollection, &'static str;
    Custom, "Items that I have created manually";
    InProgress, "Media items that I am currently watching";
    Watchlist, "Things I want to watch in the future";
}

#[derive(Debug, Clone)]
pub struct CustomService {}

impl MediaProviderLanguages for CustomService {
    fn supported_languages() -> Vec<String> {
        ["us"].into_iter().map(String::from).collect()
    }

    fn default_language() -> String {
        "us".to_owned()
    }
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize, Clone, SimpleObject)]
pub struct SeenShowExtraInformation {
    pub season: i32,
    pub episode: i32,
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize, Clone, SimpleObject)]
pub struct SeenPodcastExtraInformation {
    pub episode: i32,
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize, Clone, FromJsonQueryResult)]
pub enum SeenExtraInformation {
    Show(SeenShowExtraInformation),
    Podcast(SeenPodcastExtraInformation),
}
