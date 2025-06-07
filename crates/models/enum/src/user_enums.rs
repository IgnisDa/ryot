use async_graphql::Enum;
use schematic::ConfigEnum;
use sea_orm::{DeriveActiveEnum, EnumIter};
use sea_orm_migration::prelude::*;
use serde::{Deserialize, Serialize};
use strum::Display;

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, EnumIter, DeriveActiveEnum, Deserialize, Serialize, Enum,
)]
#[sea_orm(
    rs_type = "String",
    rename_all = "snake_case",
    db_type = "String(StringLen::None)"
)]
pub enum UserLot {
    Admin,
    Normal,
}

#[derive(
    Eq,
    Ord,
    Hash,
    Copy,
    Enum,
    Debug,
    Clone,
    Display,
    Default,
    EnumIter,
    PartialEq,
    Serialize,
    PartialOrd,
    Deserialize,
    DeriveActiveEnum,
)]
#[sea_orm(
    rs_type = "String",
    rename_all = "snake_case",
    db_type = "String(StringLen::None)"
)]
#[serde(rename_all = "snake_case")]
pub enum EntityLot {
    #[default]
    Metadata,
    Person,
    Review,
    Workout,
    Exercise,
    Collection,
    MetadataGroup,
    WorkoutTemplate,
    UserMeasurement,
}

// The different possible states of a seen item.
#[derive(
    Eq,
    Enum,
    Copy,
    Debug,
    Clone,
    Display,
    EnumIter,
    PartialEq,
    Serialize,
    Deserialize,
    DeriveActiveEnum,
)]
#[sea_orm(
    rs_type = "String",
    rename_all = "snake_case",
    db_type = "String(StringLen::None)"
)]
pub enum SeenState {
    Dropped,
    OnAHold,
    Completed,
    InProgress,
}

#[derive(
    Eq,
    Enum,
    Copy,
    Debug,
    Clone,
    Default,
    EnumIter,
    PartialEq,
    Serialize,
    ConfigEnum,
    Deserialize,
    DeriveActiveEnum,
)]
#[sea_orm(
    rs_type = "String",
    rename_all = "snake_case",
    db_type = "String(StringLen::None)"
)]
pub enum Visibility {
    #[default]
    Public,
    Private,
}

#[derive(
    Eq,
    Enum,
    Copy,
    Debug,
    Clone,
    Display,
    EnumIter,
    PartialEq,
    Serialize,
    Deserialize,
    DeriveActiveEnum,
)]
#[sea_orm(
    rs_type = "String",
    rename_all = "snake_case",
    db_type = "String(StringLen::None)"
)]
pub enum ImportSource {
    Igdb,
    Imdb,
    Plex,
    Hevy,
    Trakt,
    Movary,
    Anilist,
    Jellyfin,
    OpenScale,
    StrongApp,
    Goodreads,
    Storygraph,
    Myanimelist,
    GenericJson,
    Mediatracker,
    Audiobookshelf,
}

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
#[strum(serialize_all = "snake_case")]
pub enum UserToMediaReason {
    // There is at-least one element in the seen history
    Seen,
    Owned,
    // User has watched this media completely (mostly applies to shows, podcasts etc.)
    Finished,
    Reviewed,
    Reminder,
    Watchlist,
    Collection,
    Monitoring,
}
