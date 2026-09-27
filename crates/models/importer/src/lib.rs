use async_graphql::{Enum, SimpleObject};
use enum_models::MediaLot;
use sea_orm::FromJsonQueryResult;
use serde::{Deserialize, Serialize};

/// The various steps in which media importing can fail
#[derive(Debug, Default, Enum, PartialEq, Eq, Copy, Clone, Serialize, Deserialize)]
pub enum ImportFailStep {
    /// Failed to get details from the source (eg: MediaTracker, Goodreads etc.)
    #[default]
    ItemDetailsFromSource,
    /// Failed to transform the data into the required format
    InputTransformation,
    /// Failed to get metadata from the provider (eg: Openlibrary, IGDB etc.)
    MediaDetailsFromProvider,
    /// Failed to save an entity/review/progress item
    DatabaseCommit,
}

#[derive(
    Debug, Default, SimpleObject, FromJsonQueryResult, Serialize, Deserialize, Eq, PartialEq, Clone,
)]
pub struct ImportFailedItem {
    pub identifier: String,
    pub step: ImportFailStep,
    pub lot: Option<MediaLot>,
    pub error: Option<String>,
}

#[derive(Debug, SimpleObject, Serialize, Deserialize, Eq, PartialEq, Clone)]
pub struct ImportDetails {
    pub total: usize,
}

#[derive(
    Debug, SimpleObject, Serialize, Deserialize, FromJsonQueryResult, Eq, PartialEq, Clone,
)]
pub struct ImportResultResponse {
    pub import: ImportDetails,
    pub failed_items: Vec<ImportFailedItem>,
}
