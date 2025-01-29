use async_graphql::{Enum, InputObject, SimpleObject};
use chrono::NaiveDate;
use educe::Educe;
use enum_meta::{meta, Meta};
use enum_models::{EntityLot, MediaLot, MediaSource};
use rust_decimal::Decimal;
use schematic::{ConfigEnum, Schematic};
use sea_orm::{prelude::DateTimeUtc, FromJsonQueryResult};
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

#[derive(Debug, Default, PartialEq, Eq, Clone, Copy, Serialize, Deserialize, Enum, ConfigEnum)]
pub enum CollectionExtraInformationLot {
    Date,
    Number,
    #[default]
    String,
    DateTime,
    StringArray,
}

#[derive(
    Eq,
    Clone,
    Debug,
    Default,
    PartialEq,
    Serialize,
    Schematic,
    Deserialize,
    SimpleObject,
    InputObject,
    FromJsonQueryResult,
)]
#[graphql(input_name = "CollectionExtraInformationInput")]
pub struct CollectionExtraInformation {
    pub name: String,
    pub description: String,
    pub required: Option<bool>,
    pub default_value: Option<String>,
    pub lot: CollectionExtraInformationLot,
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
                lot: CollectionExtraInformationLot::Date,
                description: "When did you get this media?".to_string(),
                ..Default::default()
            }
        ]
    ), "Items that I have in my inventory.");
    Reminders, (Some(
        vec![
            CollectionExtraInformation {
                name: "Reminder".to_string(),
                required: Some(true),
                lot: CollectionExtraInformationLot::Date,
                description: "When do you want to be reminded?".to_string(),
                ..Default::default()
            },
            CollectionExtraInformation {
                name: "Text".to_string(),
                required: Some(true),
                lot: CollectionExtraInformationLot::String,
                description: "What do you want to be reminded about?".to_string(),
                ..Default::default()
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
    Eq,
    Clone,
    Hash,
    Debug,
    Default,
    PartialEq,
    Serialize,
    Deserialize,
    InputObject,
    FromJsonQueryResult,
)]
pub struct SearchInput {
    pub take: Option<u64>,
    pub page: Option<i32>,
    pub query: Option<String>,
}

#[derive(PartialEq, Eq, Serialize, Deserialize, Debug, SimpleObject, Clone, Default)]
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
pub enum UserNotificationContent {
    ReviewPosted,
    MetadataPublished,
    NewWorkoutCreated,
    OutdatedSeenEntries,
    MetadataStatusChanged,
    MetadataEpisodeReleased,
    PersonMetadataAssociated,
    MetadataReleaseDateChanged,
    MetadataEpisodeNameChanged,
    MetadataEpisodeImagesChanged,
    PersonMetadataGroupAssociated,
    MetadataNumberOfSeasonsChanged,
    MetadataChaptersOrEpisodesChanged,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct ExportJob {
    pub size: i64,
    pub url: String,
    pub key: String,
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
    Debug, Hash, Default, Serialize, Deserialize, SimpleObject, InputObject, Clone, Eq, PartialEq,
)]
#[graphql(input_name = "ApplicationDateRangeInput")]
pub struct ApplicationDateRange {
    pub end_date: Option<NaiveDate>,
    pub start_date: Option<NaiveDate>,
}

#[derive(Debug, Hash, Serialize, Deserialize, Enum, Clone, Copy, Eq, PartialEq, Display)]
#[strum(serialize_all = "snake_case")]
pub enum DailyUserActivitiesResponseGroupedBy {
    Day,
    Year,
    Month,
    AllTime,
}

#[skip_serializing_none]
#[derive(Debug, Hash, Default, Serialize, Deserialize, InputObject, Clone, PartialEq, Eq)]
pub struct UserAnalyticsInput {
    pub date_range: ApplicationDateRange,
    pub group_by: Option<DailyUserActivitiesResponseGroupedBy>,
}

#[skip_serializing_none]
#[derive(
    Clone, Hash, Debug, PartialEq, InputObject, FromJsonQueryResult, Eq, Serialize, Deserialize,
)]
pub struct MetadataGroupSearchInput {
    pub lot: MediaLot,
    pub source: MediaSource,
    pub search: SearchInput,
}

#[skip_serializing_none]
#[derive(
    Eq,
    Hash,
    Clone,
    Debug,
    Default,
    Schematic,
    PartialEq,
    Serialize,
    Deserialize,
    InputObject,
    SimpleObject,
    FromJsonQueryResult,
)]
#[graphql(input_name = "PersonSourceSpecificsInput")]
#[serde(rename_all = "snake_case")]
pub struct PersonSourceSpecifics {
    pub is_tmdb_company: Option<bool>,
    pub is_anilist_studio: Option<bool>,
    pub is_hardcover_publisher: Option<bool>,
}

#[skip_serializing_none]
#[derive(
    Clone, Hash, Debug, PartialEq, InputObject, FromJsonQueryResult, Eq, Serialize, Deserialize,
)]
pub struct PeopleSearchInput {
    pub search: SearchInput,
    pub source: MediaSource,
    pub source_specifics: Option<PersonSourceSpecifics>,
}

#[skip_serializing_none]
#[derive(
    Clone, Hash, Debug, PartialEq, InputObject, FromJsonQueryResult, Eq, Serialize, Deserialize,
)]
pub struct MetadataSearchInput {
    pub lot: MediaLot,
    pub search: SearchInput,
    pub source: MediaSource,
}

#[skip_serializing_none]
#[derive(Clone, Hash, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct UserLevelCacheKey<T> {
    pub input: T,
    pub user_id: String,
}

#[skip_serializing_none]
#[derive(Clone, Hash, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MetadataRecentlyConsumedCacheInput {
    pub entity_id: String,
    pub entity_lot: EntityLot,
}

#[skip_serializing_none]
#[derive(Clone, Hash, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProgressUpdateCacheInput {
    pub metadata_id: String,
    pub show_season_number: Option<i32>,
    pub manga_volume_number: Option<i32>,
    pub show_episode_number: Option<i32>,
    pub anime_episode_number: Option<i32>,
    pub provider_watched_on: Option<String>,
    pub podcast_episode_number: Option<i32>,
    pub manga_chapter_number: Option<Decimal>,
}

#[skip_serializing_none]
#[derive(Clone, Hash, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct YoutubeMusicSongListened {
    pub id: String,
    pub listened_on: NaiveDate,
}
