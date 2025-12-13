use async_graphql::Enum;
use enum_meta::{Meta, meta};
use schematic::ConfigEnum;
use sea_orm::{DeriveActiveEnum, EnumIter, FromJsonQueryResult};
use sea_orm_migration::prelude::StringLen;
use serde::{Deserialize, Serialize};

#[derive(
    Eq,
    Copy,
    Enum,
    Hash,
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
#[serde(rename_all = "snake_case")]
pub enum ExerciseMuscle {
    Lats,
    Neck,
    Traps,
    Chest,
    Biceps,
    Calves,
    Glutes,
    Triceps,
    Forearms,
    Abductors,
    Adductors,
    #[strum(serialize = "lower_back")]
    #[serde(alias = "lower back")]
    LowerBack,
    Shoulders,
    #[default]
    Abdominals,
    Hamstrings,
    #[strum(serialize = "middle_back")]
    #[serde(alias = "middle back")]
    MiddleBack,
    Quadriceps,
}

#[derive(
    Eq,
    Copy,
    Enum,
    Hash,
    Clone,
    Debug,
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
#[serde(rename_all = "snake_case")]
pub enum ExerciseForce {
    #[default]
    Pull,
    Push,
    Static,
}

#[derive(
    Eq,
    Enum,
    Copy,
    Hash,
    Clone,
    Debug,
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
#[serde(rename_all = "snake_case")]
pub enum ExerciseLevel {
    #[default]
    Beginner,
    Expert,
    Intermediate,
}

#[derive(
    Eq,
    Hash,
    Enum,
    Copy,
    Debug,
    Clone,
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
#[serde(rename_all = "snake_case")]
pub enum ExerciseMechanic {
    Compound,
    Isolation,
}

#[derive(
    Eq,
    Hash,
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
#[serde(rename_all = "snake_case")]
pub enum ExerciseEquipment {
    Bands,
    Cable,
    Other,
    #[default]
    Barbell,
    Machine,
    #[serde(alias = "body only")]
    BodyOnly,
    Dumbbell,
    #[serde(alias = "foam roll")]
    FoamRoll,
    #[serde(alias = "e-z curl bar")]
    EZCurlBar,
    Kettlebells,
    #[serde(alias = "exercise ball")]
    ExerciseBall,
    #[serde(alias = "medicine ball")]
    MedicineBall,
}

/// The different types of exercises that can be done.
#[derive(
    Eq,
    Enum,
    Copy,
    Hash,
    Clone,
    Debug,
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
#[serde(rename_all = "snake_case")]
pub enum ExerciseLot {
    Reps,
    Duration,
    #[default]
    RepsAndWeight,
    RepsAndDuration,
    DistanceAndDuration,
    RepsAndDurationAndDistance,
}

meta! {
    ExerciseLot, Vec<WorkoutSetPersonalBest>;

    Reps, vec![WorkoutSetPersonalBest::Reps];
    Duration, vec![WorkoutSetPersonalBest::Time];
    RepsAndDuration, vec![
        WorkoutSetPersonalBest::Reps,
        WorkoutSetPersonalBest::Time
    ];
    DistanceAndDuration, vec![
        WorkoutSetPersonalBest::Pace,
        WorkoutSetPersonalBest::Time,
        WorkoutSetPersonalBest::Distance,
    ];
    RepsAndDurationAndDistance, vec![
        WorkoutSetPersonalBest::Reps,
        WorkoutSetPersonalBest::Pace,
        WorkoutSetPersonalBest::Time,
        WorkoutSetPersonalBest::Distance,
    ];
    RepsAndWeight, vec![
        WorkoutSetPersonalBest::Reps,
        WorkoutSetPersonalBest::OneRm,
        WorkoutSetPersonalBest::Weight,
        WorkoutSetPersonalBest::Volume,
    ];
}

#[derive(
    Eq,
    Enum,
    Copy,
    Hash,
    Debug,
    Clone,
    Default,
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
pub enum ExerciseSource {
    Github,
    #[default]
    Custom,
}

/// The different types of personal bests that can be achieved on a set.
#[derive(
    Eq,
    Enum,
    Copy,
    Clone,
    Debug,
    Default,
    PartialEq,
    Serialize,
    ConfigEnum,
    Deserialize,
    FromJsonQueryResult,
)]
#[serde(rename_all = "snake_case")]
pub enum WorkoutSetPersonalBest {
    Time,
    Pace,
    Reps,
    OneRm,
    Volume,
    #[default]
    Weight,
    Distance,
}
