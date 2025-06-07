use async_graphql::SimpleObject;
use enum_models::{ExerciseEquipment, ExerciseForce, ExerciseLevel, ExerciseLot, ExerciseMuscle};
use schematic::Schematic;
use sea_orm::FromJsonQueryResult;
use serde::{Deserialize, Serialize};
use serde_with::skip_serializing_none;

use crate::{UserUnitSystem, WorkoutOrExerciseTotals, WorkoutSetRecord};

/// The summary about an exercise done in a workout.
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
pub struct WorkoutSummaryExercise {
    pub id: String,
    pub num_sets: usize,
    pub lot: Option<ExerciseLot>,
    pub unit_system: UserUnitSystem,
    pub best_set: Option<WorkoutSetRecord>,
}

#[derive(
    Clone,
    Debug,
    Deserialize,
    Serialize,
    FromJsonQueryResult,
    Eq,
    PartialEq,
    Default,
    SimpleObject,
    Schematic,
)]
pub struct WorkoutLotFocusedSummary {
    pub lot: ExerciseLot,
    pub exercises: Vec<usize>,
}

#[derive(
    Clone,
    Debug,
    Deserialize,
    Serialize,
    FromJsonQueryResult,
    Eq,
    PartialEq,
    Default,
    SimpleObject,
    Schematic,
)]
pub struct WorkoutLevelFocusedSummary {
    pub level: ExerciseLevel,
    pub exercises: Vec<usize>,
}

#[derive(
    Clone,
    Debug,
    Deserialize,
    Serialize,
    FromJsonQueryResult,
    Eq,
    PartialEq,
    Default,
    SimpleObject,
    Schematic,
)]
pub struct WorkoutEquipmentFocusedSummary {
    pub exercises: Vec<usize>,
    pub equipment: ExerciseEquipment,
}

#[derive(
    Clone,
    Debug,
    Deserialize,
    Serialize,
    FromJsonQueryResult,
    Eq,
    PartialEq,
    Default,
    SimpleObject,
    Schematic,
)]
pub struct WorkoutForceFocusedSummary {
    pub force: ExerciseForce,
    pub exercises: Vec<usize>,
}

#[derive(
    Clone,
    Debug,
    Deserialize,
    Serialize,
    FromJsonQueryResult,
    Eq,
    PartialEq,
    Default,
    SimpleObject,
    Schematic,
)]
pub struct WorkoutMuscleFocusedSummary {
    pub exercises: Vec<usize>,
    pub muscle: ExerciseMuscle,
}

#[derive(
    Clone,
    Debug,
    Deserialize,
    Serialize,
    FromJsonQueryResult,
    Eq,
    PartialEq,
    Default,
    SimpleObject,
    Schematic,
)]
#[serde(rename_all = "snake_case")]
pub struct WorkoutFocusedSummary {
    pub lots: Vec<WorkoutLotFocusedSummary>,
    pub levels: Vec<WorkoutLevelFocusedSummary>,
    pub forces: Vec<WorkoutForceFocusedSummary>,
    pub muscles: Vec<WorkoutMuscleFocusedSummary>,
    pub equipments: Vec<WorkoutEquipmentFocusedSummary>,
}

#[skip_serializing_none]
#[derive(
    Clone,
    Debug,
    Deserialize,
    Serialize,
    FromJsonQueryResult,
    Eq,
    PartialEq,
    Default,
    SimpleObject,
    Schematic,
)]
#[serde(rename_all = "snake_case")]
pub struct WorkoutSummary {
    pub focused: WorkoutFocusedSummary,
    // DEV: This is nullable because it is also used for the workout templates
    pub total: Option<WorkoutOrExerciseTotals>,
    pub exercises: Vec<WorkoutSummaryExercise>,
}
