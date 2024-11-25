use async_graphql::{InputObject, OutputType, SimpleObject, Union};
use common_models::{BackendError, SearchDetails};
use config::FrontendConfig;
use database_models::{
    collection, exercise, metadata, metadata_group, person, seen, user, user_measurement,
    user_to_entity, workout, workout_template,
};
use enums::{ExerciseEquipment, ExerciseMuscle, UserToMediaReason};
use fitness_models::{UserToExerciseHistoryExtraInformation, UserWorkoutInput};
use importer_models::ImportFailedItem;
use media_models::{
    CreateOrUpdateCollectionInput, DailyUserActivitiesResponseGroupedBy, DailyUserActivityItem,
    EntityWithLot, GenreListItem, GraphqlMediaAssets, ImportOrExportExerciseItem,
    ImportOrExportMediaGroupItem, ImportOrExportMediaItem, ImportOrExportPersonItem,
    MetadataCreatorGroupedByRole, PersonDetailsGroupedByRole, ReviewItem, UserDetailsError,
    UserMediaNextEntry, UserMetadataDetailsEpisodeProgress, UserMetadataDetailsShowSeasonProgress,
};
use rust_decimal::Decimal;
use schematic::Schematic;
use sea_orm::FromQueryResult;
use serde::{Deserialize, Serialize};
use serde_with::skip_serializing_none;

#[derive(Serialize, Deserialize, Debug, SimpleObject, Clone)]
#[graphql(concrete(name = "ExerciseListResults", params(fitness_models::ExerciseListItem)))]
#[graphql(concrete(
    name = "MediaCollectionContentsResults",
    params(media_models::EntityWithLot)
))]
#[graphql(concrete(
    name = "MetadataSearchResults",
    params(media_models::MetadataSearchItemResponse)
))]
#[graphql(concrete(name = "PeopleSearchResults", params(media_models::PeopleSearchItem)))]
#[graphql(concrete(
    name = "MetadataGroupSearchResults",
    params(media_models::MetadataGroupSearchItem)
))]
#[graphql(concrete(name = "GenreListResults", params(media_models::GenreListItem)))]
#[graphql(concrete(name = "WorkoutListResults", params(workout::Model)))]
#[graphql(concrete(name = "WorkoutTemplateListResults", params(workout_template::Model)))]
#[graphql(concrete(name = "IdResults", params(String)))]
pub struct SearchResults<T: OutputType> {
    pub details: SearchDetails,
    pub items: Vec<T>,
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
    /// Data about user's media.
    pub media: Option<Vec<media_models::ImportOrExportMediaItem>>,
    /// Data about user's people.
    pub people: Option<Vec<media_models::ImportOrExportPersonItem>>,
    /// Data about user's measurements.
    pub measurements: Option<Vec<user_measurement::Model>>,
    /// Data about user's workouts.
    pub workouts: Option<Vec<ImportOrExportWorkoutItem>>,
    /// Data about user's media groups.
    pub media_groups: Option<Vec<media_models::ImportOrExportMediaGroupItem>>,
    /// Data about user's exercises.
    pub exercises: Option<Vec<ImportOrExportExerciseItem>>,
    /// Data about user's workout templates.
    pub workout_templates: Option<Vec<ImportOrExportWorkoutTemplateItem>>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct UserWorkoutDetails {
    pub details: workout::Model,
    pub collections: Vec<collection::Model>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct UserExerciseDetails {
    pub details: Option<user_to_entity::Model>,
    pub history: Option<Vec<UserToExerciseHistoryExtraInformation>>,
    pub collections: Vec<collection::Model>,
    pub reviews: Vec<ReviewItem>,
}

#[derive(Clone, Debug, Deserialize, Serialize, InputObject)]
pub struct UpdateCustomExerciseInput {
    pub old_name: String,
    pub should_delete: Option<bool>,
    #[graphql(flatten)]
    pub update: exercise::Model,
}

#[derive(Union)]
pub enum UserDetailsResult {
    Ok(Box<user::Model>),
    Error(UserDetailsError),
}

#[derive(Debug, SimpleObject)]
pub struct CollectionContents {
    pub details: collection::Model,
    pub results: SearchResults<EntityWithLot>,
    pub reviews: Vec<ReviewItem>,
    pub user: user::Model,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct PersonDetails {
    pub details: person::Model,
    pub contents: Vec<PersonDetailsGroupedByRole>,
    pub source_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct MetadataGroupDetails {
    pub details: metadata_group::Model,
    pub source_url: Option<String>,
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

#[derive(Debug, SimpleObject, Serialize, Deserialize)]
pub struct CoreDetails {
    pub is_pro: bool,
    pub page_size: i32,
    pub version: String,
    pub docs_link: String,
    pub oidc_enabled: bool,
    pub smtp_enabled: bool,
    pub website_url: String,
    pub signup_allowed: bool,
    pub disable_telemetry: bool,
    pub repository_link: String,
    pub frontend: FrontendConfig,
    pub token_valid_for_days: i32,
    pub local_auth_disabled: bool,
    pub file_storage_enabled: bool,
    pub backend_errors: Vec<BackendError>,
}

#[derive(SimpleObject)]
pub struct UserPersonDetails {
    pub reviews: Vec<ReviewItem>,
    pub collections: Vec<collection::Model>,
}

#[derive(SimpleObject)]
pub struct UserMetadataGroupDetails {
    pub reviews: Vec<ReviewItem>,
    pub collections: Vec<collection::Model>,
}

#[derive(SimpleObject)]
pub struct UserMetadataDetails {
    /// The reasons why this metadata is related to this user
    pub media_reason: Option<Vec<UserToMediaReason>>,
    /// The collections in which this media is present.
    pub collections: Vec<collection::Model>,
    /// The public reviews of this media.
    pub reviews: Vec<ReviewItem>,
    /// The seen history of this media.
    pub history: Vec<seen::Model>,
    /// The seen item if it is in progress.
    pub in_progress: Option<seen::Model>,
    /// The next episode/chapter of this media.
    pub next_entry: Option<UserMediaNextEntry>,
    /// The number of users who have seen this media.
    pub seen_by_all_count: usize,
    /// The number of times this user has seen this media.
    pub seen_by_user_count: usize,
    /// The average rating of this media in this service.
    pub average_rating: Option<Decimal>,
    /// The seen progress of this media if it is a show.
    pub show_progress: Option<Vec<UserMetadataDetailsShowSeasonProgress>>,
    /// The seen progress of this media if it is a podcast.
    pub podcast_progress: Option<Vec<UserMetadataDetailsEpisodeProgress>>,
    /// Whether this media has been interacted with
    pub has_interacted: bool,
}

#[derive(Debug, Default)]
pub struct ImportResult {
    pub workouts: Vec<UserWorkoutInput>,
    pub failed_items: Vec<ImportFailedItem>,
    pub metadata: Vec<ImportOrExportMediaItem>,
    pub people: Vec<ImportOrExportPersonItem>,
    pub measurements: Vec<user_measurement::Model>,
    pub metadata_groups: Vec<ImportOrExportMediaGroupItem>,
    pub collections: Vec<CreateOrUpdateCollectionInput>,
    pub application_workouts: Vec<ImportOrExportWorkoutItem>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct DailyUserActivitiesResponse {
    pub total_count: i64,
    pub item_count: usize,
    pub total_duration: i64,
    pub items: Vec<DailyUserActivityItem>,
    pub grouped_by: DailyUserActivitiesResponseGroupedBy,
}

#[derive(Debug, SimpleObject, Clone, Serialize, Deserialize, Schematic)]
pub struct UserWorkoutTemplateDetails {
    pub details: workout_template::Model,
    pub collections: Vec<collection::Model>,
}

#[derive(Debug, SimpleObject, Serialize, Deserialize)]
pub struct FitnessAnalyticsExercise {
    pub count: u32,
    pub exercise: String,
}

#[derive(Debug, SimpleObject, Serialize, Deserialize)]
pub struct FitnessAnalyticsMuscle {
    pub count: u32,
    pub muscle: ExerciseMuscle,
}

#[derive(Debug, SimpleObject, Serialize, Deserialize)]
pub struct FitnessAnalyticsEquipment {
    pub count: u32,
    pub equipment: ExerciseEquipment,
}

#[derive(Debug, SimpleObject, Serialize, Deserialize, FromQueryResult)]
pub struct FitnessAnalyticsHour {
    pub hour: u32,
    pub count: u32,
}

#[derive(Debug, SimpleObject, Serialize, Deserialize)]
pub struct FitnessAnalytics {
    pub workout_reps: i32,
    pub workout_weight: i32,
    pub workout_count: i32,
    pub workout_distance: i32,
    pub workout_rest_time: i32,
    pub measurement_count: i32,
    pub workout_personal_bests: i32,
    pub hours: Vec<FitnessAnalyticsHour>,
    pub workout_muscles: Vec<FitnessAnalyticsMuscle>,
    pub workout_exercises: Vec<FitnessAnalyticsExercise>,
    pub workout_equipments: Vec<FitnessAnalyticsEquipment>,
}
