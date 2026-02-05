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

#[skip_serializing_none]
#[derive(Debug, Hash, PartialEq, Eq, Clone, Serialize, Deserialize, InputObject, Default)]
pub struct MetadataCollectionContentsFilter {
    pub source: Option<MediaSource>,
    pub general: Option<MediaGeneralFilter>,
}

#[skip_serializing_none]
#[derive(Debug, Hash, PartialEq, Eq, Clone, Serialize, Deserialize, InputObject, Default)]
pub struct ExerciseCollectionContentsFilter {
    pub types: Option<Vec<ExerciseLot>>,
    pub levels: Option<Vec<ExerciseLevel>>,
    pub forces: Option<Vec<ExerciseForce>>,
    pub muscles: Option<Vec<ExerciseMuscle>>,
    pub mechanics: Option<Vec<ExerciseMechanic>>,
    pub equipments: Option<Vec<ExerciseEquipment>>,
}

#[skip_serializing_none]
#[derive(Debug, Hash, PartialEq, Eq, Clone, Serialize, Deserialize, InputObject, Default)]
pub struct CollectionContentsFilter {
    pub entity_lot: Option<EntityLot>,
    pub metadata_lot: Option<MediaLot>,
    pub date_range: Option<ApplicationDateRange>,
    pub collections: Option<Vec<MediaCollectionFilter>>,
    pub metadata: Option<MetadataCollectionContentsFilter>,
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
