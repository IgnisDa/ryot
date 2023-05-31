use sea_orm::FromJsonQueryResult;
use serde::{Deserialize, Serialize};

use crate::{
    audio_books::AudioBookSpecifics, books::BookSpecifics, migrator::MetadataImageLot,
    movies::MovieSpecifics, podcasts::PodcastSpecifics, shows::ShowSpecifics,
    video_games::VideoGameSpecifics,
};

pub mod resolver;

pub static LIMIT: i32 = 20;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum MediaSpecifics {
    AudioBook(AudioBookSpecifics),
    Book(BookSpecifics),
    Movie(MovieSpecifics),
    Show(ShowSpecifics),
    VideoGame(VideoGameSpecifics),
    Podcast(PodcastSpecifics),
}

#[derive(Clone, Debug, PartialEq, FromJsonQueryResult, Eq, Serialize, Deserialize)]
pub struct MetadataImage {
    pub url: String,
    pub lot: MetadataImageLot,
}

#[derive(Clone, Debug, PartialEq, FromJsonQueryResult, Eq, Serialize, Deserialize)]
pub struct MetadataImages(pub Vec<MetadataImage>);

#[derive(Clone, Debug, PartialEq, FromJsonQueryResult, Eq, Serialize, Deserialize)]
pub struct MetadataCreator {
    pub name: String,
    pub role: String,
    pub image_urls: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, FromJsonQueryResult, Eq, Serialize, Deserialize)]
pub struct MetadataCreators(pub Vec<MetadataCreator>);
