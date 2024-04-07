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
#[sea_orm(rs_type = "String", db_type = "String(None)")]
#[config(rename_all = "PascalCase")]
pub enum MediaLot {
    #[sea_orm(string_value = "AB")]
    AudioBook,
    #[sea_orm(string_value = "AN")]
    Anime,
    #[default]
    #[sea_orm(string_value = "BO")]
    Book,
    #[sea_orm(string_value = "PO")]
    Podcast,
    #[sea_orm(string_value = "MA")]
    Manga,
    #[sea_orm(string_value = "MO")]
    Movie,
    #[sea_orm(string_value = "SH")]
    Show,
    #[sea_orm(string_value = "VG")]
    VideoGame,
    #[sea_orm(string_value = "VN")]
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
#[sea_orm(rs_type = "String", db_type = "String(None)")]
#[config(rename_all = "PascalCase")]
pub enum MediaSource {
    #[sea_orm(string_value = "AN")]
    Anilist,
    #[default]
    #[sea_orm(string_value = "AU")]
    Audible,
    #[sea_orm(string_value = "CU")]
    Custom,
    #[sea_orm(string_value = "GO")]
    GoogleBooks,
    #[sea_orm(string_value = "IG")]
    Igdb,
    #[sea_orm(string_value = "IT")]
    Itunes,
    #[sea_orm(string_value = "LI")]
    Listennotes,
    #[sea_orm(string_value = "MU")]
    MangaUpdates,
    #[sea_orm(string_value = "MY")]
    Mal,
    #[sea_orm(string_value = "OL")]
    Openlibrary,
    #[sea_orm(string_value = "TM")]
    Tmdb,
    #[sea_orm(string_value = "VN")]
    Vndb,
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, EnumIter, DeriveActiveEnum, Deserialize, Serialize, Enum,
)]
#[sea_orm(rs_type = "String", db_type = "String(None)")]
pub enum UserLot {
    #[sea_orm(string_value = "A")]
    Admin,
    #[sea_orm(string_value = "N")]
    Normal,
}

// The different possible states of a seen item.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, EnumIter, DeriveActiveEnum, Deserialize, Serialize, Enum,
)]
#[sea_orm(rs_type = "String", db_type = "String(None)")]
pub enum SeenState {
    #[sea_orm(string_value = "CO")]
    Completed,
    #[sea_orm(string_value = "DR")]
    Dropped,
    #[sea_orm(string_value = "IP")]
    InProgress,
    #[sea_orm(string_value = "OH")]
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
#[sea_orm(rs_type = "String", db_type = "String(None)")]
pub enum Visibility {
    #[default]
    #[sea_orm(string_value = "PU")]
    Public,
    #[sea_orm(string_value = "PR")]
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
#[sea_orm(rs_type = "String", db_type = "String(None)")]
pub enum ImportSource {
    #[sea_orm(string_value = "AB")]
    Audiobookshelf,
    #[sea_orm(string_value = "GO")]
    Goodreads,
    #[sea_orm(string_value = "IM")]
    Imdb,
    #[sea_orm(string_value = "MA")]
    Mal,
    #[sea_orm(string_value = "MEJ")]
    MeasurementsJson,
    #[sea_orm(string_value = "MT")]
    MediaTracker,
    #[sea_orm(string_value = "MJ")]
    MediaJson,
    #[sea_orm(string_value = "MGJ")]
    MediaGroupJson,
    #[sea_orm(string_value = "PJ")]
    PeopleJson,
    #[sea_orm(string_value = "TR")]
    Trakt,
    #[sea_orm(string_value = "MO")]
    Movary,
    #[sea_orm(string_value = "ST")]
    StoryGraph,
    #[sea_orm(string_value = "SA")]
    StrongApp,
    #[sea_orm(string_value = "WJ")]
    WorkoutsJson,
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
#[sea_orm(rs_type = "String", db_type = "String(None)")]
#[serde(rename_all = "snake_case")]
pub enum ExerciseForce {
    #[sea_orm(string_value = "PUL")]
    Pull,
    #[sea_orm(string_value = "PUS")]
    Push,
    #[sea_orm(string_value = "S")]
    Static,
}

#[derive(
    Debug, Clone, Serialize, Enum, Copy, Deserialize, DeriveActiveEnum, EnumIter, Eq, PartialEq,
)]
#[sea_orm(rs_type = "String", db_type = "String(None)")]
#[serde(rename_all = "snake_case")]
pub enum ExerciseLevel {
    #[sea_orm(string_value = "B")]
    Beginner,
    #[sea_orm(string_value = "E")]
    Expert,
    #[sea_orm(string_value = "I")]
    Intermediate,
}

#[derive(
    Debug, Clone, Serialize, Enum, Copy, Deserialize, DeriveActiveEnum, EnumIter, Eq, PartialEq,
)]
#[sea_orm(rs_type = "String", db_type = "String(None)")]
#[serde(rename_all = "snake_case")]
pub enum ExerciseMechanic {
    #[sea_orm(string_value = "C")]
    Compound,
    #[sea_orm(string_value = "I")]
    Isolation,
}

#[derive(
    Debug, Clone, Serialize, Enum, Copy, Deserialize, DeriveActiveEnum, EnumIter, Eq, PartialEq,
)]
#[sea_orm(rs_type = "String", db_type = "String(None)")]
#[serde(rename_all = "snake_case")]
pub enum ExerciseEquipment {
    #[sea_orm(string_value = "BAN")]
    Bands,
    #[sea_orm(string_value = "BAR")]
    Barbell,
    #[sea_orm(string_value = "BO")]
    BodyOnly,
    #[sea_orm(string_value = "C")]
    Cable,
    #[sea_orm(string_value = "D")]
    Dumbbell,
    #[sea_orm(string_value = "EX")]
    #[serde(alias = "exercise ball")]
    ExerciseBall,
    #[sea_orm(string_value = "EZ")]
    #[serde(alias = "e-z curl bar")]
    EZCurlBar,
    #[sea_orm(string_value = "F")]
    #[serde(alias = "foam roll")]
    FoamRoll,
    #[sea_orm(string_value = "K")]
    #[serde(alias = "body only")]
    Kettlebells,
    #[sea_orm(string_value = "MA")]
    Machine,
    #[sea_orm(string_value = "ME")]
    #[serde(alias = "medicine ball")]
    MedicineBall,
    #[sea_orm(string_value = "O")]
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
#[sea_orm(rs_type = "String", db_type = "String(None)")]
#[config(rename_all = "PascalCase")]
pub enum ExerciseLot {
    #[sea_orm(string_value = "D")]
    Duration,
    #[sea_orm(string_value = "DD")]
    DistanceAndDuration,
    #[sea_orm(string_value = "R")]
    Reps,
    #[sea_orm(string_value = "RW")]
    RepsAndWeight,
}

#[derive(
    Clone, Debug, Deserialize, Serialize, DeriveActiveEnum, Eq, PartialEq, Enum, Copy, EnumIter,
)]
#[sea_orm(rs_type = "String", db_type = "String(None)")]
pub enum ExerciseSource {
    #[sea_orm(string_value = "GH")]
    Github,
    #[sea_orm(string_value = "CU")]
    Custom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, EnumIter, DeriveActiveEnum, Deserialize, Serialize)]
#[sea_orm(rs_type = "String", db_type = "String(None)")]
pub enum MetadataToMetadataRelation {
    #[sea_orm(string_value = "SU")]
    Suggestion,
}
