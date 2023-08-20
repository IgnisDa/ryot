use anyhow::Result;
use async_graphql::{Enum, InputObject, SimpleObject};
use sea_orm::{prelude::DateTimeUtc, DatabaseConnection, FromJsonQueryResult};
use serde::{Deserialize, Serialize};

use crate::entities::workout;

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
    // The time in seconds.
    pub active_duration: u64,
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
pub struct WorkoutInformation {
    /// Each grouped superset of exercises will be in a vector. They will contain
    /// the `exercise.idx`.
    pub supersets: Vec<Vec<u16>>,
    pub exercises: Vec<ProcessedExercise>,
}

#[derive(
    Clone, Debug, Deserialize, Serialize, FromJsonQueryResult, Eq, PartialEq, SimpleObject,
)]
pub struct WorkoutSummaryExercise {
    pub num_sets: u16,
    pub name: String,
    pub best_set: WorkoutSetRecord,
}

#[derive(
    Clone, Debug, Deserialize, Serialize, FromJsonQueryResult, Eq, PartialEq, SimpleObject,
)]
pub struct WorkoutSummary {
    pub total: WorkoutTotals,
    pub exercises: Vec<WorkoutSummaryExercise>,
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

impl UserWorkoutInput {
    pub async fn calculate(self, user_id: i32, db: &DatabaseConnection) -> Result<workout::Model> {
        Ok(workout::Model {
            id: self.identifier,
            start_time: self.start_time,
            end_time: self.end_time,
            user_id,
            name: self.name,
            comment: self.comment,
            // TODO: Mark as true when calculation code is complete.
            processed: false,
            // FIXME: Correct calculations
            summary: WorkoutSummary {
                total: WorkoutTotals {
                    personal_bests: 0,
                    weight: 0,
                    reps: 0,
                    active_duration: 0,
                },
                exercises: vec![],
            },
            information: WorkoutInformation {
                supersets: self.supersets,
                exercises: self
                    .exercises
                    .into_iter()
                    .map(|e| ProcessedExercise {
                        exercise_id: e.exercise_id,
                        sets: e
                            .sets
                            .into_iter()
                            .map(|s| WorkoutSetRecord {
                                statistic: s.statistic,
                                lot: s.lot,
                                // FIXME: Correct calculations
                                personal_bests: vec![],
                            })
                            .collect(),
                        notes: e.notes,
                        rest_time: e.rest_time,
                        // FIXME: Correct calculations
                        total: WorkoutTotals {
                            personal_bests: 0,
                            weight: 0,
                            reps: 0,
                            active_duration: 0,
                        },
                    })
                    .collect(),
            },
        })
    }
}
