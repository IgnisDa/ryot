use common_models::PersonSourceSpecifics;
use database_models::exercise;
use database_models::{user_measurement, workout, workout_template};
use enum_models::{MediaLot, MediaSource};
use fitness_models::UserWorkoutInput;
use importer_models::ImportFailedItem;
use media_models::{
    CreateOrUpdateCollectionInput, ImportOrExportItemRating, ImportOrExportMetadataItemSeen,
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
    // TODO: Return CollectionToEntityDetails instead of just collection names
    /// The collections this entity was added to.
    pub collections: Vec<String>,
}

#[derive(Debug, async_graphql::SimpleObject, Clone, Serialize, Deserialize, Schematic)]
pub struct ImportOrExportWorkoutTemplateItem {
    pub collections: Vec<String>,
    // TODO: Return CollectionToEntityDetails instead of just collection names
    pub details: workout_template::Model,
}

/// Details about a specific media item that needs to be imported or exported.
#[skip_serializing_none]
#[derive(Debug, Serialize, Deserialize, Clone, Schematic, Default)]
#[serde(rename_all = "snake_case")]
pub struct ImportOrExportMetadataItem {
    /// The type of media.
    pub lot: MediaLot,
    /// An string to help identify it in the original source.
    pub source_id: String,
    /// The provider identifier. For eg: TMDB-ID, Openlibrary ID and so on.
    pub identifier: String,
    /// The source of media.
    pub source: MediaSource,
    // TODO: Return CollectionToEntityDetails instead of just collection names
    /// The collections this entity was added to.
    pub collections: Vec<String>,
    /// The review history for the user.
    pub reviews: Vec<ImportOrExportItemRating>,
    /// The seen history for the user.
    pub seen_history: Vec<ImportOrExportMetadataItemSeen>,
}

/// Details about a specific media group item that needs to be imported or exported.
#[skip_serializing_none]
#[derive(Debug, Serialize, Deserialize, Clone, Schematic, Default)]
#[serde(rename_all = "snake_case")]
pub struct ImportOrExportMetadataGroupItem {
    /// Name of the group.
    pub title: String,
    /// The type of media.
    pub lot: MediaLot,
    /// The provider identifier. For eg: TMDB-ID, Openlibrary ID and so on.
    pub identifier: String,
    /// The source of media.
    pub source: MediaSource,
    // TODO: Return CollectionToEntityDetails instead of just collection names
    /// The collections this entity was added to.
    pub collections: Vec<String>,
    /// The review history for the user.
    pub reviews: Vec<ImportOrExportItemRating>,
}

/// Details about a specific creator item that needs to be exported.
#[skip_serializing_none]
#[derive(Debug, Serialize, Deserialize, Clone, Schematic, Default)]
#[serde(rename_all = "snake_case")]
pub struct ImportOrExportPersonItem {
    /// The name of the creator.
    pub name: String,
    /// The provider identifier.
    pub identifier: String,
    /// The source of data.
    pub source: MediaSource,
    // TODO: Return CollectionToEntityDetails instead of just collection names
    /// The collections this entity was added to.
    pub collections: Vec<String>,
    /// The review history for the user.
    pub reviews: Vec<ImportOrExportItemRating>,
    /// The source specific data.
    pub source_specifics: Option<PersonSourceSpecifics>,
}

/// Details about a specific exercise item that needs to be exported.
#[skip_serializing_none]
#[derive(Debug, Serialize, Deserialize, Clone, Schematic)]
#[serde(rename_all = "snake_case")]
pub struct ImportOrExportExerciseItem {
    /// The unique identifier of the exercise.
    pub id: String,
    /// The name of the exercise.
    pub name: String,
    // TODO: Return CollectionToEntityDetails instead of just collection names
    /// The collections this entity was added to.
    pub collections: Vec<String>,
    /// The review history for the user.
    pub reviews: Vec<ImportOrExportItemRating>,
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
