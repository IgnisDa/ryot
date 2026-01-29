use async_graphql::{Enum, InputObject, SimpleObject, Union};
use enum_models::{EntityLot, EntityTranslationVariant};
use sea_orm::FromJsonQueryResult;
use serde::{Deserialize, Serialize};
use serde_with::skip_serializing_none;

#[derive(Debug, Default, PartialEq, Eq, Serialize, Deserialize, SimpleObject, Clone)]
pub struct EntityTranslationDetails {
    pub image: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
}

#[skip_serializing_none]
#[derive(
    Eq,
    Hash,
    Debug,
    Clone,
    PartialEq,
    Serialize,
    Deserialize,
    InputObject,
    SimpleObject,
    FromJsonQueryResult,
)]
#[graphql(input_name = "ShowTranslationExtraInformationInput")]
pub struct ShowTranslationExtraInformation {
    pub season: i32,
    pub episode: Option<i32>,
}

#[skip_serializing_none]
#[derive(
    Eq,
    Hash,
    Debug,
    Clone,
    PartialEq,
    Serialize,
    Deserialize,
    InputObject,
    SimpleObject,
    FromJsonQueryResult,
)]
#[graphql(input_name = "PodcastTranslationExtraInformationInput")]
pub struct PodcastTranslationExtraInformation {
    pub episode: i32,
}

#[derive(Debug, InputObject, Serialize, Deserialize, Clone)]
pub struct MediaTranslationInput {
    pub entity_id: String,
    pub entity_lot: EntityLot,
    pub variant: EntityTranslationVariant,
    pub show_extra_information: Option<ShowTranslationExtraInformation>,
    pub podcast_extra_information: Option<PodcastTranslationExtraInformation>,
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
