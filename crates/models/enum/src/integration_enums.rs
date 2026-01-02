use async_graphql::Enum;
use sea_orm::{DeriveActiveEnum, EnumIter};
use sea_orm_migration::prelude::StringLen;
use serde::{Deserialize, Serialize};
use strum::Display;

#[derive(
    Eq,
    Enum,
    Copy,
    Hash,
    Clone,
    Debug,
    Display,
    EnumIter,
    Serialize,
    PartialEq,
    Deserialize,
    DeriveActiveEnum,
)]
#[sea_orm(
    rs_type = "String",
    rename_all = "snake_case",
    db_type = "String(StringLen::None)"
)]
#[serde(rename_all = "snake_case")]
pub enum IntegrationLot {
    Yank,
    Sink,
    Push,
}

#[derive(
    Eq,
    Copy,
    Hash,
    Enum,
    Clone,
    Debug,
    Display,
    EnumIter,
    Serialize,
    PartialEq,
    Deserialize,
    DeriveActiveEnum,
)]
#[sea_orm(
    rs_type = "String",
    rename_all = "snake_case",
    db_type = "String(StringLen::None)"
)]
#[serde(rename_all = "snake_case")]
pub enum IntegrationProvider {
    Emby,
    Kodi,
    Komga,
    Radarr,
    Sonarr,
    PlexSink,
    PlexYank,
    GenericJson,
    YoutubeMusic,
    JellyfinPush,
    JellyfinSink,
    Audiobookshelf,
    RyotBrowserExtension,
}
