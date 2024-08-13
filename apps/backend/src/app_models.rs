use std::{
    collections::{HashMap, HashSet},
    fmt,
    sync::Arc,
};

use async_graphql::{Enum, InputObject, OutputType, Result as GraphqlResult, SimpleObject, Union};
use async_trait::async_trait;
use chrono::{DateTime, NaiveDate};
use common_models::StoredUrl;
use derive_more::{Add, AddAssign, Sum};
use enum_meta::{meta, Meta};
use enums::{
    EntityLot, ExerciseEquipment, ExerciseForce, ExerciseLevel, ExerciseLot, ExerciseMechanic,
    ExerciseMuscle, MediaLot, MediaSource, SeenState, Visibility,
};
use file_storage_service::FileStorageService;
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use schematic::ConfigEnum;
use schematic::Schematic;
use sea_orm::{prelude::DateTimeUtc, EnumIter, FromJsonQueryResult, FromQueryResult};
use serde::{de, Deserialize, Serialize};
use serde_with::skip_serializing_none;
use strum::Display;

use crate::{
    entities::{user_measurement, workout},
    traits::{DatabaseAssetsAsSingleUrl, DatabaseAssetsAsUrls, GraphqlRepresentation},
};

pub mod audiobookshelf_models {
    use super::*;

    #[derive(Debug, Serialize, Deserialize, Clone, Display)]
    #[serde(rename_all = "snake_case")]
    pub enum MediaType {
        Book,
        Podcast,
    }

    #[derive(Debug, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct ItemProgress {
        pub progress: Decimal,
        pub is_finished: bool,
        pub ebook_progress: Option<Decimal>,
    }

    #[derive(Debug, Serialize, Deserialize, Clone)]
    #[serde(rename_all = "camelCase")]
    pub struct ItemMetadata {
        pub title: String,
        pub id: Option<String>,
        pub asin: Option<String>,
        pub isbn: Option<String>,
        pub itunes_id: Option<String>,
    }

    #[derive(Debug, Serialize, Deserialize, Clone)]
    #[serde(rename_all = "camelCase")]
    pub struct ItemMedia {
        pub metadata: ItemMetadata,
        pub ebook_format: Option<String>,
        pub episodes: Option<Vec<ItemMetadata>>,
    }

    #[derive(Debug, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct RecentEpisode {
        pub id: String,
        pub title: String,
        pub season: Option<String>,
        pub episode: Option<String>,
    }

    #[derive(Debug, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Item {
        pub id: String,
        pub name: Option<String>,
        pub media: Option<ItemMedia>,
        pub media_type: Option<MediaType>,
        pub recent_episode: Option<RecentEpisode>,
        pub user_media_progress: Option<ItemProgress>,
    }

    #[derive(Debug, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Response {
        pub library_items: Vec<Item>,
    }

    #[derive(Debug, Serialize, Deserialize)]
    pub struct LibrariesListResponse {
        pub libraries: Vec<Item>,
    }

    #[derive(Debug, Serialize, Deserialize)]
    pub struct ListResponse {
        pub results: Vec<Item>,
    }
}
