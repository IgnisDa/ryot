use std::{
    collections::{HashMap, HashSet},
    fmt,
    sync::Arc,
};

use async_graphql::{Enum, InputObject, OutputType, Result as GraphqlResult, SimpleObject, Union};
use async_trait::async_trait;
use chrono::{DateTime, NaiveDate};
use common_models::StoredUrl;
use derive_more::{Add, AddAssign, Sum};
use enum_meta::{meta, Meta};
use enums::{
    EntityLot, ExerciseEquipment, ExerciseForce, ExerciseLevel, ExerciseLot, ExerciseMechanic,
    ExerciseMuscle, MediaLot, MediaSource, SeenState, Visibility,
};
use file_storage_service::FileStorageService;
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use schematic::ConfigEnum;
use schematic::Schematic;
use sea_orm::{prelude::DateTimeUtc, EnumIter, FromJsonQueryResult, FromQueryResult};
use serde::{de, Deserialize, Serialize};
use serde_with::skip_serializing_none;
use strum::Display;

use crate::{
    entities::{user_measurement, workout},
    traits::{DatabaseAssetsAsSingleUrl, DatabaseAssetsAsUrls, GraphqlRepresentation},
};

#[derive(Serialize, Deserialize, Debug, SimpleObject, Clone, Default)]
pub struct SearchDetails {
    pub total: i32,
    pub next_page: Option<i32>,
}

#[derive(Serialize, Deserialize, Debug, SimpleObject, Clone)]
#[graphql(concrete(name = "ExerciseListResults", params(fitness::ExerciseListItem)))]
#[graphql(concrete(name = "MediaCollectionContentsResults", params(media::EntityWithLot)))]
#[graphql(concrete(
    name = "MetadataSearchResults",
    params(media::MetadataSearchItemResponse)
))]
#[graphql(concrete(name = "PeopleSearchResults", params(media::PeopleSearchItem)))]
#[graphql(concrete(
    name = "MetadataGroupSearchResults",
    params(media::MetadataGroupSearchItem)
))]
#[graphql(concrete(name = "GenreListResults", params(media::GenreListItem)))]
#[graphql(concrete(name = "WorkoutListResults", params(workout::Model)))]
#[graphql(concrete(name = "IdResults", params(String)))]
pub struct SearchResults<T: OutputType> {
    pub details: SearchDetails,
    pub items: Vec<T>,
}

/// Complete export of the user.
#[skip_serializing_none]
#[derive(Debug, Serialize, Deserialize, Clone, Schematic)]
#[serde(rename_all = "snake_case")]
pub struct CompleteExport {
    /// Data about user's media.
    pub media: Option<Vec<media::ImportOrExportMediaItem>>,
    /// Data about user's people.
    pub people: Option<Vec<media::ImportOrExportPersonItem>>,
    /// Data about user's measurements.
    pub measurements: Option<Vec<user_measurement::Model>>,
    /// Data about user's workouts.
    pub workouts: Option<Vec<workout::Model>>,
    /// Data about user's media groups.
    pub media_group: Option<Vec<media::ImportOrExportMediaGroupItem>>,
}

#[derive(Debug, InputObject, Default)]
pub struct ChangeCollectionToEntityInput {
    pub creator_user_id: String,
    pub collection_name: String,
    pub metadata_id: Option<String>,
    pub person_id: Option<String>,
    pub metadata_group_id: Option<String>,
    pub exercise_id: Option<String>,
    pub workout_id: Option<String>,
    pub information: Option<serde_json::Value>,
}

#[derive(Enum, Eq, PartialEq, Copy, Clone, Debug, Serialize, Deserialize, Display)]
#[strum(serialize_all = "snake_case")]
pub enum ExportItem {
    Media,
    People,
    Workouts,
    MediaGroup,
    Measurements,
}

#[derive(Enum, Eq, PartialEq, Copy, Clone, Debug, Serialize, Deserialize, Display, EnumIter)]
pub enum MediaStateChanged {
    MetadataPublished,
    MetadataStatusChanged,
    MetadataReleaseDateChanged,
    MetadataNumberOfSeasonsChanged,
    MetadataEpisodeReleased,
    MetadataEpisodeNameChanged,
    MetadataChaptersOrEpisodesChanged,
    MetadataEpisodeImagesChanged,
    PersonMediaAssociated,
    ReviewPosted,
}

#[derive(
    SimpleObject, Debug, PartialEq, Eq, Clone, Default, Serialize, Deserialize, FromJsonQueryResult,
)]
pub struct AudioBooksSummary {
    pub runtime: i32,
    pub played: usize,
}

#[derive(
    SimpleObject, Debug, PartialEq, Eq, Clone, Default, Serialize, Deserialize, FromJsonQueryResult,
)]
pub struct VideoGamesSummary {
    pub played: usize,
}

#[derive(
    SimpleObject, Debug, PartialEq, Eq, Clone, Default, Serialize, Deserialize, FromJsonQueryResult,
)]
pub struct VisualNovelsSummary {
    pub played: usize,
    pub runtime: i32,
}

#[derive(
    SimpleObject, Debug, PartialEq, Eq, Clone, Default, Serialize, Deserialize, FromJsonQueryResult,
)]
pub struct BooksSummary {
    pub pages: i32,
    pub read: usize,
}

#[derive(
    SimpleObject, Debug, PartialEq, Eq, Clone, Default, Serialize, Deserialize, FromJsonQueryResult,
)]
pub struct MoviesSummary {
    pub runtime: i32,
    pub watched: usize,
}

#[derive(
    SimpleObject, Debug, PartialEq, Eq, Clone, Default, Serialize, Deserialize, FromJsonQueryResult,
)]
pub struct PodcastsSummary {
    pub runtime: i32,
    pub played: usize,
    pub played_episodes: usize,
}

#[derive(
    SimpleObject, Debug, PartialEq, Eq, Clone, Default, Serialize, Deserialize, FromJsonQueryResult,
)]
pub struct ShowsSummary {
    pub runtime: i32,
    pub watched: usize,
    pub watched_episodes: usize,
    pub watched_seasons: usize,
}

#[derive(
    SimpleObject, Debug, PartialEq, Eq, Clone, Default, Serialize, Deserialize, FromJsonQueryResult,
)]
pub struct MangaSummary {
    pub chapters: usize,
    pub read: usize,
}

#[derive(
    SimpleObject, Debug, PartialEq, Eq, Clone, Default, Serialize, Deserialize, FromJsonQueryResult,
)]
pub struct AnimeSummary {
    pub episodes: usize,
    pub watched: usize,
}

#[derive(
    SimpleObject, Debug, PartialEq, Eq, Clone, Default, Serialize, Deserialize, FromJsonQueryResult,
)]
pub struct MediaOverallSummary {
    pub reviewed: u64,
    pub interacted_with: u64,
}

#[derive(
    SimpleObject, Debug, PartialEq, Eq, Clone, Default, Serialize, Deserialize, FromJsonQueryResult,
)]
pub struct UserMediaSummary {
    pub books: BooksSummary,
    pub movies: MoviesSummary,
    pub podcasts: PodcastsSummary,
    pub shows: ShowsSummary,
    pub video_games: VideoGamesSummary,
    pub visual_novels: VisualNovelsSummary,
    pub audio_books: AudioBooksSummary,
    pub anime: AnimeSummary,
    pub manga: MangaSummary,
    pub metadata_overall: MediaOverallSummary,
    pub people_overall: MediaOverallSummary,
}

#[derive(
    SimpleObject, Debug, PartialEq, Eq, Clone, Default, Serialize, Deserialize, FromJsonQueryResult,
)]
pub struct UserFitnessWorkoutSummary {
    pub recorded: u64,
    pub duration: Decimal,
    pub weight: Decimal,
}

#[derive(
    SimpleObject, Debug, PartialEq, Eq, Clone, Default, Serialize, Deserialize, FromJsonQueryResult,
)]
pub struct UserFitnessSummary {
    pub measurements_recorded: u64,
    pub exercises_interacted_with: u64,
    pub workouts: UserFitnessWorkoutSummary,
}

#[derive(Debug, PartialEq, Eq, Clone, Default, Serialize, Deserialize, FromJsonQueryResult)]
pub struct UserSummaryUniqueItems {
    pub audio_books: HashSet<String>,
    pub anime_episodes: HashSet<(String, i32)>,
    pub anime: HashSet<String>,
    pub manga_volumes: HashSet<(String, i32)>,
    pub manga_chapters: HashSet<(String, i32)>,
    pub manga: HashSet<String>,
    pub books: HashSet<String>,
    pub movies: HashSet<String>,
    pub visual_novels: HashSet<String>,
    pub video_games: HashSet<String>,
    pub show_episodes: HashSet<(String, i32, i32)>,
    pub show_seasons: HashSet<(String, i32)>,
    pub shows: HashSet<String>,
    pub podcast_episodes: HashSet<(String, i32)>,
    pub podcasts: HashSet<String>,
}

#[derive(
    SimpleObject, Debug, PartialEq, Eq, Clone, Default, Serialize, Deserialize, FromJsonQueryResult,
)]
pub struct UserSummaryData {
    pub fitness: UserFitnessSummary,
    pub media: UserMediaSummary,
    #[graphql(skip)]
    pub unique_items: UserSummaryUniqueItems,
}

pub mod importer {
    use super::*;

    /// The various steps in which media importing can fail
    #[derive(Debug, Enum, PartialEq, Eq, Copy, Clone, Serialize, Deserialize)]
    pub enum ImportFailStep {
        /// Failed to get details from the source itself (for eg: MediaTracker, Goodreads etc.)
        ItemDetailsFromSource,
        /// Failed to get metadata from the provider (for eg: Openlibrary, IGDB etc.)
        MediaDetailsFromProvider,
        /// Failed to transform the data into the required format
        InputTransformation,
        /// Failed to save a seen history item
        SeenHistoryConversion,
        /// Failed to save a review/rating item
        ReviewConversion,
    }

    #[derive(
        Debug, SimpleObject, FromJsonQueryResult, Serialize, Deserialize, Eq, PartialEq, Clone,
    )]
    pub struct ImportFailedItem {
        pub lot: Option<MediaLot>,
        pub step: ImportFailStep,
        pub identifier: String,
        pub error: Option<String>,
    }

    #[derive(Debug, SimpleObject, Serialize, Deserialize, Eq, PartialEq, Clone)]
    pub struct ImportDetails {
        pub total: usize,
    }

    #[derive(
        Debug, SimpleObject, Serialize, Deserialize, FromJsonQueryResult, Eq, PartialEq, Clone,
    )]
    pub struct ImportResultResponse {
        pub import: ImportDetails,
        pub failed_items: Vec<ImportFailedItem>,
    }
}

pub mod audiobookshelf_models {
    use super::*;

    #[derive(Debug, Serialize, Deserialize, Clone, Display)]
    #[serde(rename_all = "snake_case")]
    pub enum MediaType {
        Book,
        Podcast,
    }

    #[derive(Debug, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct ItemProgress {
        pub progress: Decimal,
        pub is_finished: bool,
        pub ebook_progress: Option<Decimal>,
    }

    #[derive(Debug, Serialize, Deserialize, Clone)]
    #[serde(rename_all = "camelCase")]
    pub struct ItemMetadata {
        pub title: String,
        pub id: Option<String>,
        pub asin: Option<String>,
        pub isbn: Option<String>,
        pub itunes_id: Option<String>,
    }

    #[derive(Debug, Serialize, Deserialize, Clone)]
    #[serde(rename_all = "camelCase")]
    pub struct ItemMedia {
        pub metadata: ItemMetadata,
        pub ebook_format: Option<String>,
        pub episodes: Option<Vec<ItemMetadata>>,
    }

    #[derive(Debug, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct RecentEpisode {
        pub id: String,
        pub title: String,
        pub season: Option<String>,
        pub episode: Option<String>,
    }

    #[derive(Debug, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Item {
        pub id: String,
        pub name: Option<String>,
        pub media: Option<ItemMedia>,
        pub media_type: Option<MediaType>,
        pub recent_episode: Option<RecentEpisode>,
        pub user_media_progress: Option<ItemProgress>,
    }

    #[derive(Debug, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Response {
        pub library_items: Vec<Item>,
    }

    #[derive(Debug, Serialize, Deserialize)]
    pub struct LibrariesListResponse {
        pub libraries: Vec<Item>,
    }

    #[derive(Debug, Serialize, Deserialize)]
    pub struct ListResponse {
        pub results: Vec<Item>,
    }
}
