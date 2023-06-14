use async_graphql::SimpleObject;
use sea_orm::FromJsonQueryResult;
use serde::{Deserialize, Serialize};
use strum::{Display, EnumIter};

use crate::{
    migrator::MetadataImageLot,
    models::{
        AudioBookSpecifics, BookSpecifics, MovieSpecifics, PodcastSpecifics, ShowSpecifics,
        VideoGameSpecifics,
    },
};

pub mod resolver;

pub static PAGE_LIMIT: i32 = 20;

#[derive(Debug, Serialize, Deserialize, Clone, FromJsonQueryResult, Eq, PartialEq, Default)]
#[serde(tag = "t", content = "d")]
pub enum MediaSpecifics {
    AudioBook(AudioBookSpecifics),
    Book(BookSpecifics),
    Movie(MovieSpecifics),
    Podcast(PodcastSpecifics),
    Show(ShowSpecifics),
    VideoGame(VideoGameSpecifics),
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

#[derive(Display, Debug, EnumIter)]
pub enum DefaultCollection {
    Custom,
    #[strum(serialize = "In Progress")]
    InProgress,
    Watchlist,
}
