use async_graphql::{InputObject, SimpleObject};
use common_models::SearchInput;
use enum_models::{MediaLot, MediaSource};
use schematic::Schematic;
use sea_orm::FromJsonQueryResult;
use serde::{Deserialize, Serialize};
use serde_with::skip_serializing_none;

#[skip_serializing_none]
#[derive(
    Eq,
    Hash,
    Clone,
    Debug,
    Default,
    Schematic,
    PartialEq,
    Serialize,
    Deserialize,
    InputObject,
    SimpleObject,
    FromJsonQueryResult,
)]
#[graphql(input_name = "MetadataSearchSourceGoogleBooksSpecifics")]
#[serde(rename_all = "snake_case")]
pub struct MetadataSearchSourceGoogleBooksSpecifics {
    pub pass_raw_query: Option<bool>,
}

#[skip_serializing_none]
#[derive(
    Eq,
    Hash,
    Clone,
    Debug,
    Default,
    Schematic,
    PartialEq,
    Serialize,
    Deserialize,
    InputObject,
    SimpleObject,
    FromJsonQueryResult,
)]
#[graphql(input_name = "MetadataSearchSourceIgdbFilterSpecifics")]
#[serde(rename_all = "snake_case")]
pub struct MetadataSearchSourceIgdbFilterSpecifics {
    pub theme_ids: Option<Vec<String>>,
    pub genre_ids: Option<Vec<String>>,
    pub platform_ids: Option<Vec<String>>,
    pub game_mode_ids: Option<Vec<String>>,
    pub game_type_ids: Option<Vec<String>>,
    pub allow_games_with_parent: Option<bool>,
    pub release_date_region_ids: Option<Vec<String>>,
}

#[skip_serializing_none]
#[derive(
    Eq,
    Hash,
    Clone,
    Debug,
    Default,
    Schematic,
    PartialEq,
    Serialize,
    Deserialize,
    InputObject,
    SimpleObject,
    FromJsonQueryResult,
)]
#[graphql(input_name = "MetadataSearchSourceIgdbSpecifics")]
#[serde(rename_all = "snake_case")]
pub struct MetadataSearchSourceIgdbSpecifics {
    pub filters: Option<MetadataSearchSourceIgdbFilterSpecifics>,
}

#[skip_serializing_none]
#[derive(
    Eq,
    Hash,
    Clone,
    Debug,
    Default,
    Schematic,
    PartialEq,
    Serialize,
    Deserialize,
    InputObject,
    SimpleObject,
    FromJsonQueryResult,
)]
#[graphql(input_name = "MetadataSearchSourceSpecificsInput")]
#[serde(rename_all = "snake_case")]
pub struct MetadataSearchSourceSpecifics {
    pub igdb: Option<MetadataSearchSourceIgdbSpecifics>,
    pub google_books: Option<MetadataSearchSourceGoogleBooksSpecifics>,
}

#[skip_serializing_none]
#[derive(
    Clone, Hash, Debug, PartialEq, InputObject, FromJsonQueryResult, Eq, Serialize, Deserialize,
)]
pub struct MetadataSearchInput {
    pub lot: MediaLot,
    pub search: SearchInput,
    pub source: MediaSource,
    pub source_specifics: Option<MetadataSearchSourceSpecifics>,
}
