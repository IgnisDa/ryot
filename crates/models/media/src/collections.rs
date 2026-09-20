use async_graphql::{Enum, InputObject, SimpleObject};
use common_models::{
    ApplicationDateRange, CollectionExtraInformation, StringIdAndNamedObject,
    UserToCollectionExtraInformation,
};
use enum_models::{
    EntityLot, ExerciseEquipment, ExerciseForce, ExerciseLevel, ExerciseLot, ExerciseMechanic,
    ExerciseMuscle, MediaLot, MediaSource,
};
use schematic::Schematic;
use sea_orm::{FromJsonQueryResult, FromQueryResult};
use serde::{Deserialize, Serialize};
use serde_with::skip_serializing_none;

use crate::{MediaCollectionFilter, MediaGeneralFilter};

#[derive(Debug, InputObject, Default, Clone, Serialize)]
pub struct CreateOrUpdateCollectionInput {
    pub name: String,
    pub update_id: Option<String>,
    pub description: Option<String>,
    pub collaborators: Option<Vec<String>>,
    pub extra_information: Option<UserToCollectionExtraInformation>,
    pub information_template: Option<Vec<CollectionExtraInformation>>,
}

#[derive(Debug, Serialize, Hash, Deserialize, Enum, Clone, PartialEq, Eq, Copy, Default)]
pub enum CollectionContentsSortBy {
    /// Sort by the rank assigned to the item in the collection. Applicable to all entity types.
    #[default]
    Rank,
    /// Sort by date: publish date for metadata, birth date for people, end time for workouts,
    /// created on for workout templates. Applicable to all entity types.
    Date,
    /// Sort by title/name of the entity. Applicable to all entity types.
    Title,
    /// Sort randomly. Applicable to all entity types.
    Random,
    /// Sort by the user's average review rating for the entity. Applicable to all entity types.
    UserRating,
    /// Sort by when the metadata was last consumed (most recent seen entry). Only applicable to metadata.
    LastConsumed,
    /// Sort by when the item was last updated in the collection. Applicable to all entity types.
    LastUpdatedOn,
    /// Sort by how many times the metadata has been consumed (seen count). Only applicable to metadata.
    TimesConsumed,
    /// Sort by when the exercise was last performed by the user. Only applicable to exercises.
    LastPerformed,
    /// Sort by the provider's rating for the metadata. Only applicable to metadata.
    ProviderRating,
    /// Sort by how many times the exercise has been performed by the user. Only applicable to exercises.
    TimesPerformed,
    /// Sort by associated entity count for people or number of parts for metadata groups.
    /// Only applicable to people and metadata groups.
    AssociatedEntityCount,
}

/// Filter options specific to metadata (media) entities in a collection.
/// Only applies when filtering collection contents by metadata entity type.
#[skip_serializing_none]
#[derive(Debug, Hash, PartialEq, Eq, Clone, Serialize, Deserialize, InputObject, Default)]
pub struct MetadataCollectionContentsFilter {
    /// Filter by media type (e.g., Movie, Show, Book, VideoGame, Anime, Manga).
    pub lot: Option<MediaLot>,
    /// Filter by the source/provider of the metadata (e.g., Tmdb, Anilist, Audible, Igdb).
    pub source: Option<MediaSource>,
    /// General filter for metadata status (e.g., All, Rated, Unrated, Dropped, OnAHold, Unfinished).
    pub general: Option<MediaGeneralFilter>,
}

/// Filter options specific to exercise entities in a collection.
/// Only applies when filtering collection contents by exercise entity type.
#[skip_serializing_none]
#[derive(Debug, Hash, PartialEq, Eq, Clone, Serialize, Deserialize, InputObject, Default)]
pub struct ExerciseCollectionContentsFilter {
    /// Filter by exercise types (e.g., Duration, DistanceAndDuration, Reps, RepsAndWeight).
    pub types: Option<Vec<ExerciseLot>>,
    /// Filter by difficulty levels (e.g., Beginner, Intermediate, Expert).
    pub levels: Option<Vec<ExerciseLevel>>,
    /// Filter by force types (e.g., Pull, Push, Static).
    pub forces: Option<Vec<ExerciseForce>>,
    /// Filter by primary muscle groups targeted (e.g., Abdominals, Biceps, Chest, Quadriceps).
    pub muscles: Option<Vec<ExerciseMuscle>>,
    /// Filter by movement mechanics (e.g., Compound, Isolation).
    pub mechanics: Option<Vec<ExerciseMechanic>>,
    /// Filter by required equipment (e.g., Barbell, Dumbbell, Bodyweight, Machine).
    pub equipments: Option<Vec<ExerciseEquipment>>,
}

/// Multi-level filtering options for collection contents.
/// Allows filtering by entity type, date ranges, nested collections, and entity-specific criteria.
#[skip_serializing_none]
#[derive(Debug, Hash, PartialEq, Eq, Clone, Serialize, Deserialize, InputObject, Default)]
pub struct CollectionContentsFilter {
    /// Filter by entity type (e.g., Metadata, Person, Exercise, Workout, WorkoutTemplate, MetadataGroup).
    /// Note: Genre, Review, Collection, and UserMeasurement cannot be filtered as they cannot be added to collections.
    pub entity_lot: Option<EntityLot>,
    /// Filter by date range based on collection entry update time (LastUpdatedOn).
    pub date_range: Option<ApplicationDateRange>,
    /// Filter by presence in other collections. Use to find items that are present in or absent from specified collections.
    /// Multiple filters can be combined with AND/OR strategies.
    pub collections: Option<Vec<MediaCollectionFilter>>,
    /// Additional filters specific to metadata entities (lot, source, general status).
    pub metadata: Option<MetadataCollectionContentsFilter>,
    /// Additional filters specific to exercise entities (types, levels, forces, muscles, mechanics, equipments).
    pub exercise: Option<ExerciseCollectionContentsFilter>,
}

#[skip_serializing_none]
#[derive(
    Eq,
    Debug,
    Clone,
    PartialEq,
    Serialize,
    Schematic,
    Deserialize,
    SimpleObject,
    FromJsonQueryResult,
)]
#[serde(rename_all = "snake_case")]
pub struct CollectionItemCollaboratorInformation {
    pub collaborator: StringIdAndNamedObject,
    pub extra_information: Option<UserToCollectionExtraInformation>,
}

#[skip_serializing_none]
#[derive(
    Debug, Clone, SimpleObject, FromQueryResult, PartialEq, Eq, Serialize, Deserialize, Schematic,
)]
#[serde(rename_all = "snake_case")]
pub struct CollectionItem {
    pub id: String,
    pub count: i64,
    pub name: String,
    pub is_default: bool,
    pub description: Option<String>,
    pub creator: StringIdAndNamedObject,
    pub collaborators: Vec<CollectionItemCollaboratorInformation>,
    pub information_template: Option<Vec<CollectionExtraInformation>>,
}
