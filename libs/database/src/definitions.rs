use async_graphql::Enum;
use schematic::ConfigEnum;
use sea_orm::{DeriveActiveEnum, EnumIter, FromJsonQueryResult};
use sea_orm_migration::prelude::*;
use serde::{Deserialize, Serialize};
use strum::Display;

/// The different types of media that can be stored.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    EnumIter,
    DeriveActiveEnum,
    Deserialize,
    Serialize,
    Enum,
    Default,
    Hash,
    ConfigEnum,
)]
#[sea_orm(
    rs_type = "String",
    db_type = "String(StringLen::None)",
    rename_all = "snake_case"
)]
#[serde(rename_all = "snake_case")]
pub enum MediaLot {
    AudioBook,
    Anime,
    #[default]
    Book,
    Podcast,
    Manga,
    Movie,
    Show,
    VideoGame,
    VisualNovel,
}

/// The different sources (or providers) from which data can be obtained from.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    EnumIter,
    DeriveActiveEnum,
    Deserialize,
    Serialize,
    Enum,
    Default,
    Hash,
    ConfigEnum,
)]
#[sea_orm(
    rs_type = "String",
    db_type = "String(StringLen::None)",
    rename_all = "snake_case"
)]
#[serde(rename_all = "snake_case")]
pub enum MediaSource {
    Anilist,
    #[default]
    Audible,
    Custom,
    GoogleBooks,
    Igdb,
    Itunes,
    Listennotes,
    MangaUpdates,
    Mal,
    Openlibrary,
    Tmdb,
    Vndb,
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, EnumIter, DeriveActiveEnum, Deserialize, Serialize, Enum,
)]
#[sea_orm(
    rs_type = "String",
    db_type = "String(StringLen::None)",
    rename_all = "snake_case"
)]
pub enum UserLot {
    Admin,
    Normal,
}

// The different possible states of a seen item.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, EnumIter, DeriveActiveEnum, Deserialize, Serialize, Enum,
)]
#[sea_orm(
    rs_type = "String",
    db_type = "String(StringLen::None)",
    rename_all = "snake_case"
)]
pub enum SeenState {
    Completed,
    Dropped,
    InProgress,
    OnAHold,
}

#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    EnumIter,
    DeriveActiveEnum,
    Deserialize,
    Serialize,
    Enum,
    Default,
    ConfigEnum,
)]
#[sea_orm(
    rs_type = "String",
    db_type = "String(StringLen::None)",
    rename_all = "snake_case"
)]
pub enum Visibility {
    #[default]
    Public,
    Private,
}

#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    EnumIter,
    DeriveActiveEnum,
    Deserialize,
    Serialize,
    Enum,
    Display,
)]
#[sea_orm(
    rs_type = "String",
    db_type = "String(StringLen::None)",
    rename_all = "snake_case"
)]
pub enum ImportSource {
    Audiobookshelf,
    GenericJson,
    Goodreads,
    Imdb,
    Jellyfin,
    Mal,
    Movary,
    MediaTracker,
    OpenScale,
    StrongApp,
    StoryGraph,
    Trakt,
}

#[derive(
    Debug,
    Clone,
    Serialize,
    Enum,
    Copy,
    Deserialize,
    FromJsonQueryResult,
    Eq,
    PartialEq,
    Display,
    EnumIter,
    PartialOrd,
    Ord,
)]
#[serde(rename_all = "snake_case")]
pub enum ExerciseMuscle {
    Abdominals,
    Abductors,
    Adductors,
    Biceps,
    Calves,
    Chest,
    Forearms,
    Glutes,
    Hamstrings,
    Lats,
    #[strum(serialize = "lower_back")]
    #[serde(alias = "lower back")]
    LowerBack,
    #[strum(serialize = "middle_back")]
    #[serde(alias = "middle back")]
    MiddleBack,
    Neck,
    Quadriceps,
    Shoulders,
    Traps,
    Triceps,
}

#[derive(
    Debug, Clone, Serialize, Enum, Copy, Deserialize, DeriveActiveEnum, EnumIter, Eq, PartialEq,
)]
#[sea_orm(
    rs_type = "String",
    db_type = "String(StringLen::None)",
    rename_all = "snake_case"
)]
#[serde(rename_all = "snake_case")]
pub enum ExerciseForce {
    Pull,
    Push,
    Static,
}

#[derive(
    Debug, Clone, Serialize, Enum, Copy, Deserialize, DeriveActiveEnum, EnumIter, Eq, PartialEq,
)]
#[sea_orm(
    rs_type = "String",
    db_type = "String(StringLen::None)",
    rename_all = "snake_case"
)]
#[serde(rename_all = "snake_case")]
pub enum ExerciseLevel {
    Beginner,
    Expert,
    Intermediate,
}

#[derive(
    Debug, Clone, Serialize, Enum, Copy, Deserialize, DeriveActiveEnum, EnumIter, Eq, PartialEq,
)]
#[sea_orm(
    rs_type = "String",
    db_type = "String(StringLen::None)",
    rename_all = "snake_case"
)]
#[serde(rename_all = "snake_case")]
pub enum ExerciseMechanic {
    Compound,
    Isolation,
}

#[derive(
    Debug, Clone, Serialize, Enum, Copy, Deserialize, DeriveActiveEnum, EnumIter, Eq, PartialEq,
)]
#[sea_orm(
    rs_type = "String",
    db_type = "String(StringLen::None)",
    rename_all = "snake_case"
)]
#[serde(rename_all = "snake_case")]
pub enum ExerciseEquipment {
    Bands,
    Barbell,
    BodyOnly,
    Cable,
    Dumbbell,
    #[serde(alias = "exercise ball")]
    ExerciseBall,
    #[serde(alias = "e-z curl bar")]
    EZCurlBar,
    #[serde(alias = "foam roll")]
    FoamRoll,
    #[serde(alias = "body only")]
    Kettlebells,
    Machine,
    #[serde(alias = "medicine ball")]
    MedicineBall,
    Other,
}

/// The different types of exercises that can be done.
#[derive(
    Clone,
    Debug,
    Deserialize,
    Serialize,
    DeriveActiveEnum,
    Eq,
    PartialEq,
    Enum,
    Copy,
    EnumIter,
    ConfigEnum,
)]
#[sea_orm(
    rs_type = "String",
    db_type = "String(StringLen::None)",
    rename_all = "snake_case"
)]
#[serde(rename_all = "snake_case")]
pub enum ExerciseLot {
    Duration,
    DistanceAndDuration,
    Reps,
    RepsAndWeight,
}

#[derive(
    Default,
    Clone,
    Debug,
    Deserialize,
    Serialize,
    DeriveActiveEnum,
    Eq,
    PartialEq,
    Enum,
    Copy,
    EnumIter,
)]
#[sea_orm(
    rs_type = "String",
    db_type = "String(StringLen::None)",
    rename_all = "snake_case"
)]
pub enum ExerciseSource {
    Github,
    #[default]
    Custom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, EnumIter, DeriveActiveEnum, Deserialize, Serialize)]
#[sea_orm(
    rs_type = "String",
    db_type = "String(StringLen::None)",
    rename_all = "snake_case"
)]
pub enum MetadataToMetadataRelation {
    Suggestion,
}

#[derive(
    Copy,
    Clone,
    Debug,
    Enum,
    PartialEq,
    Eq,
    DeriveActiveEnum,
    EnumIter,
    Serialize,
    Deserialize,
    Hash,
    Display,
)]
#[sea_orm(
    rs_type = "String",
    db_type = "String(StringLen::None)",
    rename_all = "snake_case"
)]
#[strum(serialize_all = "snake_case")]
pub enum UserToMediaReason {
    Seen,
    Reviewed,
    Collection,
    Reminder,
    Owned,
    Monitoring,
    Watchlist,
}

#[derive(
    Copy,
    Clone,
    Debug,
    Enum,
    PartialEq,
    Eq,
    DeriveActiveEnum,
    EnumIter,
    Serialize,
    Deserialize,
    Hash,
    Display,
)]
#[sea_orm(
    rs_type = "String",
    db_type = "String(StringLen::None)",
    rename_all = "snake_case"
)]
#[serde(rename_all = "snake_case")]
pub enum IntegrationLot {
    Yank,
    Sink,
}

#[derive(
    Copy,
    Clone,
    Debug,
    Enum,
    PartialEq,
    Eq,
    DeriveActiveEnum,
    EnumIter,
    Serialize,
    Deserialize,
    Hash,
    Display,
)]
#[sea_orm(
    rs_type = "String",
    db_type = "String(StringLen::None)",
    rename_all = "snake_case"
)]
#[serde(rename_all = "snake_case")]
pub enum IntegrationSource {
    Audiobookshelf,
    Jellyfin,
    Plex,
    Kodi,
}
