use async_graphql::{InputObject, InputType, OutputType, SimpleObject};
use common_models::{ApplicationDateRange, SearchDetails, SearchInput};
use database_models::{collection, metadata_group};
use enum_models::MediaLot;
use media_models::{
    CollectionContentsFilter, CollectionContentsSortBy, EntityWithLot, GenreListItem,
    GraphqlMetadataDetails, GraphqlSortOrder, MediaFilter, MediaSortBy, MetadataLookupResponse,
    PersonAndMetadataGroupsSortBy, ReviewItem,
};
use serde::{Deserialize, Serialize};
use serde_with::skip_serializing_none;
use uuid::Uuid;

use crate::{
    BasicUserDetails, EntityTranslationDetailsResponse, GraphqlPersonDetails, UserAnalytics,
    UserMetadataDetails, UserMetadataGroupDetails, UserPersonDetails, UserWorkoutDetails,
    UserWorkoutTemplateDetails,
};

#[derive(PartialEq, Eq, Default, Serialize, Deserialize, Debug, SimpleObject, Clone)]
#[graphql(concrete(
    params(media_models::EntityWithLot),
    name = "MediaCollectionContentsResults"
))]
#[graphql(concrete(name = "IdResults", params(String)))]
pub struct SearchResults<T: OutputType> {
    pub items: Vec<T>,
    pub details: SearchDetails,
}

#[derive(Debug, PartialEq, Eq, Hash, Serialize, Deserialize, InputObject, Clone, Default)]
#[graphql(concrete(name = "MediaSortInput", params(MediaSortBy)))]
#[graphql(concrete(name = "PersonSortInput", params(PersonAndMetadataGroupsSortBy)))]
#[graphql(concrete(
    name = "UserWorkoutsListSortInput",
    params(UserTemplatesOrWorkoutsListSortBy)
))]
#[graphql(concrete(name = "CollectionContentsSortInput", params(CollectionContentsSortBy)))]
pub struct SortInput<T: InputType + Default> {
    #[graphql(default)]
    pub by: T,
    #[graphql(default)]
    pub order: GraphqlSortOrder,
}

#[derive(PartialEq, Eq, Default, Serialize, Deserialize, Debug, SimpleObject, Clone)]
#[graphql(concrete(name = "CachedGenreDetailsResponse", params(GenreDetails)))]
#[graphql(concrete(name = "CachedUserAnalyticsResponse", params(UserAnalytics)))]
#[graphql(concrete(name = "CachedSearchIdResponse", params(UserMetadataListResponse)))]
#[graphql(concrete(name = "CachedUserPersonDetailsResponse", params(UserPersonDetails)))]
#[graphql(concrete(name = "CachedUserWorkoutDetailsResponse", params(UserWorkoutDetails)))]
#[graphql(concrete(name = "CachedMetadataLookupResponse", params(MetadataLookupResponse)))]
#[graphql(concrete(
    params(FilterPresetsListResponse),
    name = "CachedFilterPresetsResponse",
))]
#[graphql(concrete(
    params(UserCollectionsListResponse),
    name = "CachedCollectionsListResponse",
))]
#[graphql(concrete(
    params(CollectionContentsResponse),
    name = "CachedCollectionContentsResponse",
))]
#[graphql(concrete(
    params(UserMetadataDetails),
    name = "CachedUserMetadataDetailsResponse",
))]
#[graphql(concrete(
    params(UserMeasurementsListResponse),
    name = "CachedUserMeasurementsListResponse",
))]
#[graphql(concrete(
    params(GraphqlPersonDetails),
    name = "CachedGraphqlPersonDetailsResponse",
))]
#[graphql(concrete(
    params(MetadataGroupDetails),
    name = "CachedMetadataGroupDetailsResponse",
))]
#[graphql(concrete(
    params(GraphqlMetadataDetails),
    name = "CachedGraphqlMetadataDetailsResponse",
))]
#[graphql(concrete(
    params(ApplicationDateRange),
    name = "CachedUserAnalyticsParametersResponse",
))]
#[graphql(concrete(
    params(EntityTranslationDetailsResponse),
    name = "CachedEntityTranslationDetailsResponse",
))]
#[graphql(concrete(
    params(UserMetadataGroupDetails),
    name = "CachedUserMetadataGroupDetailsResponse",
))]
#[graphql(concrete(
    params(UserWorkoutTemplateDetails),
    name = "CachedUserWorkoutTemplateDetailsResponse",
))]
#[graphql(concrete(
    params(UserMetadataRecommendationsResponse),
    name = "CachedUserMetadataRecommendationsResponse",
))]
pub struct CachedResponse<T: OutputType> {
    pub response: T,
    pub cache_id: Uuid,
}

#[derive(Debug, PartialEq, Eq, SimpleObject, Serialize, Deserialize, Clone)]
pub struct CollectionContents {
    pub total_items: u64,
    pub user: BasicUserDetails,
    pub reviews: Vec<ReviewItem>,
    pub details: collection::Model,
    pub results: SearchResults<EntityWithLot>,
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize, SimpleObject, Clone)]
pub struct MetadataGroupDetails {
    pub contents: Vec<String>,
    pub details: metadata_group::Model,
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize, SimpleObject, Clone)]
pub struct GenreDetails {
    pub details: GenreListItem,
    pub contents: SearchResults<String>,
}

#[derive(Debug, Hash, PartialEq, Eq, Clone, Serialize, Deserialize, InputObject)]
pub struct CollectionContentsInput {
    pub collection_id: String,
    pub search: Option<SearchInput>,
    pub filter: Option<CollectionContentsFilter>,
    pub sort: Option<SortInput<CollectionContentsSortBy>>,
}

#[derive(Debug, Hash, PartialEq, Eq, Clone, Serialize, Deserialize, InputObject)]
pub struct CollectionRecommendationsInput {
    pub collection_id: String,
    pub search: Option<SearchInput>,
}

#[skip_serializing_none]
#[derive(Debug, Hash, PartialEq, Eq, Serialize, Deserialize, InputObject, Clone, Default)]
pub struct UserMetadataListInput {
    pub lot: Option<MediaLot>,
    pub filter: Option<MediaFilter>,
    pub search: Option<SearchInput>,
    pub sort: Option<SortInput<MediaSortBy>>,
}

#[derive(Debug, Hash, PartialEq, Eq, Serialize, Deserialize, InputObject, Clone, Default)]
pub struct UserPeopleListInput {
    pub search: Option<SearchInput>,
    pub filter: Option<MediaFilter>,
    pub sort: Option<SortInput<PersonAndMetadataGroupsSortBy>>,
}

#[derive(Debug, Hash, PartialEq, Eq, Serialize, Deserialize, InputObject, Clone, Default)]
pub struct UserMetadataGroupsListInput {
    pub lot: Option<MediaLot>,
    pub search: Option<SearchInput>,
    pub filter: Option<MediaFilter>,
    pub sort: Option<SortInput<PersonAndMetadataGroupsSortBy>>,
}

#[derive(
    Debug, Hash, Serialize, Deserialize, async_graphql::Enum, Clone, PartialEq, Eq, Copy, Default,
)]
pub enum UserTemplatesOrWorkoutsListSortBy {
    #[default]
    Time,
    Random,
}

#[derive(Debug, Hash, PartialEq, Eq, Serialize, Deserialize, InputObject, Clone, Default)]
pub struct UserTemplatesOrWorkoutsListInput {
    pub search: Option<SearchInput>,
    pub sort: Option<SortInput<UserTemplatesOrWorkoutsListSortBy>>,
}

// Type aliases for different response types
pub type PeopleSearchResponse = SearchResults<String>;
pub type MetadataSearchResponse = SearchResults<String>;
pub type UserPeopleListResponse = SearchResults<String>;
pub type CollectionRecommendationsResponse = Vec<String>;
pub type CollectionContentsResponse = CollectionContents;
pub type UserWorkoutsListResponse = SearchResults<String>;
pub type UserMetadataListResponse = SearchResults<String>;
pub type UserExercisesListResponse = SearchResults<String>;
pub type UserMetadataRecommendationsResponse = Vec<String>;
pub type MetadataGroupSearchResponse = SearchResults<String>;
pub type UserMetadataGroupsListResponse = SearchResults<String>;
pub type UserWorkoutsTemplatesListResponse = SearchResults<String>;
pub type UserCollectionsListResponse = Vec<media_models::CollectionItem>;
pub type FilterPresetsListResponse = Vec<database_models::filter_preset::Model>;
pub type UserMeasurementsListResponse = Vec<database_models::user_measurement::Model>;
