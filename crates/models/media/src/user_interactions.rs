use std::collections::HashSet;

use async_graphql::SimpleObject;
use enum_models::EntityLot;
use rust_decimal::Decimal;
use sea_orm::{FromJsonQueryResult, prelude::DateTimeUtc};
use serde::{Deserialize, Serialize};
use serde_with::skip_serializing_none;

use crate::metadata_models::UniqueMediaIdentifier;

#[derive(
    Debug, Serialize, Deserialize, Clone, FromJsonQueryResult, Eq, PartialEq, Default, Hash,
)]
pub struct MediaAssociatedPersonStateChanges {
    pub role: String,
    pub media: UniqueMediaIdentifier,
}

#[derive(Debug, Serialize, Deserialize, Clone, FromJsonQueryResult, Eq, PartialEq, Default)]
pub struct PersonStateChanges {
    pub metadata_associated: HashSet<MediaAssociatedPersonStateChanges>,
    pub metadata_groups_associated: HashSet<MediaAssociatedPersonStateChanges>,
}

#[skip_serializing_none]
#[derive(
    Debug, Serialize, Deserialize, Clone, FromJsonQueryResult, Eq, PartialEq, Default, SimpleObject,
)]
pub struct IntegrationTriggerResult {
    pub error: Option<String>,
    pub finished_at: DateTimeUtc,
}

#[derive(
    Debug, PartialEq, Eq, Serialize, Deserialize, Clone, SimpleObject, FromJsonQueryResult,
)]
pub struct SeenMangaExtraInformation {
    pub volume: Option<i32>,
    pub chapter: Option<Decimal>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ReviewPostedEvent {
    pub obj_id: String,
    pub username: String,
    pub obj_title: String,
    pub review_id: String,
    pub entity_lot: EntityLot,
}

#[derive(
    Debug, PartialEq, Eq, Serialize, Deserialize, Clone, SimpleObject, FromJsonQueryResult,
)]
pub struct SeenShowExtraInformation {
    pub season: i32,
    pub episode: i32,
}

#[derive(
    Debug, PartialEq, Eq, Serialize, Deserialize, Clone, SimpleObject, FromJsonQueryResult,
)]
pub struct SeenPodcastExtraInformation {
    pub episode: i32,
}

#[derive(
    Debug, PartialEq, Eq, Serialize, Deserialize, Clone, SimpleObject, FromJsonQueryResult,
)]
pub struct SeenShowExtraOptionalInformation {
    pub season: Option<i32>,
    pub episode: Option<i32>,
}

#[derive(
    Debug, PartialEq, Eq, Serialize, Deserialize, Clone, SimpleObject, FromJsonQueryResult,
)]
pub struct SeenPodcastExtraOptionalInformation {
    pub episode: Option<i32>,
}

#[derive(
    Debug, PartialEq, Eq, Serialize, Deserialize, Clone, SimpleObject, FromJsonQueryResult,
)]
pub struct SeenAnimeExtraInformation {
    pub episode: Option<i32>,
}
