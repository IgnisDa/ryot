use async_graphql::{Enum, InputObject, SimpleObject};
use sea_orm::{prelude::DateTimeUtc, FromJsonQueryResult};
use serde::{Deserialize, Serialize};

#[derive(
    Clone,
    Debug,
    Deserialize,
    Serialize,
    FromJsonQueryResult,
    Eq,
    PartialEq,
    SimpleObject,
    InputObject,
)]
#[graphql(input_name = "SetStatisticInput")]
pub struct SetStatistic {
    pub duration: Option<u16>,
    pub distance: Option<u16>,
    pub reps: Option<u16>,
    pub weight: Option<u16>,
}

#[derive(Clone, Debug, Deserialize, Serialize, FromJsonQueryResult, Eq, PartialEq, Enum, Copy)]
pub enum SetLot {
    Normal,
    WarmUp,
    Drop,
    Failure,
}

#[derive(Clone, Debug, Deserialize, Serialize, FromJsonQueryResult, Eq, PartialEq, Enum, Copy)]
pub enum WorkoutSetPersonalBest {
    Weight,
    OneRm,
    Volume,
}

#[derive(
    Clone, Debug, Deserialize, Serialize, FromJsonQueryResult, Eq, PartialEq, SimpleObject,
)]
pub struct WorkoutSetRecord {
    pub statistic: SetStatistic,
    pub lot: SetLot,
    pub personal_bests: Vec<WorkoutSetPersonalBest>,
}

#[derive(
    Debug, FromJsonQueryResult, Clone, Serialize, Deserialize, Eq, PartialEq, SimpleObject,
)]
pub struct WorkoutTotals {
    /// The number of personal bests achieved.
    pub personal_bests: u16,
    pub weight: u32,
    pub reps: u32,
    pub active_duration: u32,
}

#[derive(
    Clone, Debug, Deserialize, Serialize, FromJsonQueryResult, Eq, PartialEq, SimpleObject,
)]
pub struct ProcessedExercise {
    pub exercise_id: i32,
    pub sets: Vec<WorkoutSetRecord>,
    pub notes: Vec<String>,
    pub rest_time: Option<u16>,
    pub total: WorkoutTotals,
}

#[derive(
    Clone, Debug, Deserialize, Serialize, FromJsonQueryResult, Eq, PartialEq, SimpleObject,
)]
struct ProcessedWorkout {
    pub exercises: Vec<ProcessedExercise>,
    /// Each grouped superset of exercises will be in a vector. They will contain
    /// the `exercise.idx`.
    pub supersets: Vec<Vec<u16>>,
    pub total: WorkoutTotals,
}

#[derive(Clone, Debug, Deserialize, Serialize, InputObject)]
pub struct UserWorkoutSetRecord {
    pub statistic: SetStatistic,
    pub lot: SetLot,
}

#[derive(Clone, Debug, Deserialize, Serialize, InputObject)]
pub struct UserExerciseInput {
    pub exercise_id: i32,
    pub sets: Vec<UserWorkoutSetRecord>,
    pub notes: Vec<String>,
    pub rest_time: Option<u16>,
}

#[derive(Clone, Debug, Deserialize, Serialize, InputObject)]
pub struct UserWorkoutInput {
    pub identifier: String,
    pub name: Option<String>,
    pub comment: Option<String>,
    pub start_time: DateTimeUtc,
    pub end_time: DateTimeUtc,
    pub exercises: Vec<UserExerciseInput>,
    pub supersets: Vec<Vec<u16>>,
}
