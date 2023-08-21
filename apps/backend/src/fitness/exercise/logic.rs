use anyhow::{anyhow, Result};
use async_graphql::{Enum, InputObject, SimpleObject};
use sea_orm::{
    prelude::DateTimeUtc, ActiveModelTrait, DatabaseConnection, EntityTrait, FromJsonQueryResult,
};
use serde::{Deserialize, Serialize};
use serde_with::skip_serializing_none;

use crate::entities::{prelude::Exercise, workout};

#[skip_serializing_none]
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
    Debug, FromJsonQueryResult, Clone, Serialize, Deserialize, Eq, PartialEq, SimpleObject, Default,
)]
pub struct TotalMeasurement {
    /// The number of personal bests achieved.
    pub personal_bests: u16,
    pub weight: u16,
    pub reps: u16,
    // The time in seconds.
    pub active_duration: u64,
}

#[derive(
    Clone, Debug, Deserialize, Serialize, FromJsonQueryResult, Eq, PartialEq, SimpleObject,
)]
pub struct ProcessedExercise {
    pub exercise_name: String,
    pub exercise_id: i32,
    pub sets: Vec<WorkoutSetRecord>,
    pub notes: Vec<String>,
    pub rest_time: Option<u16>,
    pub total: TotalMeasurement,
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
    pub total: TotalMeasurement,
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
    /// Create a workout in the database and also update user and exercise associations.
    pub async fn calculate_and_commit(
        self,
        user_id: i32,
        db: &DatabaseConnection,
    ) -> Result<String> {
        let mut exercises = vec![];
        for ex in self.exercises {
            let db_ex = Exercise::find_by_id(ex.exercise_id)
                .one(db)
                .await?
                .ok_or_else(|| anyhow!("No exercise found!"))?;
            let mut sets = vec![];
            let mut total = TotalMeasurement::default();
            for set in ex.sets {
                if let Some(r) = set.statistic.reps {
                    total.reps += r;
                    if let Some(w) = set.statistic.weight {
                        total.weight += w * r;
                    }
                }
                sets.push(WorkoutSetRecord {
                    statistic: set.statistic,
                    lot: set.lot,
                    // FIXME: Correct calculations
                    personal_bests: vec![],
                });
            }
            exercises.push(ProcessedExercise {
                exercise_id: ex.exercise_id,
                exercise_name: db_ex.name,
                sets,
                notes: ex.notes,
                rest_time: ex.rest_time,
                total,
            });
        }
        let model = workout::Model {
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
                total: TotalMeasurement {
                    personal_bests: 0,
                    weight: 0,
                    reps: 0,
                    active_duration: 0,
                },
                exercises: vec![],
            },
            information: WorkoutInformation {
                supersets: self.supersets,
                exercises,
            },
        };
        let insert: workout::ActiveModel = model.into();
        let data = insert.insert(db).await?;
        Ok(data.id)
    }
}
