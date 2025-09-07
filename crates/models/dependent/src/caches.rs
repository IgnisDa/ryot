use std::collections::HashMap;

use common_models::{
    ApplicationDateRange, MetadataGroupSearchInput, MetadataLookupCacheInput,
    MetadataRecentlyConsumedCacheInput, PeopleSearchInput, UserAnalyticsInput, UserLevelCacheKey,
    YoutubeMusicSongListened,
};
use fitness_models::{UserExercisesListInput, UserMeasurementsListInput};
use media_models::{
    GenreDetailsInput, GraphqlMetadataDetails, MetadataLookupResponse,
    MetadataProgressUpdateCacheInput,
};
use sea_orm::FromJsonQueryResult;
use serde::{Deserialize, Serialize};
use serde_with::skip_serializing_none;
use strum::{Display, EnumDiscriminants};
use uuid::Uuid;

use crate::{
    GenreDetails, GraphqlPersonDetails, MetadataGroupDetails, UserPersonDetails,
    analytics::UserAnalytics,
    core_systems::{CoreDetails, TmdbSettings, TvdbSettings},
    generic_types::{
        CollectionContentsInput, CollectionContentsResponse, CollectionRecommendationsResponse,
        MetadataGroupSearchResponse, MetadataSearchResponse, PeopleSearchResponse,
        UserCollectionsListResponse, UserExercisesListResponse, UserMeasurementsListResponse,
        UserMetadataGroupsListInput, UserMetadataGroupsListResponse, UserMetadataListInput,
        UserMetadataListResponse, UserMetadataRecommendationsResponse, UserPeopleListInput,
        UserPeopleListResponse, UserTemplatesOrWorkoutsListInput, UserWorkoutsListResponse,
        UserWorkoutsTemplatesListResponse,
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
    MetadataGroupDetails(String),
    UserPasswordChangeSession(String),
    CollectionRecommendations(String),
    MetadataLookup(MetadataLookupCacheInput),
    UserTwoFactorSetup(UserLevelCacheKey<()>),
    UserCollectionsList(UserLevelCacheKey<()>),
    UserPersonDetails(UserLevelCacheKey<String>),
    UserTwoFactorRateLimit(UserLevelCacheKey<()>),
    UserAnalyticsParameters(UserLevelCacheKey<()>),
    GenreDetails(UserLevelCacheKey<GenreDetailsInput>),
    UserMetadataRecommendations(UserLevelCacheKey<()>),
    PeopleSearch(UserLevelCacheKey<PeopleSearchInput>),
    UserAnalytics(UserLevelCacheKey<UserAnalyticsInput>),
    UserMetadataRecommendationsSet(UserLevelCacheKey<()>),
    MetadataSearch(UserLevelCacheKey<MetadataSearchInput>),
    UserPeopleList(UserLevelCacheKey<UserPeopleListInput>),
    UserMetadataList(UserLevelCacheKey<UserMetadataListInput>),
    UserExercisesList(UserLevelCacheKey<UserExercisesListInput>),
    MetadataGroupSearch(UserLevelCacheKey<MetadataGroupSearchInput>),
    UserCollectionContents(UserLevelCacheKey<CollectionContentsInput>),
    UserMeasurementsList(UserLevelCacheKey<UserMeasurementsListInput>),
    YoutubeMusicSongListened(UserLevelCacheKey<YoutubeMusicSongListened>),
    UserWorkoutsList(UserLevelCacheKey<UserTemplatesOrWorkoutsListInput>),
    UserMetadataGroupsList(UserLevelCacheKey<UserMetadataGroupsListInput>),
    UserWorkoutTemplatesList(UserLevelCacheKey<UserTemplatesOrWorkoutsListInput>),
    MetadataRecentlyConsumed(UserLevelCacheKey<MetadataRecentlyConsumedCacheInput>),
    MetadataProgressUpdateCompletedCache(UserLevelCacheKey<MetadataProgressUpdateCacheInput>),
    MetadataProgressUpdateInProgressCache(UserLevelCacheKey<MetadataProgressUpdateCacheInput>),
}

pub type IgdbSettings = String;
pub type SpotifyAccessToken = String;
pub type YoutubeMusicSongListenedResponse = bool;
pub type ApplicationRecommendations = Vec<String>;
pub type TrendingMetadataIdsResponse = Vec<String>;
pub type ListennotesSettings = HashMap<i32, String>;

#[derive(Clone, Debug, PartialEq, FromJsonQueryResult, Serialize, Deserialize, Eq)]
pub enum ApplicationCacheValue {
    TmdbSettings(TmdbSettings),
    TvdbSettings(TvdbSettings),
    GenreDetails(GenreDetails),
    IgdbSettings(IgdbSettings),
    UserAnalytics(UserAnalytics),
    CoreDetails(Box<CoreDetails>),
    UserSession(UserSessionValue),
    PeopleSearch(PeopleSearchResponse),
    SpotifyAccessToken(SpotifyAccessToken),
    MetadataLookup(MetadataLookupResponse),
    MetadataSearch(MetadataSearchResponse),
    UserPeopleList(UserPeopleListResponse),
    UserTwoFactorRateLimit(EmptyCacheValue),
    PersonDetails(Box<GraphqlPersonDetails>),
    ListennotesSettings(ListennotesSettings),
    UserPersonDetails(Box<UserPersonDetails>),
    MetadataRecentlyConsumed(EmptyCacheValue),
    UserWorkoutsList(UserWorkoutsListResponse),
    UserMetadataList(UserMetadataListResponse),
    MetadataDetails(Box<GraphqlMetadataDetails>),
    UserExercisesList(UserExercisesListResponse),
    UserAnalyticsParameters(ApplicationDateRange),
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
    UserPasswordChangeSession(UserPasswordChangeSessionValue),
    YoutubeMusicSongListened(YoutubeMusicSongListenedResponse),
    UserMetadataRecommendationsSet(ApplicationRecommendations),
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
