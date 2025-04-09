use std::collections::HashMap;

use async_graphql::{Enum, InputObject, InputType, OutputType, SimpleObject, Union};
use chrono::NaiveDate;
use common_models::{
    ApplicationDateRange, BackendError, DailyUserActivitiesResponseGroupedBy,
    DailyUserActivityHourRecord, MetadataGroupSearchInput, MetadataRecentlyConsumedCacheInput,
    MetadataSearchInput, PeopleSearchInput, PersonSourceSpecifics, ProgressUpdateCacheInput,
    SearchDetails, SearchInput, UserAnalyticsInput, UserLevelCacheKey, YoutubeMusicSongListened,
};
use config::FrontendConfig;
use database_models::{
    collection, exercise, metadata,
    metadata_group::{self, MetadataGroupWithoutId},
    person, seen, user, user_measurement, user_to_entity, workout, workout_template,
};
use enum_models::{
    ExerciseEquipment, ExerciseForce, ExerciseLevel, ExerciseLot, ExerciseMechanic, ExerciseMuscle,
    MediaLot, MediaSource, UserToMediaReason, WorkoutSetPersonalBest,
};
use fitness_models::{
    UserExercisesListInput, UserToExerciseHistoryExtraInformation, UserWorkoutInput,
};
use importer_models::ImportFailedItem;
use media_models::{
    CollectionContentsFilter, CollectionContentsSortBy, CollectionItem,
    CreateOrUpdateCollectionInput, EntityWithLot, GenreListItem, GraphqlMediaAssets,
    GraphqlSortOrder, ImportOrExportExerciseItem, ImportOrExportMetadataGroupItem,
    ImportOrExportMetadataItem, ImportOrExportPersonItem, MediaFilter, MediaSortBy,
    MetadataCreatorGroupedByRole, MetadataGroupSearchItem, MetadataSearchItem,
    PartialMetadataWithoutId, PeopleSearchItem, PersonAndMetadataGroupsSortBy,
    PersonDetailsGroupedByRole, ReviewItem, UserDetailsError, UserMediaNextEntry,
    UserMetadataDetailsEpisodeProgress, UserMetadataDetailsShowSeasonProgress,
};
use rust_decimal::Decimal;
use schematic::Schematic;
use sea_orm::{FromJsonQueryResult, FromQueryResult};
use serde::{Deserialize, Serialize};
use serde_with::skip_serializing_none;
use strum::{Display, EnumDiscriminants};
use uuid::Uuid;

#[derive(PartialEq, Eq, Default, Serialize, Deserialize, Debug, SimpleObject, Clone)]
#[graphql(concrete(
    name = "MediaCollectionContentsResults",
    params(media_models::EntityWithLot)
))]
#[graphql(concrete(
    name = "MetadataSearchResults",
    params(media_models::MetadataSearchItem)
))]
#[graphql(concrete(name = "PeopleSearchResults", params(media_models::PeopleSearchItem)))]
#[graphql(concrete(
    name = "MetadataGroupSearchResults",
    params(media_models::MetadataGroupSearchItem)
))]
#[graphql(concrete(name = "IdResults", params(String)))]
pub struct SearchResults<T: OutputType> {
    pub details: SearchDetails,
    pub items: Vec<T>,
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
#[graphql(concrete(name = "CachedSearchIdResponse", params(UserMetadataListResponse)))]
#[graphql(concrete(
    name = "CachedCollectionsListResponse",
    params(UserCollectionsListResponse)
))]
#[graphql(concrete(
    name = "CachedCollectionContentsResponse",
    params(CollectionContentsResponse)
))]
#[graphql(concrete(
    name = "CachedUserMetadataRecommendationsResponse",
    params(UserMetadataRecommendationsResponse)
))]
pub struct CachedResponse<T: OutputType> {
    pub response: T,
    pub cache_id: Uuid,
}

/// Details about a specific exercise item that needs to be exported.
#[skip_serializing_none]
#[derive(Debug, Serialize, Deserialize, Clone, Schematic)]
#[serde(rename_all = "snake_case")]
pub struct ImportOrExportWorkoutItem {
    /// The details of the workout.
    pub details: workout::Model,
    /// The collections this entity was added to.
    pub collections: Vec<String>,
}

#[derive(Debug, SimpleObject, Clone, Serialize, Deserialize, Schematic)]
pub struct ImportOrExportWorkoutTemplateItem {
    pub details: workout_template::Model,
    pub collections: Vec<String>,
}

/// Complete export of the user.
#[skip_serializing_none]
#[derive(Debug, Serialize, Deserialize, Clone, Schematic)]
#[serde(rename_all = "snake_case")]
pub struct CompleteExport {
    /// Data about user's workouts.
    pub workouts: Option<Vec<ImportOrExportWorkoutItem>>,
    /// Data about user's exercises.
    pub exercises: Option<Vec<ImportOrExportExerciseItem>>,
    /// Data about user's measurements.
    pub measurements: Option<Vec<user_measurement::Model>>,
    /// Data about user's people.
    pub people: Option<Vec<media_models::ImportOrExportPersonItem>>,
    /// Data about user's media.
    pub metadata: Option<Vec<media_models::ImportOrExportMetadataItem>>,
    /// Data about user's workout templates.
    pub workout_templates: Option<Vec<ImportOrExportWorkoutTemplateItem>>,
    /// Data about user's media groups.
    pub metadata_groups: Option<Vec<media_models::ImportOrExportMetadataGroupItem>>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct UserWorkoutDetails {
    pub details: workout::Model,
    pub metadata_consumed: Vec<String>,
    pub collections: Vec<collection::Model>,
}

#[derive(Debug, Default, Serialize, Deserialize, SimpleObject, Clone)]
pub struct UserExerciseDetails {
    pub reviews: Vec<ReviewItem>,
    pub collections: Vec<collection::Model>,
    pub details: Option<user_to_entity::Model>,
    pub history: Option<Vec<UserToExerciseHistoryExtraInformation>>,
}

#[derive(Debug, Default, Serialize, Deserialize, Clone, Hash)]
pub struct MetadataPersonRelated {
    pub role: String,
    pub character: Option<String>,
    pub metadata: PartialMetadataWithoutId,
}

#[derive(Debug, Default, Serialize, Deserialize, Clone, Hash)]
pub struct MetadataGroupPersonRelated {
    pub role: String,
    pub metadata_group: MetadataGroupWithoutId,
}

#[derive(Debug, Default, Serialize, Deserialize, Clone, Hash)]
pub struct PersonDetails {
    pub name: String,
    pub identifier: String,
    pub source: MediaSource,
    pub place: Option<String>,
    pub gender: Option<String>,
    pub website: Option<String>,
    pub source_url: Option<String>,
    pub description: Option<String>,
    pub images: Option<Vec<String>>,
    pub death_date: Option<NaiveDate>,
    pub birth_date: Option<NaiveDate>,
    pub alternate_names: Option<Vec<String>>,
    pub related_metadata: Vec<MetadataPersonRelated>,
    pub source_specifics: Option<PersonSourceSpecifics>,
    pub related_metadata_groups: Vec<MetadataGroupPersonRelated>,
}

#[derive(Clone, Debug, Deserialize, Serialize, InputObject)]
pub struct UpdateCustomExerciseInput {
    #[graphql(flatten)]
    pub update: exercise::Model,
    pub should_delete: Option<bool>,
}

#[derive(Union)]
pub enum UserDetailsResult {
    Ok(Box<user::Model>),
    Error(UserDetailsError),
}

#[derive(Debug, SimpleObject, PartialEq, Eq, Serialize, Deserialize, Clone)]
pub struct CollectionContents {
    pub total_items: u64,
    pub user: user::Model,
    pub reviews: Vec<ReviewItem>,
    pub details: collection::Model,
    pub results: SearchResults<EntityWithLot>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct GraphqlPersonDetails {
    pub details: person::Model,
    pub associated_metadata: Vec<PersonDetailsGroupedByRole>,
    pub associated_metadata_groups: Vec<PersonDetailsGroupedByRole>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct MetadataGroupDetails {
    pub details: metadata_group::Model,
    pub contents: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct GenreDetails {
    pub details: GenreListItem,
    pub contents: SearchResults<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MetadataBaseData {
    pub model: metadata::Model,
    pub suggestions: Vec<String>,
    pub genres: Vec<GenreListItem>,
    pub assets: GraphqlMediaAssets,
    pub creators: Vec<MetadataCreatorGroupedByRole>,
}

#[derive(PartialEq, Eq, Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct ExerciseParametersLotMapping {
    pub lot: ExerciseLot,
    pub bests: Vec<WorkoutSetPersonalBest>,
}

#[derive(PartialEq, Eq, Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct ExerciseFilters {
    #[graphql(name = "type")]
    pub lot: Vec<ExerciseLot>,
    pub level: Vec<ExerciseLevel>,
    pub force: Vec<ExerciseForce>,
    pub muscle: Vec<ExerciseMuscle>,
    pub mechanic: Vec<ExerciseMechanic>,
    pub equipment: Vec<ExerciseEquipment>,
}

#[derive(PartialEq, Eq, Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct ExerciseParameters {
    /// All filters applicable to an exercises query.
    pub filters: ExerciseFilters,
    /// Exercise type mapped to the personal bests possible.
    pub lot_mapping: Vec<ExerciseParametersLotMapping>,
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
    pub search: Option<SearchInput>,
    pub filter: Option<MediaFilter>,
    pub sort: Option<SortInput<PersonAndMetadataGroupsSortBy>>,
}

#[derive(Debug, Hash, Serialize, Deserialize, Enum, Clone, PartialEq, Eq, Copy, Default)]
pub enum UserTemplatesOrWorkoutsListSortBy {
    #[default]
    Time,
    Random,
}

#[derive(Debug, Hash, PartialEq, Eq, Serialize, Deserialize, InputObject, Clone, Default)]
pub struct UserTemplatesOrWorkoutsListInput {
    pub search: SearchInput,
    pub sort: Option<SortInput<UserTemplatesOrWorkoutsListSortBy>>,
}

#[derive(PartialEq, Eq, Debug, SimpleObject, Serialize, Deserialize, Clone)]
pub struct ProviderLanguageInformation {
    pub source: MediaSource,
    pub supported: Vec<String>,
    pub default: String,
}

#[derive(PartialEq, Eq, Debug, SimpleObject, Serialize, Deserialize, Clone)]
pub struct MetadataLotSourceMappings {
    pub lot: MediaLot,
    pub sources: Vec<MediaSource>,
}

#[skip_serializing_none]
#[derive(PartialEq, Eq, Clone, Debug, SimpleObject, Serialize, Deserialize)]
pub struct MetadataGroupSourceLotMapping {
    pub lot: MediaLot,
    pub source: MediaSource,
}

#[skip_serializing_none]
#[derive(PartialEq, Eq, Clone, Debug, SimpleObject, Serialize, Deserialize)]
pub struct CoreDetails {
    pub page_size: i32,
    pub version: String,
    pub docs_link: String,
    pub oidc_enabled: bool,
    pub smtp_enabled: bool,
    pub website_url: String,
    pub signup_allowed: bool,
    pub is_demo_instance: bool,
    pub disable_telemetry: bool,
    pub repository_link: String,
    pub frontend: FrontendConfig,
    pub token_valid_for_days: i32,
    pub local_auth_disabled: bool,
    pub file_storage_enabled: bool,
    pub is_server_key_validated: bool,
    pub backend_errors: Vec<BackendError>,
    pub people_search_sources: Vec<MediaSource>,
    pub exercise_parameters: ExerciseParameters,
    pub metadata_lot_source_mappings: Vec<MetadataLotSourceMappings>,
    pub metadata_provider_languages: Vec<ProviderLanguageInformation>,
    pub metadata_group_source_lot_mappings: Vec<MetadataGroupSourceLotMapping>,
}

#[derive(SimpleObject)]
pub struct UserPersonDetails {
    pub reviews: Vec<ReviewItem>,
    pub is_recently_consumed: bool,
    pub average_rating: Option<Decimal>,
    pub collections: Vec<collection::Model>,
}

#[derive(SimpleObject)]
pub struct UserMetadataGroupDetails {
    pub reviews: Vec<ReviewItem>,
    pub is_recently_consumed: bool,
    pub average_rating: Option<Decimal>,
    pub collections: Vec<collection::Model>,
}

#[derive(SimpleObject)]
pub struct UserMetadataDetails {
    /// Whether this media has been interacted with
    pub has_interacted: bool,
    /// The public reviews of this media.
    pub reviews: Vec<ReviewItem>,
    /// The number of users who have seen this media.
    pub seen_by_all_count: usize,
    /// The seen history of this media.
    pub history: Vec<seen::Model>,
    /// The number of times this user has seen this media.
    pub seen_by_user_count: usize,
    /// Whether this media has been recently interacted with
    pub is_recently_consumed: bool,
    /// The average rating of this media in this service.
    pub average_rating: Option<Decimal>,
    /// The seen item if it is in progress.
    pub in_progress: Option<seen::Model>,
    /// The collections in which this media is present.
    pub collections: Vec<collection::Model>,
    /// The next episode/chapter of this media.
    pub next_entry: Option<UserMediaNextEntry>,
    /// The reasons why this metadata is related to this user
    pub media_reason: Option<Vec<UserToMediaReason>>,
    /// The seen progress of this media if it is a show.
    pub show_progress: Option<Vec<UserMetadataDetailsShowSeasonProgress>>,
    /// The seen progress of this media if it is a podcast.
    pub podcast_progress: Option<Vec<UserMetadataDetailsEpisodeProgress>>,
}

#[derive(Debug, Default, Display, Clone, Serialize)]
pub enum ImportCompletedItem {
    #[default]
    Empty,
    Workout(UserWorkoutInput),
    Exercise(exercise::Model),
    Person(ImportOrExportPersonItem),
    Metadata(ImportOrExportMetadataItem),
    Measurement(user_measurement::Model),
    Collection(CreateOrUpdateCollectionInput),
    MetadataGroup(ImportOrExportMetadataGroupItem),
    ApplicationWorkout(ImportOrExportWorkoutItem),
}

#[derive(Debug, Default, Clone, Serialize)]
pub struct ImportResult {
    pub failed: Vec<ImportFailedItem>,
    pub completed: Vec<ImportCompletedItem>,
}

#[derive(Debug, SimpleObject, Clone, Serialize, Deserialize, Schematic)]
pub struct UserWorkoutTemplateDetails {
    pub details: workout_template::Model,
    pub collections: Vec<collection::Model>,
}

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
    pub music_count: i64,
    pub total_music_duration: i64,
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

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone, PartialEq, Eq)]
pub struct DailyUserActivitiesResponse {
    pub total_count: i64,
    pub item_count: usize,
    pub total_duration: i64,
    pub items: Vec<DailyUserActivityItem>,
    pub grouped_by: DailyUserActivitiesResponseGroupedBy,
}

#[derive(
    Debug, SimpleObject, Serialize, Deserialize, FromJsonQueryResult, Clone, Eq, PartialEq,
)]
pub struct FitnessAnalyticsExercise {
    pub count: u32,
    pub exercise: String,
}

#[derive(
    Debug, SimpleObject, Serialize, Deserialize, FromJsonQueryResult, Clone, Eq, PartialEq,
)]
pub struct FitnessAnalyticsMuscle {
    pub count: u32,
    pub muscle: ExerciseMuscle,
}

#[derive(
    Debug, SimpleObject, Serialize, Deserialize, FromJsonQueryResult, Clone, Eq, PartialEq,
)]
pub struct FitnessAnalyticsEquipment {
    pub count: u32,
    pub equipment: ExerciseEquipment,
}

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
    pub workout_calories_burnt: i32,
    pub workout_personal_bests: i32,
    pub workout_muscles: Vec<FitnessAnalyticsMuscle>,
    pub workout_exercises: Vec<FitnessAnalyticsExercise>,
    pub workout_equipments: Vec<FitnessAnalyticsEquipment>,
}

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

#[derive(Debug, Default, PartialEq, Eq, Serialize, Deserialize, Clone)]
pub struct EmptyCacheValue {
    pub _empty: (),
}

#[skip_serializing_none]
#[derive(Clone, Hash, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CollectionRecommendationsCachedInput {
    pub collection_id: String,
}

#[skip_serializing_none]
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
    ListennotesSettings,
    TrendingMetadataIds,
    UserCollectionsList(UserLevelCacheKey<()>),
    UserAnalyticsParameters(UserLevelCacheKey<()>),
    UserMetadataRecommendations(UserLevelCacheKey<()>),
    PeopleSearch(UserLevelCacheKey<PeopleSearchInput>),
    UserAnalytics(UserLevelCacheKey<UserAnalyticsInput>),
    UserMetadataRecommendationsSet(UserLevelCacheKey<()>),
    MetadataSearch(UserLevelCacheKey<MetadataSearchInput>),
    UserPeopleList(UserLevelCacheKey<UserPeopleListInput>),
    UserMetadataList(UserLevelCacheKey<UserMetadataListInput>),
    UserExercisesList(UserLevelCacheKey<UserExercisesListInput>),
    CollectionRecommendations(CollectionRecommendationsCachedInput),
    MetadataGroupSearch(UserLevelCacheKey<MetadataGroupSearchInput>),
    ProgressUpdateCache(UserLevelCacheKey<ProgressUpdateCacheInput>),
    UserCollectionContents(UserLevelCacheKey<CollectionContentsInput>),
    YoutubeMusicSongListened(UserLevelCacheKey<YoutubeMusicSongListened>),
    UserWorkoutsList(UserLevelCacheKey<UserTemplatesOrWorkoutsListInput>),
    UserMetadataGroupsList(UserLevelCacheKey<UserMetadataGroupsListInput>),
    UserWorkoutTemplatesList(UserLevelCacheKey<UserTemplatesOrWorkoutsListInput>),
    MetadataRecentlyConsumed(UserLevelCacheKey<MetadataRecentlyConsumedCacheInput>),
}

pub type IgdbSettings = String;
pub type YoutubeMusicSongListenedResponse = bool;
pub type ApplicationRecommendations = Vec<String>;
pub type TrendingMetadataIdsResponse = Vec<String>;
pub type ListennotesSettings = HashMap<i32, String>;
pub type UserPeopleListResponse = SearchResults<String>;
pub type CollectionRecommendationsResponse = Vec<String>;
pub type CollectionContentsResponse = CollectionContents;
pub type UserWorkoutsListResponse = SearchResults<String>;
pub type UserMetadataListResponse = SearchResults<String>;
pub type UserCollectionsListResponse = Vec<CollectionItem>;
pub type UserExercisesListResponse = SearchResults<String>;
pub type UserMetadataRecommendationsResponse = Vec<String>;
pub type PeopleSearchResponse = SearchResults<PeopleSearchItem>;
pub type UserMetadataGroupsListResponse = SearchResults<String>;
pub type UserWorkoutsTemplatesListResponse = SearchResults<String>;
pub type MetadataSearchResponse = SearchResults<MetadataSearchItem>;
pub type MetadataGroupSearchResponse = SearchResults<MetadataGroupSearchItem>;

#[derive(Clone, Debug, PartialEq, FromJsonQueryResult, Serialize, Deserialize, Eq)]
pub enum ApplicationCacheValue {
    TmdbSettings(TmdbSettings),
    IgdbSettings(IgdbSettings),
    UserAnalytics(UserAnalytics),
    CoreDetails(Box<CoreDetails>),
    PeopleSearch(PeopleSearchResponse),
    ProgressUpdateCache(EmptyCacheValue),
    MetadataSearch(MetadataSearchResponse),
    UserPeopleList(UserPeopleListResponse),
    ListennotesSettings(ListennotesSettings),
    MetadataRecentlyConsumed(EmptyCacheValue),
    UserWorkoutsList(UserWorkoutsListResponse),
    UserMetadataList(UserMetadataListResponse),
    UserExercisesList(UserExercisesListResponse),
    UserAnalyticsParameters(ApplicationDateRange),
    TrendingMetadataIds(TrendingMetadataIdsResponse),
    UserCollectionsList(UserCollectionsListResponse),
    MetadataGroupSearch(MetadataGroupSearchResponse),
    UserMetadataGroupsList(UserMetadataGroupsListResponse),
    UserCollectionContents(Box<CollectionContentsResponse>),
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

pub enum ExpireCacheKeyInput {
    ById(Uuid),
    ByKey(ApplicationCacheKey),
    BySanitizedKey {
        user_id: Option<String>,
        key: ApplicationCacheKeyDiscriminants,
    },
}
