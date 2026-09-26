use async_graphql::{Enum, InputObject, SimpleObject};
use common_models::EntityAssets;
use derive_more::with_trait::{Add, AddAssign, Sum};
use enum_models::{ExerciseLot, WorkoutSetPersonalBest};
use rust_decimal::Decimal;
use schematic::{ConfigEnum, Schematic};
use sea_orm::{FromJsonQueryResult, prelude::DateTimeUtc};
use serde::{Deserialize, Serialize};
use serde_with::skip_serializing_none;

/// The types of set (mostly characterized by exertion level).
#[derive(
    Eq,
    Enum,
    Copy,
    Clone,
    Debug,
    Default,
    Serialize,
    PartialEq,
    ConfigEnum,
    Deserialize,
    FromJsonQueryResult,
)]
#[serde(rename_all = "snake_case")]
pub enum SetLot {
    Drop,
    #[default]
    Normal,
    WarmUp,
    Failure,
}

/// Details about the statistics of the set performed.
#[skip_serializing_none]
#[derive(
    Eq,
    Clone,
    Debug,
    Default,
    Serialize,
    Schematic,
    PartialEq,
    Deserialize,
    InputObject,
    SimpleObject,
    FromJsonQueryResult,
)]
#[graphql(input_name = "SetStatisticInput")]
#[serde(rename_all = "snake_case")]
pub struct WorkoutSetStatistic {
    pub reps: Option<Decimal>,
    pub pace: Option<Decimal>,
    pub weight: Option<Decimal>,
    pub one_rm: Option<Decimal>,
    pub volume: Option<Decimal>,
    pub duration: Option<Decimal>,
    pub distance: Option<Decimal>,
}

#[skip_serializing_none]
#[derive(
    Eq,
    Clone,
    Debug,
    Default,
    Schematic,
    Serialize,
    PartialEq,
    Deserialize,
    SimpleObject,
    FromJsonQueryResult,
)]
#[serde(rename_all = "snake_case")]
pub struct WorkoutSetTotals {
    pub weight: Option<Decimal>,
}

/// Details about the set performed.
#[skip_serializing_none]
#[derive(
    Eq,
    Clone,
    Debug,
    Default,
    Serialize,
    Schematic,
    PartialEq,
    Deserialize,
    SimpleObject,
    FromJsonQueryResult,
)]
#[serde(rename_all = "snake_case")]
pub struct WorkoutSetRecord {
    pub lot: SetLot,
    pub rpe: Option<u8>,
    pub note: Option<String>,
    pub rest_time: Option<u16>,
    pub statistic: WorkoutSetStatistic,
    pub totals: Option<WorkoutSetTotals>,
    pub confirmed_at: Option<DateTimeUtc>,
    pub rest_timer_started_at: Option<DateTimeUtc>,
    pub personal_bests: Option<Vec<WorkoutSetPersonalBest>>,
}

#[skip_serializing_none]
#[derive(
    Eq,
    Clone,
    Debug,
    Default,
    PartialEq,
    Schematic,
    Serialize,
    InputObject,
    Deserialize,
    SimpleObject,
    FromJsonQueryResult,
)]
#[serde(rename_all = "snake_case")]
#[graphql(input_name = "WorkoutSupersetsInformationInput")]
pub struct WorkoutSupersetsInformation {
    /// A color that will be displayed on the frontend.
    pub color: String,
    /// The identifier of all the exercises which are in the same superset
    pub exercises: Vec<u16>,
}

/// Information about a workout done.
#[skip_serializing_none]
#[derive(
    Eq,
    Clone,
    Debug,
    Default,
    PartialEq,
    Schematic,
    Serialize,
    Deserialize,
    SimpleObject,
    FromJsonQueryResult,
)]
#[serde(rename_all = "snake_case")]
pub struct WorkoutInformation {
    pub comment: Option<String>,
    pub assets: Option<EntityAssets>,
    pub exercises: Vec<ProcessedExercise>,
    pub supersets: Vec<WorkoutSupersetsInformation>,
}

/// The totals of a workout and the different bests achieved.
#[derive(
    Eq,
    Sum,
    Add,
    Debug,
    Clone,
    Default,
    Serialize,
    PartialEq,
    AddAssign,
    Schematic,
    Deserialize,
    SimpleObject,
    FromJsonQueryResult,
)]
#[serde(rename_all = "snake_case")]
pub struct WorkoutOrExerciseTotals {
    pub reps: Decimal,
    /// The total seconds that were logged in the rest timer.
    #[serde(default)]
    pub rest_time: u16,
    pub weight: Decimal,
    pub distance: Decimal,
    pub duration: Decimal,
    /// The number of personal bests achieved.
    pub personal_bests_achieved: usize,
}

/// An exercise that has been processed and committed to the database.
#[skip_serializing_none]
#[derive(
    Eq,
    Clone,
    Debug,
    Default,
    Schematic,
    Serialize,
    PartialEq,
    Deserialize,
    SimpleObject,
    FromJsonQueryResult,
)]
#[serde(rename_all = "snake_case")]
pub struct ProcessedExercise {
    pub id: String,
    pub lot: ExerciseLot,
    pub notes: Vec<String>,
    pub sets: Vec<WorkoutSetRecord>,
    pub unit_system: UserUnitSystem,
    pub assets: Option<EntityAssets>,
    pub total: Option<WorkoutOrExerciseTotals>,
}

#[derive(
    Eq,
    Copy,
    Enum,
    Clone,
    Debug,
    Default,
    PartialEq,
    Serialize,
    ConfigEnum,
    Deserialize,
    FromJsonQueryResult,
)]
pub enum UserUnitSystem {
    #[default]
    Metric,
    Imperial,
}
