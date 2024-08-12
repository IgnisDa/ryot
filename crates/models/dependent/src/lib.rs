use async_graphql::SimpleObject;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, SimpleObject, Clone)]
#[graphql(concrete(name = "ExerciseListResults", params(fitness::ExerciseListItem)))]
#[graphql(concrete(name = "MediaCollectionContentsResults", params(media::EntityWithLot)))]
#[graphql(concrete(
    name = "MetadataSearchResults",
    params(media::MetadataSearchItemResponse)
))]
#[graphql(concrete(name = "PeopleSearchResults", params(media::PeopleSearchItem)))]
#[graphql(concrete(
    name = "MetadataGroupSearchResults",
    params(media::MetadataGroupSearchItem)
))]
#[graphql(concrete(name = "GenreListResults", params(media::GenreListItem)))]
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
    pub media: Option<Vec<media::ImportOrExportMediaItem>>,
    /// Data about user's people.
    pub people: Option<Vec<media::ImportOrExportPersonItem>>,
    /// Data about user's measurements.
    pub measurements: Option<Vec<user_measurement::Model>>,
    /// Data about user's workouts.
    pub workouts: Option<Vec<workout::Model>>,
    /// Data about user's media groups.
    pub media_group: Option<Vec<media::ImportOrExportMediaGroupItem>>,
}
