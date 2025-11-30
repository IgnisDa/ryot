use std::collections::HashMap;

use common_models::{
    ApplicationDateRange, EntityRecentlyConsumedCacheInput, FilterPresetQueryInput,
    MetadataGroupSearchInput, MetadataLookupCacheInput, PeopleSearchInput, UserAnalyticsInput,
    UserLevelCacheKey, YoutubeMusicSongListened,
};
use database_models::entity_translation;
use fitness_models::{UserExercisesListInput, UserMeasurementsListInput};
use media_models::{
    EntityTranslationInput, GenreDetailsInput, GraphqlMetadataDetails, MetadataLookupResponse,
    MetadataProgressUpdateCacheInput, TmdbMetadataLookupResult,
};
use sea_orm::FromJsonQueryResult;
use serde::{Deserialize, Serialize};
use serde_with::skip_serializing_none;
use strum::{Display, EnumDiscriminants};
use uuid::Uuid;

use crate::{
    GenreDetails, GraphqlPersonDetails, MetadataGroupDetails, UserMetadataDetails,
    UserMetadataGroupDetails, UserPersonDetails, UserWorkoutDetails, UserWorkoutTemplateDetails,
    analytics::UserAnalytics,
    core_systems::{CoreDetails, TmdbSettings, TvdbSettings},
    generic_types::{
        CollectionContentsInput, CollectionContentsResponse, CollectionRecommendationsResponse,
        FilterPresetsListResponse, MetadataGroupSearchResponse, MetadataSearchResponse,
        PeopleSearchResponse, UserCollectionsListResponse, UserExercisesListResponse,
        UserMeasurementsListResponse, UserMetadataGroupsListInput, UserMetadataGroupsListResponse,
        UserMetadataListInput, UserMetadataListResponse, UserMetadataRecommendationsResponse,
        UserPeopleListInput, UserPeopleListResponse, UserTemplatesOrWorkoutsListInput,
        UserWorkoutsListResponse, UserWorkoutsTemplatesListResponse,
    },
    search::MetadataSearchInput,
};

#[derive(Debug, Default, PartialEq, Eq, Serialize, Deserialize, Clone)]
pub struct EmptyCacheValue {
    pub _empty: (),
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Eq)]
pub struct UserTwoFactorSetupCacheValue {
    pub secret: String,
}
#[skip_serializing_none]
#[derive(Clone, Hash, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct UserSessionValue {
    pub user_id: String,
    pub access_link_id: Option<String>,
}

#[derive(Clone, Hash, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct UserPasswordChangeSessionValue {
    pub user_id: String,
}

#[derive(
    Eq,
    Hash,
    Debug,
    Clone,
    Display,
    PartialEq,
    Serialize,
    Deserialize,
    EnumDiscriminants,
    FromJsonQueryResult,
)]
#[strum_discriminants(derive(Display))]
pub enum ApplicationCacheKey {
    CoreDetails,
    IgdbSettings,
    TmdbSettings,
    TvdbSettings,
    SpotifyAccessToken,
    ListennotesSettings,
    UserSession(String),
    TrendingMetadataIds,
    PersonDetails(String),
    MetadataDetails(String),
    LogDownloadToken(String),
    MetadataGroupDetails(String),
    UserPasswordChangeSession(String),
    CollectionRecommendations(String),
    MetadataLookup(MetadataLookupCacheInput),
    TmdbMultiSearch(MetadataLookupCacheInput),
    UserTwoFactorSetup(UserLevelCacheKey<()>),
    UserCollectionsList(UserLevelCacheKey<()>),
    UserPersonDetails(UserLevelCacheKey<String>),
    UserTwoFactorRateLimit(UserLevelCacheKey<()>),
    UserWorkoutDetails(UserLevelCacheKey<String>),
    UserAnalyticsParameters(UserLevelCacheKey<()>),
    UserMetadataDetails(UserLevelCacheKey<String>),
    GenreDetails(UserLevelCacheKey<GenreDetailsInput>),
    UserMetadataRecommendations(UserLevelCacheKey<()>),
    PeopleSearch(UserLevelCacheKey<PeopleSearchInput>),
    UserMetadataGroupDetails(UserLevelCacheKey<String>),
    UserAnalytics(UserLevelCacheKey<UserAnalyticsInput>),
    UserWorkoutTemplateDetails(UserLevelCacheKey<String>),
    UserMetadataRecommendationsSet(UserLevelCacheKey<()>),
    MetadataSearch(UserLevelCacheKey<MetadataSearchInput>),
    UserPeopleList(UserLevelCacheKey<UserPeopleListInput>),
    UserMetadataList(UserLevelCacheKey<UserMetadataListInput>),
    UserExercisesList(UserLevelCacheKey<UserExercisesListInput>),
    UserFilterPresets(UserLevelCacheKey<FilterPresetQueryInput>),
    MetadataGroupSearch(UserLevelCacheKey<MetadataGroupSearchInput>),
    UserCollectionContents(UserLevelCacheKey<CollectionContentsInput>),
    UserMeasurementsList(UserLevelCacheKey<UserMeasurementsListInput>),
    YoutubeMusicSongListened(UserLevelCacheKey<YoutubeMusicSongListened>),
    UserWorkoutsList(UserLevelCacheKey<UserTemplatesOrWorkoutsListInput>),
    UserMetadataGroupsList(UserLevelCacheKey<UserMetadataGroupsListInput>),
    EntityTranslationDetails(UserLevelCacheKey<EntityTranslationInput>),
    EntityRecentlyConsumed(UserLevelCacheKey<EntityRecentlyConsumedCacheInput>),
    UserWorkoutTemplatesList(UserLevelCacheKey<UserTemplatesOrWorkoutsListInput>),
    MetadataProgressUpdateCompletedCache(UserLevelCacheKey<MetadataProgressUpdateCacheInput>),
    MetadataProgressUpdateInProgressCache(UserLevelCacheKey<MetadataProgressUpdateCacheInput>),
}

pub type IgdbSettings = String;
pub type SpotifyAccessToken = String;
pub type YoutubeMusicSongListenedResponse = bool;
pub type ApplicationRecommendations = Vec<String>;
pub type TrendingMetadataIdsResponse = Vec<String>;
pub type ListennotesSettings = HashMap<i32, String>;
pub type EntityTranslationDetailsResponse = Vec<entity_translation::Model>;

#[derive(Clone, Debug, PartialEq, FromJsonQueryResult, Serialize, Deserialize, Eq)]
pub enum ApplicationCacheValue {
    TmdbSettings(TmdbSettings),
    TvdbSettings(TvdbSettings),
    GenreDetails(GenreDetails),
    IgdbSettings(IgdbSettings),
    UserAnalytics(UserAnalytics),
    CoreDetails(Box<CoreDetails>),
    UserSession(UserSessionValue),
    LogDownloadToken(EmptyCacheValue),
    PeopleSearch(PeopleSearchResponse),
    SpotifyAccessToken(SpotifyAccessToken),
    MetadataLookup(MetadataLookupResponse),
    MetadataSearch(MetadataSearchResponse),
    UserPeopleList(UserPeopleListResponse),
    EntityRecentlyConsumed(EmptyCacheValue),
    UserTwoFactorRateLimit(EmptyCacheValue),
    PersonDetails(Box<GraphqlPersonDetails>),
    ListennotesSettings(ListennotesSettings),
    UserPersonDetails(Box<UserPersonDetails>),
    UserWorkoutsList(UserWorkoutsListResponse),
    UserMetadataList(UserMetadataListResponse),
    UserWorkoutDetails(Box<UserWorkoutDetails>),
    MetadataDetails(Box<GraphqlMetadataDetails>),
    UserExercisesList(UserExercisesListResponse),
    UserFilterPresets(FilterPresetsListResponse),
    UserAnalyticsParameters(ApplicationDateRange),
    UserMetadataDetails(Box<UserMetadataDetails>),
    TmdbMultiSearch(Vec<TmdbMetadataLookupResult>),
    MetadataGroupDetails(Box<MetadataGroupDetails>),
    UserTwoFactorSetup(UserTwoFactorSetupCacheValue),
    TrendingMetadataIds(TrendingMetadataIdsResponse),
    UserCollectionsList(UserCollectionsListResponse),
    MetadataGroupSearch(MetadataGroupSearchResponse),
    UserMeasurementsList(UserMeasurementsListResponse),
    MetadataProgressUpdateCompletedCache(EmptyCacheValue),
    MetadataProgressUpdateInProgressCache(EmptyCacheValue),
    UserMetadataGroupsList(UserMetadataGroupsListResponse),
    UserCollectionContents(Box<CollectionContentsResponse>),
    UserMetadataGroupDetails(Box<UserMetadataGroupDetails>),
    UserPasswordChangeSession(UserPasswordChangeSessionValue),
    EntityTranslationDetails(EntityTranslationDetailsResponse),
    YoutubeMusicSongListened(YoutubeMusicSongListenedResponse),
    UserMetadataRecommendationsSet(ApplicationRecommendations),
    UserWorkoutTemplateDetails(Box<UserWorkoutTemplateDetails>),
    UserWorkoutTemplatesList(UserWorkoutsTemplatesListResponse),
    CollectionRecommendations(CollectionRecommendationsResponse),
    UserMetadataRecommendations(UserMetadataRecommendationsResponse),
}

pub struct GetCacheKeyResponse {
    pub id: Uuid,
    pub value: ApplicationCacheValue,
}

#[derive(Debug, Clone)]
pub enum ExpireCacheKeyInput {
    ById(Uuid),
    ByUser(String),
    ByKey(Box<ApplicationCacheKey>),
    BySanitizedKey {
        user_id: Option<String>,
        key: ApplicationCacheKeyDiscriminants,
    },
}
