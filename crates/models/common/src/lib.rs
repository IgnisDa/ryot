use std::collections::HashSet;

use async_graphql::{Enum, InputObject, SimpleObject};
use enum_meta::{meta, Meta};
use rust_decimal::Decimal;
use schematic::Schematic;
use sea_orm::{prelude::DateTimeUtc, FromJsonQueryResult};
use serde::{Deserialize, Serialize};
use strum::{Display, EnumIter};

#[derive(Debug, SimpleObject, Serialize, Deserialize, Clone)]
pub struct IdObject {
    pub id: i32,
}

#[derive(Debug, SimpleObject, Serialize, Deserialize, Clone)]
pub struct StringIdObject {
    pub id: String,
}

#[derive(
    Debug,
    SimpleObject,
    Serialize,
    Deserialize,
    Default,
    Clone,
    PartialEq,
    Eq,
    Schematic,
    FromJsonQueryResult,
)]
#[serde(rename_all = "snake_case")]
pub struct IdAndNamedObject {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Eq, PartialEq, Hash)]
pub enum StoredUrl {
    S3(String),
    Url(String),
}

impl Default for StoredUrl {
    fn default() -> Self {
        Self::Url("".to_owned())
    }
}

#[derive(Debug, PartialEq, Eq, Clone, Copy, Serialize, Deserialize, Enum)]
pub enum CollectionExtraInformationLot {
    String,
    Number,
    Date,
    DateTime,
    StringArray,
}

#[derive(
    Debug,
    PartialEq,
    Eq,
    Clone,
    Serialize,
    Deserialize,
    SimpleObject,
    FromJsonQueryResult,
    InputObject,
)]
#[graphql(input_name = "CollectionExtraInformationInput")]
pub struct CollectionExtraInformation {
    pub name: String,
    pub description: String,
    pub lot: CollectionExtraInformationLot,
    pub default_value: Option<String>,
    pub required: Option<bool>,
}

#[derive(Display, EnumIter)]
pub enum DefaultCollection {
    Watchlist,
    #[strum(serialize = "In Progress")]
    InProgress,
    Completed,
    Monitoring,
    Custom,
    Owned,
    Reminders,
}

meta! {
    DefaultCollection, (Option<Vec<CollectionExtraInformation>>, &'static str);
    Watchlist, (None, "Things I want to watch in the future.");
    InProgress, (None, "Media items that I am currently watching.");
    Completed, (None, "Media items that I have completed.");
    Custom, (None, "Items that I have created manually.");
    Monitoring, (None, "Items that I am keeping an eye on.");
    Owned, (Some(
        vec![
            CollectionExtraInformation {
                name: "Owned on".to_string(),
                description: "When did you get this media?".to_string(),
                lot: CollectionExtraInformationLot::Date,
                default_value: None,
                required: None,
            }
        ]
    ), "Items that I have in my inventory.");
    Reminders, (Some(
        vec![
            CollectionExtraInformation {
                name: "Reminder".to_string(),
                description: "When do you want to be reminded?".to_string(),
                lot: CollectionExtraInformationLot::Date,
                default_value: None,
                required: Some(true),
            },
            CollectionExtraInformation {
                name: "Text".to_string(),
                description: "What do you want to be reminded about?".to_string(),
                lot: CollectionExtraInformationLot::String,
                default_value: None,
                required: Some(true),
            }
        ]
    ), "Items that I want to be reminded about.");
}

#[derive(Enum, Serialize, Deserialize, Clone, Debug, Copy, PartialEq, Eq)]
pub enum BackgroundJob {
    UpdateAllMetadata,
    UpdateAllExercises,
    SyncIntegrationsData,
    PerformBackgroundTasks,
    ReEvaluateUserWorkouts,
    RecalculateCalendarEvents,
    CalculateUserActivitiesAndSummary,
}

#[derive(Enum, Clone, Debug, Copy, PartialEq, Eq, Serialize, Deserialize, EnumIter, Display)]
#[strum(serialize_all = "SCREAMING_SNAKE_CASE")]
pub enum BackendError {
    NoUserId,
    NoAuthToken,
    SessionExpired,
    AdminOnlyAction,
    MutationNotAllowed,
}

#[derive(Debug, Serialize, Deserialize, Clone, SimpleObject, InputObject)]
#[graphql(input_name = "NamedObjectInput")]
pub struct NamedObject {
    pub name: String,
}

#[derive(Serialize, Deserialize, Debug, InputObject, Clone, Default)]
pub struct SearchInput {
    pub query: Option<String>,
    pub page: Option<i32>,
}

#[derive(Serialize, Deserialize, Debug, SimpleObject, Clone, Default)]
pub struct SearchDetails {
    pub total: i32,
    pub next_page: Option<i32>,
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

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct ExportJob {
    pub started_at: DateTimeUtc,
    pub ended_at: DateTimeUtc,
    pub exported: Vec<ExportItem>,
    pub url: String,
}
