use async_graphql::{Enum, InputObject, OneofObject, SimpleObject, Union};
use chrono::NaiveDate;
use common_models::{ApplicationDateRange, StringIdObject};
use enum_models::{EntityLot, MediaLot, SeenState, UserNotificationContent, Visibility};
use rust_decimal::Decimal;
use sea_orm::{prelude::DateTimeUtc, strum::Display};
use serde::{Deserialize, Serialize};

// Import structures from other modules that are referenced
use crate::{SeenAnimeExtraInformation, SeenPodcastExtraInformation, SeenShowExtraInformation};

#[derive(Debug, InputObject, Default)]
pub struct CreateOrUpdateReviewInput {
    pub entity_id: String,
    pub text: Option<String>,
    pub entity_lot: EntityLot,
    pub rating: Option<Decimal>,
    pub is_spoiler: Option<bool>,
    /// ID of the review if this is an update to an existing review
    pub review_id: Option<String>,
    pub date: Option<DateTimeUtc>,
    pub visibility: Option<Visibility>,
    pub show_season_number: Option<i32>,
    pub show_episode_number: Option<i32>,
    pub manga_volume_number: Option<i32>,
    pub anime_episode_number: Option<i32>,
    pub podcast_episode_number: Option<i32>,
    pub manga_chapter_number: Option<Decimal>,
}

#[derive(InputObject, Debug, Default, Serialize, Deserialize, Clone)]
pub struct MetadataProgressUpdateCommonInput {
    pub show_season_number: Option<i32>,
    pub show_episode_number: Option<i32>,
    pub manga_volume_number: Option<i32>,
    pub anime_episode_number: Option<i32>,
    pub podcast_episode_number: Option<i32>,
    pub provider_watched_on: Option<String>,
    pub manga_chapter_number: Option<Decimal>,
}

#[derive(InputObject, Debug, Default, Serialize, Deserialize, Clone)]
pub struct MetadataProgressUpdateFinishedOnDateInput {
    pub finished_on: DateTimeUtc,
    #[graphql(flatten)]
    pub common: MetadataProgressUpdateCommonInput,
}

#[derive(InputObject, Debug, Default, Serialize, Deserialize, Clone)]
pub struct MetadataProgressUpdateStartedAndFinishedOnDateInput {
    pub started_on: DateTimeUtc,
    #[graphql(flatten)]
    pub data: MetadataProgressUpdateFinishedOnDateInput,
}

#[derive(OneofObject, Debug, Deserialize, Serialize, Display, Clone)]
pub enum MetadataProgressUpdateChangeLatestInProgressInput {
    State(SeenState),
    Progress(Decimal),
}

#[derive(OneofObject, Debug, Deserialize, Serialize, Display, Clone)]
pub enum MetadataProgressUpdateChangeCreateNewCompletedInput {
    WithoutDates(MetadataProgressUpdateCommonInput),
    FinishedOnDate(MetadataProgressUpdateFinishedOnDateInput),
    StartedAndFinishedOnDate(MetadataProgressUpdateStartedAndFinishedOnDateInput),
}

#[derive(InputObject, Debug, Default, Serialize, Deserialize, Clone)]
pub struct MetadataProgressUpdateNewInProgressInput {
    pub started_on: DateTimeUtc,
    #[graphql(flatten)]
    pub data: MetadataProgressUpdateCommonInput,
}

#[derive(OneofObject, Debug, Deserialize, Serialize, Display, Clone)]
pub enum MetadataProgressUpdateChange {
    CreateNewInProgress(MetadataProgressUpdateNewInProgressInput),
    CreateNewCompleted(MetadataProgressUpdateChangeCreateNewCompletedInput),
    ChangeLatestInProgress(MetadataProgressUpdateChangeLatestInProgressInput),
}

#[derive(InputObject, Debug, Deserialize, Serialize, Clone)]
pub struct MetadataProgressUpdateInput {
    pub metadata_id: String,
    pub change: MetadataProgressUpdateChange,
}

// FIXME: remove this after migration to `metadata_progress_update` is complete
#[derive(Debug, Default, Serialize, Deserialize, InputObject, Clone)]
pub struct ProgressUpdateInput {
    pub metadata_id: String,
    pub date: Option<NaiveDate>,
    pub progress: Option<Decimal>,
    #[graphql(skip_input)]
    pub start_date: Option<NaiveDate>,
    pub change_state: Option<SeenState>,
    pub show_season_number: Option<i32>,
    pub show_episode_number: Option<i32>,
    pub manga_volume_number: Option<i32>,
    pub anime_episode_number: Option<i32>,
    pub podcast_episode_number: Option<i32>,
    pub provider_watched_on: Option<String>,
    pub manga_chapter_number: Option<Decimal>,
}

#[derive(Enum, Clone, Debug, Copy, PartialEq, Eq)]
pub enum ProgressUpdateErrorVariant {
    AlreadySeen,
    NoSeenInProgress,
    UpdateWithoutProgressUpdate,
}

#[derive(Debug, SimpleObject)]
pub struct ProgressUpdateError {
    pub error: ProgressUpdateErrorVariant,
}

// FIXME: remove this after migration to `metadata_progress_update` is complete
#[derive(Union)]
pub enum ProgressUpdateResultUnion {
    Ok(StringIdObject),
    Error(ProgressUpdateError),
}

#[derive(Debug, InputObject)]
pub struct GenreDetailsInput {
    pub genre_id: String,
    pub page: Option<u64>,
}

#[derive(Debug, Serialize, Hash, Deserialize, Enum, Clone, PartialEq, Eq, Copy, Default)]
pub enum GraphqlSortOrder {
    #[default]
    Asc,
    Desc,
}

#[derive(Debug, Hash, Serialize, Deserialize, Enum, Clone, PartialEq, Eq, Copy, Default)]
pub enum MediaSortBy {
    Title,
    Random,
    LastSeen,
    UserRating,
    #[default]
    ReleaseDate,
    LastUpdated,
    TimesConsumed,
    ProviderRating,
}

#[derive(Debug, Hash, Serialize, Deserialize, Enum, Clone, PartialEq, Eq, Copy, Default)]
pub enum PersonAndMetadataGroupsSortBy {
    #[default]
    Name,
    Random,
    AssociatedEntityCount,
}

#[derive(Debug, Hash, Serialize, Deserialize, Enum, Clone, Copy, Eq, PartialEq, Default)]
pub enum MediaGeneralFilter {
    #[default]
    All,
    Rated,
    Unrated,
    Dropped,
    OnAHold,
    Unfinished,
}

#[derive(Debug, Hash, Serialize, Deserialize, Enum, Clone, Copy, Eq, PartialEq, Default)]
pub enum MediaCollectionPresenceFilter {
    #[default]
    PresentIn,
    NotPresentIn,
}

#[derive(Debug, Hash, PartialEq, Eq, Serialize, Deserialize, InputObject, Clone, Default)]
pub struct MediaCollectionFilter {
    pub collection_id: String,
    pub presence: MediaCollectionPresenceFilter,
}

#[derive(Debug, Hash, PartialEq, Eq, Serialize, Deserialize, InputObject, Clone, Default)]
pub struct MediaFilter {
    pub general: Option<MediaGeneralFilter>,
    pub date_range: Option<ApplicationDateRange>,
    pub collections: Option<Vec<MediaCollectionFilter>>,
}

#[derive(SimpleObject, Debug)]
pub struct UserMetadataDetailsEpisodeProgress {
    pub times_seen: usize,
    pub episode_number: i32,
}

#[derive(SimpleObject, Debug)]
pub struct UserMetadataDetailsShowSeasonProgress {
    pub times_seen: usize,
    pub season_number: i32,
    pub episodes: Vec<UserMetadataDetailsEpisodeProgress>,
}

#[derive(SimpleObject, Debug, Clone, Default)]
pub struct UserMediaNextEntry {
    pub season: Option<i32>,
    pub volume: Option<i32>,
    pub chapter: Option<Decimal>,
    pub episode: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct UpdateSeenItemInput {
    pub seen_id: String,
    pub review_id: Option<String>,
    pub started_on: Option<DateTimeUtc>,
    pub finished_on: Option<DateTimeUtc>,
    pub manual_time_spent: Option<Decimal>,
    pub provider_watched_on: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct MarkEntityAsPartialInput {
    pub entity_id: String,
    pub entity_lot: EntityLot,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct PresignedPutUrlResponse {
    pub upload_url: String,
    pub key: String,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct CreateReviewCommentInput {
    /// The review this comment belongs to.
    pub review_id: String,
    pub comment_id: Option<String>,
    pub text: Option<String>,
    pub increment_likes: Option<bool>,
    pub decrement_likes: Option<bool>,
    pub should_delete: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone, Default)]
pub struct GraphqlCalendarEvent {
    pub date: NaiveDate,
    pub metadata_id: String,
    pub metadata_text: String,
    pub metadata_lot: MediaLot,
    pub calendar_event_id: String,
    pub metadata_image: Option<String>,
    pub show_extra_information: Option<SeenShowExtraInformation>,
    pub anime_extra_information: Option<SeenAnimeExtraInformation>,
    pub podcast_extra_information: Option<SeenPodcastExtraInformation>,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone, Default)]
pub struct UserCalendarEventInput {
    pub year: i32,
    pub month: u32,
}

#[derive(Debug, Serialize, Deserialize, OneofObject, Clone)]
pub enum UserUpcomingCalendarEventInput {
    /// The number of media to select
    NextMedia(u64),
    /// The number of days to select
    NextDays(u64),
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct PresignedPutUrlInput {
    pub prefix: String,
    pub file_name: String,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone, Default)]
pub struct GroupedCalendarEvent {
    pub events: Vec<GraphqlCalendarEvent>,
    pub date: NaiveDate,
}

#[derive(Debug, Default)]
pub struct UpdateMediaEntityResult {
    pub notifications: Vec<(String, UserNotificationContent)>,
}
