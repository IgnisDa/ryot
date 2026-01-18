use async_graphql::{Enum, InputObject, SimpleObject, Union};
use enum_models::{EntityLot, EntityTranslationVariant};
use serde::{Deserialize, Serialize};

#[derive(Debug, InputObject, Serialize, Deserialize, Clone)]
pub struct MediaTranslationInput {
    pub entity_id: String,
    pub entity_lot: EntityLot,
    pub variant: EntityTranslationVariant,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, SimpleObject)]
pub struct MediaTranslationValue {
    pub value: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Enum)]
pub enum MediaTranslationPendingStatus {
    InProgress,
    NotFetched,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, SimpleObject)]
pub struct MediaTranslationPending {
    pub status: MediaTranslationPendingStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Union)]
pub enum MediaTranslationResult {
    Value(MediaTranslationValue),
    Pending(MediaTranslationPending),
}
