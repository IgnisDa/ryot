use async_graphql::{InputObject, SimpleObject};
use chrono::NaiveDate;
use sea_orm::FromJsonQueryResult;
use serde::{Deserialize, Serialize};

fn get_serde_true() -> bool {
    true
}

#[derive(
    Debug, Serialize, Deserialize, SimpleObject, Clone, InputObject, PartialEq, Eq, Default,
)]
#[graphql(input_name = "AudioBookSpecificsInput")]
pub struct AudioBookSpecifics {
    pub runtime: Option<i32>,
}

#[derive(
    Debug, Serialize, Deserialize, SimpleObject, Clone, InputObject, PartialEq, Eq, Default,
)]
#[graphql(input_name = "BookSpecificsInput")]
pub struct BookSpecifics {
    pub pages: Option<i32>,
}

#[derive(
    Debug, Serialize, Deserialize, SimpleObject, Clone, InputObject, Eq, PartialEq, Default,
)]
#[graphql(input_name = "MovieSpecificsInput")]
pub struct MovieSpecifics {
    pub runtime: Option<i32>,
}

#[derive(
    Debug,
    Serialize,
    Deserialize,
    SimpleObject,
    Clone,
    Default,
    FromJsonQueryResult,
    Eq,
    PartialEq,
    InputObject,
)]
#[graphql(input_name = "PodcastSpecificsInput")]
pub struct PodcastSpecifics {
    pub episodes: Vec<PodcastEpisode>,
    pub total_episodes: i32,
}

#[derive(
    Debug,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    SimpleObject,
    Clone,
    Default,
    FromJsonQueryResult,
    InputObject,
)]
#[graphql(input_name = "PodcastEpisodeInput")]
pub struct PodcastEpisode {
    #[serde(default)]
    pub number: i32,
    pub id: String,
    #[serde(rename = "audio_length_sec")]
    pub runtime: Option<i32>,
    #[serde(rename = "description")]
    pub overview: Option<String>,
    pub title: String,
    #[serde(rename = "pub_date_ms")]
    pub publish_date: i64,
    pub thumbnail: Option<String>,
}

#[derive(
    Debug,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    SimpleObject,
    Clone,
    Default,
    FromJsonQueryResult,
    InputObject,
)]
#[graphql(input_name = "ShowSpecificsInput")]
pub struct ShowSpecifics {
    pub seasons: Vec<ShowSeason>,
}

#[derive(
    Debug,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    SimpleObject,
    Clone,
    Default,
    FromJsonQueryResult,
    Hash,
    InputObject,
)]
#[graphql(input_name = "ShowSeasonSpecificsInput")]
pub struct ShowSeason {
    pub id: i32,
    pub season_number: i32,
    pub name: String,
    pub publish_date: Option<NaiveDate>,
    pub episodes: Vec<ShowEpisode>,
    pub overview: Option<String>,
    pub poster_images: Vec<String>,
    pub backdrop_images: Vec<String>,
}

#[derive(
    Debug,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    SimpleObject,
    Clone,
    Default,
    FromJsonQueryResult,
    Hash,
    InputObject,
)]
#[graphql(input_name = "ShowEpisodeSpecificsInput")]
pub struct ShowEpisode {
    pub id: i32,
    pub episode_number: i32,
    pub publish_date: Option<NaiveDate>,
    pub name: String,
    pub overview: Option<String>,
    pub poster_images: Vec<String>,
    pub runtime: Option<i32>,
}

#[derive(
    Debug,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    SimpleObject,
    Clone,
    Default,
    FromJsonQueryResult,
    InputObject,
)]
#[graphql(input_name = "VideoGameSpecificsInput")]
pub struct VideoGameSpecifics {
    pub platforms: Vec<String>,
}

#[derive(
    Debug,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    SimpleObject,
    Clone,
    Default,
    FromJsonQueryResult,
    InputObject,
)]
#[graphql(input_name = "AnimeSpecificsInput")]
pub struct AnimeSpecifics {
    pub episodes: Option<i32>,
}

#[derive(
    Debug,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    SimpleObject,
    Clone,
    Default,
    FromJsonQueryResult,
    InputObject,
)]
#[graphql(input_name = "MangaSpecificsInput")]
pub struct MangaSpecifics {
    pub chapters: Option<i32>,
}

#[derive(
    Debug,
    Serialize,
    Deserialize,
    SimpleObject,
    Clone,
    InputObject,
    Eq,
    PartialEq,
    Default,
    FromJsonQueryResult,
)]
#[graphql(input_name = "UserPreferencesInput")]
pub struct UserPreferences {
    // features enabled
    #[serde(default = "get_serde_true")]
    pub anime: bool,
    #[serde(default = "get_serde_true")]
    pub audio_books: bool,
    #[serde(default = "get_serde_true")]
    pub books: bool,
    #[serde(default = "get_serde_true")]
    pub manga: bool,
    #[serde(default = "get_serde_true")]
    pub movies: bool,
    #[serde(default = "get_serde_true")]
    pub podcasts: bool,
    #[serde(default = "get_serde_true")]
    pub shows: bool,
    #[serde(default = "get_serde_true")]
    pub video_games: bool,
}
