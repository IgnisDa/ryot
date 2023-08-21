use std::cmp::Ordering;

use anyhow::{anyhow, Result};
use async_graphql::{InputObject, SimpleObject};
use chrono::Utc;
use rust_decimal_macros::dec;
use sea_orm::{
    prelude::DateTimeUtc, ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseConnection,
    EntityTrait, FromJsonQueryResult, QueryFilter,
};
use serde::{Deserialize, Serialize};

use crate::{
    entities::{
        prelude::{Exercise, UserToExercise},
        user_to_exercise, workout,
    },
    migrator::ExerciseLot,
    models::fitness::{
        SetLot, SetStatistic, TotalMeasurement, UserToExerciseExtraInformation,
        UserToExerciseHistoryExtraInformation, WorkoutSetPersonalBest, WorkoutSetRecord,
    },
};

fn get_best_set(records: &[WorkoutSetRecord]) -> Option<&WorkoutSetRecord> {
    records.iter().max_by_key(|record| {
        record.statistic.duration.unwrap_or(dec!(0))
            + record.statistic.distance.unwrap_or(dec!(0))
            + record.statistic.reps.unwrap_or(dec!(0))
            + record.statistic.weight.unwrap_or(dec!(0))
    })
}

pub fn get_highest_personal_best(
    records: &[WorkoutSetRecord],
    pb_type: WorkoutSetPersonalBest,
) -> Option<&WorkoutSetRecord> {
    records.iter().max_by(|record1, record2| {
        let pb1 = record1.get_personal_best(pb_type).unwrap_or(dec!(0.0));
        let pb2 = record2.get_personal_best(pb_type).unwrap_or(dec!(0.0));
        pb1.partial_cmp(&pb2).unwrap_or(Ordering::Equal)
    })
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
    pub num_sets: usize,
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
        id: String,
    ) -> Result<String> {
        let mut exercises = vec![];
        let mut workout_totals = vec![];
        for (idx, ex) in self.exercises.into_iter().enumerate() {
            let db_ex = Exercise::find_by_id(ex.exercise_id)
                .one(db)
                .await?
                .ok_or_else(|| anyhow!("No exercise found!"))?;
            let mut sets = vec![];
            let mut total = TotalMeasurement::default();
            let association = UserToExercise::find()
                .filter(user_to_exercise::Column::UserId.eq(user_id))
                .filter(user_to_exercise::Column::ExerciseId.eq(ex.exercise_id))
                .one(db)
                .await
                .ok()
                .flatten();
            let history_item = UserToExerciseHistoryExtraInformation {
                workout_id: id.clone(),
                idx,
            };
            let association = match association {
                None => {
                    let user_to_ex = user_to_exercise::ActiveModel {
                        user_id: ActiveValue::Set(user_id),
                        exercise_id: ActiveValue::Set(ex.exercise_id),
                        num_times_performed: ActiveValue::Set(1),
                        last_updated_on: ActiveValue::Set(Utc::now()),
                        extra_information: ActiveValue::Set(UserToExerciseExtraInformation {
                            history: vec![history_item],
                            lifetime_stats: TotalMeasurement::default(),
                            best_set: None,
                        }),
                    };
                    user_to_ex.insert(db).await.unwrap()
                }
                Some(e) => {
                    let performed = e.num_times_performed;
                    let mut extra_info = e.extra_information.clone();
                    extra_info.history.push(history_item);
                    let mut up: user_to_exercise::ActiveModel = e.into();
                    up.num_times_performed = ActiveValue::Set(performed + 1);
                    up.extra_information = ActiveValue::Set(extra_info);
                    up.last_updated_on = ActiveValue::Set(Utc::now());
                    up.update(db).await?
                }
            };
            for set in ex.sets {
                if let Some(r) = set.statistic.reps {
                    total.reps += r;
                    if let Some(w) = set.statistic.weight {
                        total.weight += w * r;
                    }
                }
                if let Some(d) = set.statistic.duration {
                    total.duration += d;
                }
                if let Some(d) = set.statistic.distance {
                    total.distance += d;
                }
                sets.push(WorkoutSetRecord {
                    statistic: set.statistic,
                    lot: set.lot,
                    personal_bests: vec![],
                });
            }
            workout_totals.push(total.clone());
            let best_set = association.extra_information.best_set.clone();
            let mut m_d = sets.clone();
            if let Some(bs) = &best_set {
                m_d.push(bs.data.clone());
            }
            for set in sets.iter_mut() {
                let mut personal_bests = vec![];
                let types_of_prs = match db_ex.lot {
                    ExerciseLot::Duration => vec![WorkoutSetPersonalBest::Time],
                    ExerciseLot::DistanceAndDuration => {
                        vec![WorkoutSetPersonalBest::Pace, WorkoutSetPersonalBest::Time]
                    }
                    ExerciseLot::RepsAndWeight => vec![
                        WorkoutSetPersonalBest::Weight,
                        WorkoutSetPersonalBest::OneRm,
                        WorkoutSetPersonalBest::Volume,
                    ],
                };
                for best_type in types_of_prs {
                    let best_s = get_highest_personal_best(&m_d, best_type);
                    if let Some(s) = best_s {
                        if s == set {
                            personal_bests.push(best_type);
                        }
                    }
                }
                total.personal_bests_achieved = personal_bests.len();
                set.personal_bests = personal_bests;
            }
            let mut association_extra_information = association.extra_information.clone();
            let mut association: user_to_exercise::ActiveModel = association.into();
            association_extra_information.lifetime_stats += total.clone();
            association_extra_information.best_set = best_set;
            association.extra_information = ActiveValue::Set(association_extra_information);
            association.update(db).await?;
            exercises.push(ProcessedExercise {
                exercise_id: ex.exercise_id,
                exercise_name: db_ex.name,
                sets,
                notes: ex.notes,
                rest_time: ex.rest_time,
                total,
            });
        }
        let summary_total = workout_totals.into_iter().sum();
        let model = workout::Model {
            id,
            start_time: self.start_time,
            end_time: self.end_time,
            user_id,
            name: self.name,
            comment: self.comment,
            // TODO: Mark as true when calculation code is complete.
            processed: false,
            summary: WorkoutSummary {
                total: summary_total,
                exercises: exercises
                    .iter()
                    .map(|e| WorkoutSummaryExercise {
                        num_sets: e.sets.len(),
                        name: e.exercise_name.clone(),
                        best_set: get_best_set(&e.sets).unwrap().clone(),
                    })
                    .collect(),
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
