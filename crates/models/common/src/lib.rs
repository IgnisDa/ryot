use async_graphql::{Enum, InputObject, SimpleObject};
use educe::Educe;
use enum_meta::{meta, Meta};
use enums::{EntityLot, MediaLot};
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
    pub entity_id: String,
    pub entity_lot: EntityLot,
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
#[derive(Clone, Debug, PartialEq, FromJsonQueryResult, Eq, Serialize, Deserialize)]
pub enum ApplicationCacheKey {
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

#[derive(
    Debug, PartialEq, Eq, Serialize, Deserialize, Clone, SimpleObject, FromJsonQueryResult,
)]
pub struct DailyUserActivityHourRecordEntity {
    pub entity_id: String,
    pub entity_lot: EntityLot,
    pub metadata_lot: Option<MediaLot>,
}

#[derive(
    Debug, PartialEq, Eq, Serialize, Deserialize, Clone, SimpleObject, FromJsonQueryResult,
)]
pub struct DailyUserActivityHourRecord {
    // DEV: The hour in UTC time
    pub hour: u32,
    pub entities: Vec<DailyUserActivityHourRecordEntity>,
}
