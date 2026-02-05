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
    #[default]
    Rank,
    Date,
    Title,
    Random,
    UserRating,
    LastUpdatedOn,
    // For metadata
    LastConsumed,
    TimesConsumed,
    ProviderRating,
    // For people/groups
    AssociatedEntityCount,
    // For exercises
    LastPerformed,
    TimesPerformed,
}

#[skip_serializing_none]
#[derive(Debug, Hash, PartialEq, Eq, Clone, Serialize, Deserialize, InputObject, Default)]
pub struct CollectionContentsFilter {
    // Existing filters
    pub entity_lot: Option<EntityLot>,
    pub metadata_lot: Option<MediaLot>,
    // For metadata
    pub source: Option<MediaSource>,
    pub general: Option<MediaGeneralFilter>,
    pub date_range: Option<ApplicationDateRange>,
    pub collections: Option<Vec<MediaCollectionFilter>>,
    // For exercise entities
    pub exercise_types: Option<Vec<ExerciseLot>>,
    pub exercise_levels: Option<Vec<ExerciseLevel>>,
    pub exercise_forces: Option<Vec<ExerciseForce>>,
    pub exercise_muscles: Option<Vec<ExerciseMuscle>>,
    pub exercise_mechanics: Option<Vec<ExerciseMechanic>>,
    pub exercise_equipments: Option<Vec<ExerciseEquipment>>,
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
