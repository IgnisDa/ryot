use async_graphql::{InputObject, SimpleObject};
use common_models::EntityAssets;
use educe::Educe;
use enum_models::{ExerciseDurationUnit, WorkoutSetPersonalBest};
use rust_decimal::Decimal;
use schematic::Schematic;
use sea_orm::{FromJsonQueryResult, prelude::DateTimeUtc};
use serde::{Deserialize, Serialize};
use serde_with::skip_serializing_none;

use crate::{WorkoutOrExerciseTotals, WorkoutSetRecord};

#[skip_serializing_none]
#[derive(
    Eq,
    Debug,
    Clone,
    Default,
    PartialEq,
    Schematic,
    Serialize,
    InputObject,
    Deserialize,
    SimpleObject,
    FromJsonQueryResult,
)]
#[graphql(input_name = "UserMeasurementStatisticInput")]
#[serde(rename_all = "snake_case")]
pub struct UserMeasurementStatistic {
    pub name: String,
    pub value: Decimal,
}

/// The actual statistics that were logged in a user measurement.
#[skip_serializing_none]
#[derive(
    Eq,
    Debug,
    Clone,
    Default,
    PartialEq,
    Schematic,
    Serialize,
    InputObject,
    Deserialize,
    SimpleObject,
    FromJsonQueryResult,
)]
#[graphql(input_name = "UserMeasurementInformationInput")]
#[serde(rename_all = "snake_case")]
pub struct UserMeasurementInformation {
    pub assets: EntityAssets,
    pub statistics: Vec<UserMeasurementStatistic>,
}

#[skip_serializing_none]
#[derive(
    Debug, Clone, Serialize, Deserialize, FromJsonQueryResult, Eq, PartialEq, SimpleObject, Default,
)]
pub struct UserToExerciseHistoryExtraInformation {
    pub idx: usize,
    pub workout_id: String,
    pub workout_end_on: DateTimeUtc,
    pub best_set: Option<WorkoutSetRecord>,
}

#[derive(
    Clone, Debug, Deserialize, Serialize, FromJsonQueryResult, Eq, PartialEq, SimpleObject,
)]
pub struct ExerciseBestSetRecord {
    pub workout_id: String,
    pub exercise_idx: usize,
    pub set_idx: usize,
}

#[derive(
    Debug, Clone, Serialize, Deserialize, FromJsonQueryResult, Eq, PartialEq, SimpleObject, Default,
)]
pub struct UserToExerciseBestSetExtraInformation {
    pub lot: WorkoutSetPersonalBest,
    pub sets: Vec<ExerciseBestSetRecord>,
}

#[skip_serializing_none]
#[derive(
    Eq,
    Educe,
    Debug,
    Clone,
    PartialEq,
    Serialize,
    Deserialize,
    InputObject,
    SimpleObject,
    FromJsonQueryResult,
)]
#[graphql(input_name = "SetRestTimersSettingsInput")]
#[educe(Default)]
pub struct SetRestTimersSettings {
    pub drop: Option<u16>,
    pub warmup: Option<u16>,
    #[educe(Default = Some(60))]
    pub normal: Option<u16>,
    pub failure: Option<u16>,
}

#[derive(
    Eq,
    Debug,
    Clone,
    Default,
    PartialEq,
    Serialize,
    Deserialize,
    InputObject,
    SimpleObject,
    FromJsonQueryResult,
)]
#[graphql(input_name = "UserToExerciseSettingsExtraInformationInput")]
pub struct UserToExerciseSettingsExtraInformation {
    pub exclude_from_analytics: bool,
    pub set_rest_timers: SetRestTimersSettings,
    pub default_duration_unit: ExerciseDurationUnit,
}

#[derive(
    Debug, Clone, Serialize, Deserialize, FromJsonQueryResult, Eq, PartialEq, SimpleObject, Default,
)]
pub struct UserToExerciseExtraInformation {
    pub lifetime_stats: WorkoutOrExerciseTotals,
    pub settings: UserToExerciseSettingsExtraInformation,
    pub history: Vec<UserToExerciseHistoryExtraInformation>,
    pub personal_bests: Vec<UserToExerciseBestSetExtraInformation>,
}
