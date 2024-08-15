use async_graphql::{InputObject, OutputType, SimpleObject};
use common_models::SearchDetails;
use database_models::{collection, exercise, user_measurement, user_to_entity, workout};
use fitness_models::UserToExerciseHistoryExtraInformation;
use schematic::Schematic;
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
#[graphql(concrete(name = "IdResults", params(String)))]
pub struct SearchResults<T: OutputType> {
    pub details: SearchDetails,
    pub items: Vec<T>,
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
    pub workouts: Option<Vec<workout::Model>>,
    /// Data about user's media groups.
    pub media_group: Option<Vec<media_models::ImportOrExportMediaGroupItem>>,
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
}

#[derive(Clone, Debug, Deserialize, Serialize, InputObject)]
pub struct UpdateCustomExerciseInput {
    pub old_name: String,
    pub should_delete: Option<bool>,
    #[graphql(flatten)]
    pub update: exercise::Model,
}
