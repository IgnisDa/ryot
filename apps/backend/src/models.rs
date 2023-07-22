use async_graphql::{Enum, InputObject, OutputType, SimpleObject, Union};
use chrono::NaiveDate;
use rust_decimal::Decimal;
use sea_orm::{prelude::DateTimeUtc, DeriveActiveEnum, EnumIter, FromJsonQueryResult};
use serde::{Deserialize, Serialize};

use crate::{
    entities::{exercise::Model as ExerciseModel, review, seen},
    migrator::{MetadataLot, MetadataSource},
    miscellaneous::{MediaSpecifics, MetadataCreator, MetadataImage},
};

#[derive(Debug, Serialize, Deserialize, Clone, SimpleObject, InputObject)]
#[graphql(input_name = "NamedObjectInput")]
pub struct NamedObject {
    pub name: String,
}

#[derive(Serialize, Deserialize, Debug, InputObject)]
pub struct SearchInput {
    pub query: String,
    pub page: Option<i32>,
}

#[derive(Serialize, Deserialize, Debug, SimpleObject, Clone)]
#[graphql(concrete(name = "MediaSearchResults", params(media::MediaSearchItem)))]
#[graphql(concrete(name = "MediaListResults", params(media::MediaListItem)))]
#[graphql(concrete(name = "ExerciseSearchResults", params(ExerciseModel)))]
pub struct SearchResults<T: OutputType> {
    pub total: i32,
    pub items: Vec<T>,
    pub next_page: Option<i32>,
}

#[derive(Debug, SimpleObject, Serialize, Deserialize)]
pub struct IdObject {
    pub id: i32,
}

pub mod media {
    use super::*;

    #[derive(Debug, InputObject, Default)]
    pub struct CreateOrUpdateCollectionInput {
        pub name: String,
        pub description: Option<String>,
        pub visibility: Option<Visibility>,
        pub update_id: Option<i32>,
    }

    #[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
    pub struct MediaListItem {
        pub data: MediaSearchItem,
        pub average_rating: Option<Decimal>,
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
        pub volumes: Option<i32>,
    }

    #[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
    pub struct MediaSearchItem {
        pub identifier: String,
        pub lot: MetadataLot,
        pub title: String,
        pub image: Option<String>,
        pub publish_year: Option<i32>,
    }

    #[derive(
        Debug, Clone, Copy, PartialEq, Eq, EnumIter, DeriveActiveEnum, Deserialize, Serialize, Enum,
    )]
    #[sea_orm(rs_type = "String", db_type = "String(None)")]
    pub enum Visibility {
        #[sea_orm(string_value = "PU")]
        Public,
        #[sea_orm(string_value = "PR")]
        Private,
    }

    #[derive(Debug, Serialize, Deserialize)]
    pub struct ExportMedia {
        pub ryot_id: i32,
        pub title: String,
        #[serde(rename = "type")]
        pub lot: MetadataLot,
        pub audible_id: Option<String>,
        pub custom_id: Option<String>,
        pub igdb_id: Option<String>,
        pub listennotes_id: Option<String>,
        pub google_books_id: Option<String>,
        pub openlibrary_id: Option<String>,
        pub tmdb_id: Option<String>,
        pub itunes_id: Option<String>,
        pub anilist_id: Option<String>,
        pub seen_history: Vec<seen::Model>,
        pub user_reviews: Vec<review::Model>,
    }

    #[derive(
        SimpleObject,
        Debug,
        PartialEq,
        Eq,
        Clone,
        Default,
        Serialize,
        Deserialize,
        FromJsonQueryResult,
    )]
    pub struct AudioBooksSummary {
        pub runtime: i32,
        pub played: i32,
    }

    #[derive(
        SimpleObject,
        Debug,
        PartialEq,
        Eq,
        Clone,
        Default,
        Serialize,
        Deserialize,
        FromJsonQueryResult,
    )]
    pub struct VideoGamesSummary {
        pub played: i32,
    }

    #[derive(
        SimpleObject,
        Debug,
        PartialEq,
        Eq,
        Clone,
        Default,
        Serialize,
        Deserialize,
        FromJsonQueryResult,
    )]
    pub struct BooksSummary {
        pub pages: i32,
        pub read: i32,
    }

    #[derive(
        SimpleObject,
        Debug,
        PartialEq,
        Eq,
        Clone,
        Default,
        Serialize,
        Deserialize,
        FromJsonQueryResult,
    )]
    pub struct MoviesSummary {
        pub runtime: i32,
        pub watched: i32,
    }

    #[derive(
        SimpleObject,
        Debug,
        PartialEq,
        Eq,
        Clone,
        Default,
        Serialize,
        Deserialize,
        FromJsonQueryResult,
    )]
    pub struct PodcastsSummary {
        pub runtime: i32,
        pub played: i32,
        pub played_episodes: i32,
    }

    #[derive(
        SimpleObject,
        Debug,
        PartialEq,
        Eq,
        Clone,
        Default,
        Serialize,
        Deserialize,
        FromJsonQueryResult,
    )]
    pub struct ShowsSummary {
        pub runtime: i32,
        pub watched: i32,
        pub watched_episodes: i32,
        pub watched_seasons: i32,
    }

    #[derive(
        SimpleObject,
        Debug,
        PartialEq,
        Eq,
        Clone,
        Default,
        Serialize,
        Deserialize,
        FromJsonQueryResult,
    )]
    pub struct MangaSummary {
        pub chapters: i32,
        pub read: i32,
    }

    #[derive(
        SimpleObject,
        Debug,
        PartialEq,
        Eq,
        Clone,
        Default,
        Serialize,
        Deserialize,
        FromJsonQueryResult,
    )]
    pub struct AnimeSummary {
        pub episodes: i32,
        pub watched: i32,
    }

    #[derive(
        SimpleObject,
        Debug,
        PartialEq,
        Eq,
        Clone,
        Default,
        Serialize,
        Deserialize,
        FromJsonQueryResult,
    )]
    pub struct UserMediaSummary {
        #[serde(default)]
        pub books: BooksSummary,
        #[serde(default)]
        pub movies: MoviesSummary,
        #[serde(default)]
        pub podcasts: PodcastsSummary,
        #[serde(default)]
        pub shows: ShowsSummary,
        #[serde(default)]
        pub video_games: VideoGamesSummary,
        #[serde(default)]
        pub audio_books: AudioBooksSummary,
        #[serde(default)]
        pub anime: AnimeSummary,
        #[serde(default)]
        pub manga: MangaSummary,
        #[serde(default)]
        pub reviews_posted: u64,
    }

    #[derive(
        SimpleObject,
        Debug,
        PartialEq,
        Eq,
        Clone,
        Default,
        Serialize,
        Deserialize,
        FromJsonQueryResult,
    )]
    pub struct UserSummary {
        pub media: UserMediaSummary,
        pub calculated_on: DateTimeUtc,
    }

    #[derive(Debug, InputObject)]
    pub struct AddMediaToCollection {
        pub collection_name: String,
        pub media_id: i32,
    }

    #[derive(Debug, InputObject)]
    pub struct PostReviewInput {
        pub rating: Option<Decimal>,
        pub text: Option<String>,
        pub visibility: Option<Visibility>,
        pub spoiler: Option<bool>,
        pub metadata_id: i32,
        pub date: Option<DateTimeUtc>,
        /// If this review comes from a different source, this should be set
        pub identifier: Option<String>,
        /// ID of the review if this is an update to an existing review
        pub review_id: Option<i32>,
        pub show_season_number: Option<i32>,
        pub show_episode_number: Option<i32>,
        pub podcast_episode_number: Option<i32>,
    }

    #[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
    pub struct ProgressUpdateInput {
        pub metadata_id: i32,
        pub progress: Option<i32>,
        pub date: Option<NaiveDate>,
        pub show_season_number: Option<i32>,
        pub show_episode_number: Option<i32>,
        pub podcast_episode_number: Option<i32>,
    }

    #[derive(Enum, Clone, Debug, Copy, PartialEq, Eq)]
    pub enum ProgressUpdateErrorVariant {
        AlreadySeen,
        NoSeenInProgress,
        InvalidUpdate,
    }

    #[derive(Debug, SimpleObject)]
    pub struct ProgressUpdateError {
        pub error: ProgressUpdateErrorVariant,
    }

    #[derive(Union)]
    pub enum ProgressUpdateResultUnion {
        Ok(IdObject),
        Error(ProgressUpdateError),
    }

    #[derive(Debug, Serialize, Deserialize, Clone)]
    pub struct MediaDetails {
        pub identifier: String,
        pub title: String,
        pub source: MetadataSource,
        pub description: Option<String>,
        pub lot: MetadataLot,
        pub creators: Vec<MetadataCreator>,
        pub genres: Vec<String>,
        pub images: Vec<MetadataImage>,
        pub publish_year: Option<i32>,
        pub publish_date: Option<NaiveDate>,
        pub specifics: MediaSpecifics,
    }
}

pub mod fitness {
    use async_graphql::Enum;

    use super::*;

    #[derive(
        Debug, Clone, Serialize, Enum, Copy, Deserialize, FromJsonQueryResult, Eq, PartialEq,
    )]
    #[serde(rename_all = "snake_case")]
    pub enum ExerciseForce {
        Static,
        Pull,
        Push,
    }

    #[derive(
        Debug, Clone, Serialize, Enum, Copy, Deserialize, FromJsonQueryResult, Eq, PartialEq,
    )]
    #[serde(rename_all = "snake_case")]
    pub enum ExerciseLevel {
        Beginner,
        Intermediate,
        Expert,
    }

    #[derive(
        Debug, Clone, Serialize, Enum, Copy, Deserialize, FromJsonQueryResult, Eq, PartialEq,
    )]
    #[serde(rename_all = "snake_case")]
    pub enum ExerciseMechanic {
        Isolation,
        Compound,
    }

    #[derive(
        Debug, Clone, Serialize, Enum, Copy, Deserialize, FromJsonQueryResult, Eq, PartialEq,
    )]
    #[serde(rename_all = "snake_case")]
    pub enum ExerciseEquipment {
        #[serde(rename = "medicine ball")]
        MedicineBall,
        Dumbbell,
        #[serde(rename = "body only")]
        BodyOnly,
        Bands,
        Kettlebells,
        #[serde(rename = "foam roll")]
        FoamRoll,
        Cable,
        Machine,
        Barbell,
        #[serde(rename = "exercise ball")]
        ExerciseBall,
        #[serde(rename = "e-z curl bar")]
        EZCurlBar,
        Other,
    }

    #[derive(
        Debug, Clone, Serialize, Enum, Copy, Deserialize, FromJsonQueryResult, Eq, PartialEq,
    )]
    #[serde(rename_all = "snake_case")]
    pub enum ExerciseMuscle {
        Abdominals,
        Abductors,
        Adductors,
        Biceps,
        Calves,
        Chest,
        Forearms,
        Glutes,
        Hamstrings,
        Lats,
        #[serde(rename = "lower back")]
        LowerBack,
        #[serde(rename = "middle back")]
        MiddleBack,
        Neck,
        Quadriceps,
        Shoulders,
        Traps,
        Triceps,
    }

    #[derive(
        Debug, Clone, Serialize, Enum, Copy, Deserialize, FromJsonQueryResult, Eq, PartialEq,
    )]
    #[serde(rename_all = "snake_case")]
    pub enum ExerciseCategory {
        Powerlifting,
        Strength,
        Stretching,
        Cardio,
        #[serde(rename = "olympic weightlifting")]
        OlympicWeightlifting,
        Strongman,
        Plyometrics,
    }

    #[derive(
        Debug, Clone, Serialize, SimpleObject, Deserialize, FromJsonQueryResult, Eq, PartialEq,
    )]
    #[serde(rename_all = "camelCase")]
    pub struct ExerciseAttributes {
        pub force: Option<ExerciseForce>,
        pub level: ExerciseLevel,
        pub mechanic: Option<ExerciseMechanic>,
        pub equipment: Option<ExerciseEquipment>,
        pub primary_muscles: Vec<ExerciseMuscle>,
        pub secondary_muscles: Vec<ExerciseMuscle>,
        pub category: ExerciseCategory,
        pub instructions: Vec<String>,
        #[serde(default)]
        pub images: Vec<String>,
        #[serde(default)]
        pub alternate_names: Vec<String>,
    }

    #[derive(Debug, Clone, Serialize, Deserialize, FromJsonQueryResult, Eq, PartialEq)]
    #[serde(rename_all = "camelCase")]
    pub struct Exercise {
        #[serde(rename = "id")]
        pub identifier: String,
        #[serde(flatten)]
        pub attributes: ExerciseAttributes,
        pub name: String,
    }
}
