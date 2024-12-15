use std::collections::HashMap;

use async_graphql::{Enum, InputObject, SimpleObject};
use chrono::NaiveDate;
use educe::Educe;
use enum_meta::{meta, Meta};
use enums::{EntityLot, ExerciseEquipment, ExerciseMuscle, MediaLot, MediaSource};
use rust_decimal::Decimal;
use schematic::{ConfigEnum, Schematic};
use sea_orm::{prelude::DateTimeUtc, FromJsonQueryResult, FromQueryResult};
use serde::{Deserialize, Serialize};
use serde_with::skip_serializing_none;
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

#[derive(Debug, Serialize, Deserialize, Clone, Eq, PartialEq, Hash, Educe)]
#[educe(Default(expression = StoredUrl::Url(String::from("https://upload.wikimedia.org/wikipedia/en/a/a6/Pok%C3%A9mon_Pikachu_art.png"))))]
pub enum StoredUrl {
    S3(String),
    Url(String),
}

#[derive(Debug, InputObject)]
pub struct UpdateComplexJsonInput {
    /// Dot delimited path to the property that needs to be changed.
    pub property: String,
    pub value: String,
}

#[derive(Debug, PartialEq, Eq, Clone, Copy, Serialize, Deserialize, Enum, ConfigEnum)]
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
    Schematic,
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
    ReviseUserWorkouts,
    UpdateAllExercises,
    SyncIntegrationsData,
    PerformBackgroundTasks,
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

#[derive(
    Clone, Debug, Default, PartialEq, InputObject, FromJsonQueryResult, Eq, Serialize, Deserialize,
)]
pub struct SearchInput {
    pub page: Option<i32>,
    pub query: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, SimpleObject, Clone, Default)]
pub struct SearchDetails {
    pub total: i32,
    pub next_page: Option<i32>,
}

#[derive(Debug, InputObject, Default)]
pub struct ChangeCollectionToEntityInput {
    pub entity_id: String,
    pub entity_lot: EntityLot,
    pub creator_user_id: String,
    pub collection_name: String,
    pub information: Option<serde_json::Value>,
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

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct ExportJob {
    pub size: i64,
    pub url: String,
    pub ended_at: DateTimeUtc,
    pub started_at: DateTimeUtc,
}

#[skip_serializing_none]
#[derive(
    Debug, PartialEq, Eq, Serialize, Deserialize, Clone, SimpleObject, FromJsonQueryResult,
)]
pub struct DailyUserActivityHourRecordEntity {
    pub entity_id: String,
    pub entity_lot: EntityLot,
    pub metadata_lot: Option<MediaLot>,
}

#[skip_serializing_none]
#[derive(
    Debug, PartialEq, Eq, Serialize, Deserialize, Clone, SimpleObject, FromJsonQueryResult,
)]
pub struct DailyUserActivityHourRecord {
    // DEV: The hour in UTC time
    pub hour: u32,
    pub entities: Vec<DailyUserActivityHourRecordEntity>,
}

/// The start date must be before the end date.
#[skip_serializing_none]
#[derive(
    Debug, Default, Serialize, Deserialize, SimpleObject, InputObject, Clone, Eq, PartialEq,
)]
#[graphql(input_name = "ApplicationDateRangeInput")]
pub struct ApplicationDateRange {
    pub end_date: Option<NaiveDate>,
    pub start_date: Option<NaiveDate>,
}

#[derive(Debug, Serialize, Deserialize, Enum, Clone, Copy, Eq, PartialEq, Display)]
#[strum(serialize_all = "snake_case")]
pub enum DailyUserActivitiesResponseGroupedBy {
    Day,
    Month,
    Year,
    Millennium,
}

#[skip_serializing_none]
#[derive(Debug, Default, Serialize, Deserialize, InputObject, Clone, PartialEq, Eq)]
pub struct UserAnalyticsInput {
    pub date_range: ApplicationDateRange,
    pub group_by: Option<DailyUserActivitiesResponseGroupedBy>,
}

#[skip_serializing_none]
#[derive(
    Debug, Default, SimpleObject, Serialize, Deserialize, Clone, FromQueryResult, PartialEq, Eq,
)]
pub struct DailyUserActivityItem {
    pub day: NaiveDate,
    pub total_metadata_review_count: i64,
    pub total_collection_review_count: i64,
    pub total_metadata_group_review_count: i64,
    pub total_person_review_count: i64,
    pub user_measurement_count: i64,
    pub workout_count: i64,
    pub total_workout_duration: i64,
    pub audio_book_count: i64,
    pub total_audio_book_duration: i64,
    pub anime_count: i64,
    pub book_count: i64,
    pub total_book_pages: i64,
    pub podcast_count: i64,
    pub total_podcast_duration: i64,
    pub manga_count: i64,
    pub movie_count: i64,
    pub total_movie_duration: i64,
    pub show_count: i64,
    pub total_show_duration: i64,
    pub video_game_count: i64,
    pub total_video_game_duration: i64,
    pub visual_novel_count: i64,
    pub total_visual_novel_duration: i64,
    pub total_workout_personal_bests: i64,
    pub total_workout_weight: i64,
    pub total_workout_reps: i64,
    pub total_workout_distance: i64,
    pub total_workout_rest_time: i64,
    pub total_metadata_count: i64,
    pub total_review_count: i64,
    pub total_count: i64,
    pub total_duration: i64,
}

#[skip_serializing_none]
#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone, PartialEq, Eq)]
pub struct DailyUserActivitiesResponse {
    pub total_count: i64,
    pub item_count: usize,
    pub total_duration: i64,
    pub items: Vec<DailyUserActivityItem>,
    pub grouped_by: DailyUserActivitiesResponseGroupedBy,
}

#[skip_serializing_none]
#[derive(
    Debug, SimpleObject, Serialize, Deserialize, FromJsonQueryResult, Clone, Eq, PartialEq,
)]
pub struct FitnessAnalyticsExercise {
    pub count: u32,
    pub exercise: String,
}

#[skip_serializing_none]
#[derive(
    Debug, SimpleObject, Serialize, Deserialize, FromJsonQueryResult, Clone, Eq, PartialEq,
)]
pub struct FitnessAnalyticsMuscle {
    pub count: u32,
    pub muscle: ExerciseMuscle,
}

#[skip_serializing_none]
#[derive(
    Debug, SimpleObject, Serialize, Deserialize, FromJsonQueryResult, Clone, Eq, PartialEq,
)]
pub struct FitnessAnalyticsEquipment {
    pub count: u32,
    pub equipment: ExerciseEquipment,
}

#[skip_serializing_none]
#[derive(
    Debug, SimpleObject, Serialize, Deserialize, FromJsonQueryResult, Clone, Eq, PartialEq,
)]
pub struct UserFitnessAnalytics {
    pub workout_reps: i32,
    pub workout_weight: i32,
    pub workout_count: i32,
    pub workout_distance: i32,
    pub workout_duration: i32,
    pub workout_rest_time: i32,
    pub measurement_count: i32,
    pub workout_personal_bests: i32,
    pub workout_muscles: Vec<FitnessAnalyticsMuscle>,
    pub workout_exercises: Vec<FitnessAnalyticsExercise>,
    pub workout_equipments: Vec<FitnessAnalyticsEquipment>,
}

#[skip_serializing_none]
#[derive(
    Debug, SimpleObject, Serialize, Deserialize, FromJsonQueryResult, Clone, Eq, PartialEq,
)]
pub struct UserAnalytics {
    pub fitness: UserFitnessAnalytics,
    pub activities: DailyUserActivitiesResponse,
    pub hours: Vec<DailyUserActivityHourRecord>,
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize, Clone)]
pub struct TmdbLanguage {
    pub iso_639_1: String,
    pub english_name: String,
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize, Clone)]
pub struct TmdbSettings {
    pub image_url: String,
    pub languages: Vec<TmdbLanguage>,
}

#[derive(Clone, Debug, PartialEq, InputObject, FromJsonQueryResult, Eq, Serialize, Deserialize)]
pub struct MetadataGroupSearchInput {
    pub lot: MediaLot,
    pub source: MediaSource,
    pub search: SearchInput,
}

#[skip_serializing_none]
#[derive(
    Debug,
    Serialize,
    Deserialize,
    InputObject,
    Clone,
    SimpleObject,
    FromJsonQueryResult,
    Eq,
    PartialEq,
    Hash,
    Default,
    Schematic,
)]
#[graphql(input_name = "PersonSourceSpecificsInput")]
#[serde(rename_all = "snake_case")]
pub struct PersonSourceSpecifics {
    pub is_tmdb_company: Option<bool>,
    pub is_anilist_studio: Option<bool>,
}

#[derive(Clone, Debug, PartialEq, InputObject, FromJsonQueryResult, Eq, Serialize, Deserialize)]
pub struct PeopleSearchInput {
    pub search: SearchInput,
    pub source: MediaSource,
    pub source_specifics: Option<PersonSourceSpecifics>,
}

#[derive(Clone, Debug, PartialEq, InputObject, FromJsonQueryResult, Eq, Serialize, Deserialize)]
pub struct MetadataSearchInput {
    pub search: SearchInput,
    pub lot: MediaLot,
    pub source: MediaSource,
}

#[skip_serializing_none]
#[derive(Clone, Debug, PartialEq, FromJsonQueryResult, Eq, Serialize, Deserialize)]
pub enum ApplicationCacheKey {
    IgdbSettings,
    TmdbSettings,
    ListennotesSettings,
    ServerKeyValidated,
    UserAnalyticsParameters {
        user_id: String,
    },
    UserAnalytics {
        user_id: String,
        input: UserAnalyticsInput,
    },
    MetadataRecentlyConsumed {
        user_id: String,
        entity_id: String,
        entity_lot: EntityLot,
    },
    ProgressUpdateCache {
        user_id: String,
        metadata_id: String,
        show_season_number: Option<i32>,
        show_episode_number: Option<i32>,
        podcast_episode_number: Option<i32>,
        anime_episode_number: Option<i32>,
        manga_chapter_number: Option<Decimal>,
        manga_volume_number: Option<i32>,
    },
}

#[skip_serializing_none]
#[derive(Clone, Debug, PartialEq, FromJsonQueryResult, Serialize, Deserialize, Eq)]
pub enum ApplicationCacheValue {
    Empty,
    TmdbSettings(TmdbSettings),
    UserAnalytics(UserAnalytics),
    IgdbSettings { access_token: String },
    UserAnalyticsParameters(ApplicationDateRange),
    ListennotesSettings { genres: HashMap<i32, String> },
}
