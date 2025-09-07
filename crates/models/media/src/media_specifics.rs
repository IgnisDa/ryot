use async_graphql::{InputObject, SimpleObject};
use chrono::{NaiveDate, NaiveDateTime};
use common_utils::deserialize_date;
use rust_decimal::Decimal;
use sea_orm::{FromJsonQueryResult, prelude::DateTimeUtc};
use serde::{Deserialize, Serialize};
use serde_with::skip_serializing_none;

#[skip_serializing_none]
#[derive(
    Eq,
    Clone,
    Debug,
    Default,
    PartialEq,
    Serialize,
    InputObject,
    Deserialize,
    SimpleObject,
    FromJsonQueryResult,
)]
#[graphql(input_name = "AudioBookSpecificsInput")]
pub struct AudioBookSpecifics {
    pub runtime: Option<i32>,
}

#[skip_serializing_none]
#[derive(
    Eq,
    Debug,
    Clone,
    Default,
    PartialEq,
    Serialize,
    Deserialize,
    InputObject,
    SimpleObject,
    FromJsonQueryResult,
)]
#[graphql(input_name = "BookSpecificsInput")]
pub struct BookSpecifics {
    pub pages: Option<i32>,
    pub is_compilation: Option<bool>,
}

#[skip_serializing_none]
#[derive(
    Eq,
    Debug,
    Clone,
    Default,
    PartialEq,
    Serialize,
    Deserialize,
    InputObject,
    SimpleObject,
    FromJsonQueryResult,
)]
#[graphql(input_name = "MovieSpecificsInput")]
pub struct MovieSpecifics {
    pub runtime: Option<i32>,
}

#[skip_serializing_none]
#[derive(
    Eq,
    Debug,
    Clone,
    Default,
    PartialEq,
    Serialize,
    Deserialize,
    InputObject,
    SimpleObject,
    FromJsonQueryResult,
)]
#[graphql(input_name = "PodcastSpecificsInput")]
pub struct PodcastSpecifics {
    pub total_episodes: usize,
    pub episodes: Vec<PodcastEpisode>,
}

#[skip_serializing_none]
#[derive(
    Eq,
    Debug,
    Clone,
    Default,
    PartialEq,
    Serialize,
    Deserialize,
    InputObject,
    SimpleObject,
    FromJsonQueryResult,
)]
#[graphql(input_name = "PodcastEpisodeInput")]
#[serde(default)]
pub struct PodcastEpisode {
    pub id: String,
    pub number: i32,
    pub title: String,
    #[serde(alias = "audio_length_sec")]
    pub runtime: Option<i32>,
    #[serde(alias = "description")]
    pub overview: Option<String>,
    #[serde(alias = "pub_date_ms", deserialize_with = "deserialize_date")]
    pub publish_date: NaiveDate,
    pub thumbnail: Option<String>,
}

#[skip_serializing_none]
#[derive(
    Eq,
    Debug,
    Clone,
    Default,
    PartialEq,
    Serialize,
    Deserialize,
    InputObject,
    SimpleObject,
    FromJsonQueryResult,
)]
#[graphql(input_name = "ShowSpecificsInput")]
pub struct ShowSpecifics {
    pub runtime: Option<i32>,
    pub seasons: Vec<ShowSeason>,
    pub total_seasons: Option<usize>,
    pub total_episodes: Option<usize>,
}

#[skip_serializing_none]
#[derive(
    Eq,
    Hash,
    Debug,
    Clone,
    Default,
    PartialEq,
    Serialize,
    Deserialize,
    InputObject,
    SimpleObject,
    FromJsonQueryResult,
)]
#[graphql(input_name = "ShowSeasonSpecificsInput")]
pub struct ShowSeason {
    pub id: i32,
    pub name: String,
    pub season_number: i32,
    pub overview: Option<String>,
    pub episodes: Vec<ShowEpisode>,
    pub poster_images: Vec<String>,
    pub backdrop_images: Vec<String>,
    pub publish_date: Option<NaiveDate>,
}

#[skip_serializing_none]
#[derive(
    Eq,
    Hash,
    Debug,
    Clone,
    Default,
    PartialEq,
    Serialize,
    Deserialize,
    InputObject,
    SimpleObject,
    FromJsonQueryResult,
)]
#[graphql(input_name = "ShowEpisodeSpecificsInput")]
pub struct ShowEpisode {
    pub id: i32,
    pub name: String,
    pub episode_number: i32,
    pub runtime: Option<i32>,
    pub overview: Option<String>,
    pub poster_images: Vec<String>,
    pub publish_date: Option<NaiveDate>,
}

#[skip_serializing_none]
#[derive(
    Eq,
    Hash,
    Debug,
    Clone,
    Default,
    PartialEq,
    Serialize,
    Deserialize,
    InputObject,
    SimpleObject,
    FromJsonQueryResult,
)]
#[graphql(input_name = "VideoGameSpecificsTimeToBeatInput")]
pub struct VideoGameSpecificsTimeToBeat {
    pub hastily: Option<i32>,
    pub normally: Option<i32>,
    pub completely: Option<i32>,
}

#[skip_serializing_none]
#[derive(
    Eq,
    Hash,
    Debug,
    Clone,
    Default,
    PartialEq,
    Serialize,
    Deserialize,
    InputObject,
    SimpleObject,
    FromJsonQueryResult,
)]
#[graphql(input_name = "VideoGameSpecificsPlatformReleaseInput")]
pub struct VideoGameSpecificsPlatformRelease {
    pub name: String,
    pub release_region: Option<String>,
    pub release_date: Option<DateTimeUtc>,
}

#[skip_serializing_none]
#[derive(
    Eq,
    Debug,
    Clone,
    Default,
    PartialEq,
    Serialize,
    Deserialize,
    InputObject,
    SimpleObject,
    FromJsonQueryResult,
)]
#[graphql(input_name = "VideoGameSpecificsInput")]
pub struct VideoGameSpecifics {
    pub time_to_beat: Option<VideoGameSpecificsTimeToBeat>,
    pub platform_releases: Option<Vec<VideoGameSpecificsPlatformRelease>>,
}

#[skip_serializing_none]
#[derive(
    Eq,
    Debug,
    Clone,
    Default,
    PartialEq,
    Serialize,
    Deserialize,
    InputObject,
    SimpleObject,
    FromJsonQueryResult,
)]
#[graphql(input_name = "VisualNovelSpecificsInput")]
pub struct VisualNovelSpecifics {
    pub length: Option<i32>,
}

#[skip_serializing_none]
#[derive(
    Eq,
    Debug,
    Clone,
    Default,
    PartialEq,
    Serialize,
    Deserialize,
    InputObject,
    SimpleObject,
    FromJsonQueryResult,
)]
#[graphql(input_name = "AnimeAiringScheduleSpecificsInput")]
pub struct AnimeAiringScheduleSpecifics {
    pub episode: i32,
    pub airing_at: NaiveDateTime,
}

#[skip_serializing_none]
#[derive(
    Eq,
    Debug,
    Clone,
    Default,
    PartialEq,
    Serialize,
    Deserialize,
    InputObject,
    SimpleObject,
    FromJsonQueryResult,
)]
#[graphql(input_name = "AnimeSpecificsInput")]
pub struct AnimeSpecifics {
    pub episodes: Option<i32>,
    pub airing_schedule: Option<Vec<AnimeAiringScheduleSpecifics>>,
}

#[skip_serializing_none]
#[derive(
    Eq,
    Debug,
    Clone,
    Default,
    Serialize,
    PartialEq,
    InputObject,
    Deserialize,
    SimpleObject,
    FromJsonQueryResult,
)]
#[graphql(input_name = "MusicSpecificsInput")]
pub struct MusicSpecifics {
    pub duration: Option<i32>,
    pub view_count: Option<i32>,
    pub disc_number: Option<i32>,
    pub track_number: Option<i32>,
    pub by_various_artists: Option<bool>,
}

#[skip_serializing_none]
#[derive(
    Eq,
    Debug,
    Clone,
    Default,
    PartialEq,
    Serialize,
    Deserialize,
    InputObject,
    SimpleObject,
    FromJsonQueryResult,
)]
#[graphql(input_name = "MangaSpecificsInput")]
pub struct MangaSpecifics {
    pub url: Option<String>,
    pub volumes: Option<i32>,
    pub chapters: Option<Decimal>,
}
