use async_graphql::{Enum, InputObject, OneofObject, SimpleObject};
use chrono::NaiveDate;
use common_models::{ApplicationDateRange, SearchInput};
use enum_models::{EntityLot, MediaSource, SeenState, UserNotificationContent, Visibility};
use rust_decimal::Decimal;
use sea_orm::{prelude::DateTimeUtc, strum::Display};
use serde::{Deserialize, Serialize};
use serde_with::skip_serializing_none;

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

#[skip_serializing_none]
#[derive(InputObject, Debug, Default, Serialize, Deserialize, Clone, Eq, PartialEq, Hash)]
pub struct MetadataProgressUpdateCommonInput {
    pub show_season_number: Option<i32>,
    pub show_episode_number: Option<i32>,
    pub manga_volume_number: Option<i32>,
    pub anime_episode_number: Option<i32>,
    pub manual_time_spent: Option<Decimal>,
    pub podcast_episode_number: Option<i32>,
    pub manga_chapter_number: Option<Decimal>,
    pub providers_consumed_on: Option<Vec<String>>,
}

#[derive(InputObject, Debug, Default, Serialize, Deserialize, Clone)]
pub struct MetadataProgressUpdateStartedOrFinishedOnDateInput {
    pub timestamp: DateTimeUtc,
    #[graphql(flatten)]
    pub common: MetadataProgressUpdateCommonInput,
}

#[derive(InputObject, Debug, Default, Serialize, Deserialize, Clone)]
pub struct MetadataProgressUpdateStartedAndFinishedOnDateInput {
    pub started_on: DateTimeUtc,
    #[graphql(flatten)]
    pub data: MetadataProgressUpdateStartedOrFinishedOnDateInput,
}

#[derive(OneofObject, Debug, Deserialize, Serialize, Display, Clone)]
pub enum MetadataProgressUpdateChangeCreateNewCompletedInput {
    WithoutDates(MetadataProgressUpdateCommonInput),
    StartedOnDate(MetadataProgressUpdateStartedOrFinishedOnDateInput),
    FinishedOnDate(MetadataProgressUpdateStartedOrFinishedOnDateInput),
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
    ChangeLatestState(SeenState),
    ChangeLatestInProgress(Decimal),
    CreateNewInProgress(MetadataProgressUpdateNewInProgressInput),
    CreateNewCompleted(MetadataProgressUpdateChangeCreateNewCompletedInput),
}

#[derive(InputObject, Debug, Deserialize, Serialize, Clone)]
pub struct MetadataProgressUpdateInput {
    pub metadata_id: String,
    pub change: MetadataProgressUpdateChange,
}

#[derive(InputObject, Debug, Deserialize, Serialize, Clone, Eq, PartialEq, Hash)]
pub struct MetadataProgressUpdateCacheInput {
    pub metadata_id: String,
    pub common: MetadataProgressUpdateCommonInput,
}

#[skip_serializing_none]
#[derive(Debug, Clone, Hash, Serialize, Deserialize, PartialEq, Eq, InputObject)]
pub struct GenreDetailsInput {
    pub genre_id: String,
    pub search: Option<SearchInput>,
}

/// Sort order direction for ordering query results.
#[derive(Debug, Serialize, Hash, Deserialize, Enum, Clone, PartialEq, Eq, Copy, Default)]
pub enum GraphqlSortOrder {
    /// Ascending order (A to Z, 0 to 9, oldest to newest). Default behavior.
    #[default]
    Asc,
    /// Descending order (Z to A, 9 to 0, newest to oldest).
    Desc,
}

#[derive(Debug, Hash, Serialize, Deserialize, Enum, Clone, PartialEq, Eq, Copy, Default)]
pub enum MediaSortBy {
    Title,
    Random,
    UserRating,
    #[default]
    ReleaseDate,
    LastUpdated,
    LastConsumed,
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

/// General status filters for metadata (media) items.
#[derive(Debug, Hash, Serialize, Deserialize, Enum, Clone, Copy, Eq, PartialEq, Default)]
pub enum MediaGeneralFilter {
    /// Show all items regardless of status. Default behavior.
    #[default]
    All,
    /// Show only items that have been rated by the user.
    Rated,
    /// Show only items that have not been rated by the user.
    Unrated,
    /// Show only items marked as dropped by the user.
    Dropped,
    /// Show only items marked as on hold by the user.
    OnAHold,
    /// Show only items that are unfinished (started but not completed).
    Unfinished,
}

/// Strategy for combining multiple collection filters.
/// Determines how to interpret multiple MediaCollectionFilter entries.
#[derive(Debug, Hash, Serialize, Deserialize, Enum, Clone, Copy, Eq, PartialEq, Default)]
pub enum MediaCollectionStrategyFilter {
    /// Match items present in ANY of the specified collections (union).
    Or,
    /// Match items present in ALL of the specified collections (intersection). Default behavior.
    #[default]
    And,
}

/// Filter based on whether items are present in or absent from a collection.
#[derive(Debug, Hash, Serialize, Deserialize, Enum, Clone, Copy, Eq, PartialEq, Default)]
pub enum MediaCollectionPresenceFilter {
    /// Match items that ARE present in the specified collection. Default behavior.
    #[default]
    PresentIn,
    /// Match items that are NOT present in the specified collection.
    NotPresentIn,
}

/// Filter for finding items based on their presence in another collection.
/// Can be used to create complex queries like "items in collection A but not in collection B".
#[derive(Debug, Hash, PartialEq, Eq, Serialize, Deserialize, InputObject, Clone, Default)]
pub struct MediaCollectionFilter {
    /// The unique identifier of the collection to check against.
    pub collection_id: String,
    /// How to combine this filter with other collection filters (AND/OR). Defaults to AND.
    pub strategy: MediaCollectionStrategyFilter,
    /// Whether to match items present in or absent from this collection. Defaults to PresentIn.
    pub presence: MediaCollectionPresenceFilter,
}

#[skip_serializing_none]
#[derive(Debug, Hash, PartialEq, Eq, Serialize, Deserialize, InputObject, Clone, Default)]
pub struct MediaFilter {
    pub source: Option<MediaSource>,
    pub general: Option<MediaGeneralFilter>,
    pub date_range: Option<ApplicationDateRange>,
    pub collections: Option<Vec<MediaCollectionFilter>>,
}

#[derive(Clone, SimpleObject, Debug, PartialEq, Serialize, Deserialize, Eq)]
pub struct UserMetadataDetailsEpisodeProgress {
    pub times_seen: usize,
    pub episode_number: i32,
}

#[derive(Clone, SimpleObject, Debug, PartialEq, Serialize, Deserialize, Eq)]
pub struct UserMetadataDetailsShowSeasonProgress {
    pub times_seen: usize,
    pub season_number: i32,
    pub episodes: Vec<UserMetadataDetailsEpisodeProgress>,
}

#[skip_serializing_none]
#[derive(Clone, SimpleObject, Default, Debug, PartialEq, Serialize, Deserialize, Eq)]
pub struct UserMediaNextEntry {
    pub season: Option<i32>,
    pub volume: Option<i32>,
    pub episode: Option<i32>,
    pub chapter: Option<Decimal>,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct UpdateSeenItemInput {
    pub seen_id: String,
    pub review_id: Option<String>,
    pub started_on: Option<DateTimeUtc>,
    pub finished_on: Option<DateTimeUtc>,
    #[graphql(flatten)]
    pub common: MetadataProgressUpdateCommonInput,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct CreateReviewCommentInput {
    /// The review this comment belongs to.
    pub review_id: String,
    pub text: Option<String>,
    pub comment_id: Option<String>,
    pub should_delete: Option<bool>,
    pub increment_likes: Option<bool>,
    pub decrement_likes: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone, Default)]
pub struct GraphqlCalendarEvent {
    pub date: NaiveDate,
    pub metadata_id: String,
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
    /// The number of days to select
    NextDays(u64),
    /// The number of media to select
    NextMedia(u64),
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone, Default)]
pub struct GroupedCalendarEvent {
    pub date: NaiveDate,
    pub events: Vec<GraphqlCalendarEvent>,
}

#[derive(Debug, Default)]
pub struct UpdateMediaEntityResult {
    pub notifications: Vec<UserNotificationContent>,
}
