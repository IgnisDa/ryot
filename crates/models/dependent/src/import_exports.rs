use database_models::exercise;
use database_models::{user_measurement, workout, workout_template};
use fitness_models::UserWorkoutInput;
use importer_models::ImportFailedItem;
use media_models::{
    CreateOrUpdateCollectionInput, ImportOrExportExerciseItem, ImportOrExportMetadataGroupItem,
    ImportOrExportMetadataItem, ImportOrExportPersonItem,
};
use schematic::Schematic;
use serde::{Deserialize, Serialize};
use serde_with::skip_serializing_none;
use strum::Display;

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

#[derive(Debug, async_graphql::SimpleObject, Clone, Serialize, Deserialize, Schematic)]
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
    pub people: Option<Vec<ImportOrExportPersonItem>>,
    /// Data about user's media.
    pub metadata: Option<Vec<ImportOrExportMetadataItem>>,
    /// Data about user's workout templates.
    pub workout_templates: Option<Vec<ImportOrExportWorkoutTemplateItem>>,
    /// Data about user's media groups.
    pub metadata_groups: Option<Vec<ImportOrExportMetadataGroupItem>>,
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
    ApplicationWorkout(Box<ImportOrExportWorkoutItem>),
}

#[derive(Debug, Default, Clone, Serialize)]
pub struct ImportResult {
    pub failed: Vec<ImportFailedItem>,
    pub completed: Vec<ImportCompletedItem>,
}
