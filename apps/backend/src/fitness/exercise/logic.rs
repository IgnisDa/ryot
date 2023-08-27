use std::cmp::Ordering;

use anyhow::{anyhow, Result};
use async_graphql::{InputObject, SimpleObject};
use chrono::Utc;
use rs_utils::LengthVec;
use rust_decimal::{prelude::FromPrimitive, Decimal};
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
        ExerciseBestSetRecord, SetLot, SetStatistic, TotalMeasurement,
        UserToExerciseBestSetExtraInformation, UserToExerciseExtraInformation,
        UserToExerciseHistoryExtraInformation, WorkoutSetPersonalBest, WorkoutSetRecord,
    },
    users::{UserDistanceUnit, UserExercisePreferences, UserWeightUnit},
};

fn get_best_set_index(records: &[WorkoutSetRecord]) -> Option<usize> {
    records
        .iter()
        .enumerate()
        .max_by_key(|(_, record)| {
            record.statistic.duration.unwrap_or(dec!(0))
                + record.statistic.distance.unwrap_or(dec!(0))
                + record
                    .statistic
                    .reps
                    .map(|r| Decimal::from_usize(r).unwrap())
                    .unwrap_or(dec!(0))
                + record.statistic.weight.unwrap_or(dec!(0))
        })
        .map(|(index, _)| index)
}

fn get_index_of_highest_pb(
    records: &[WorkoutSetRecord],
    pb_type: &WorkoutSetPersonalBest,
) -> Option<usize> {
    records
        .iter()
        .enumerate()
        .max_by(|(_, record1), (_, record2)| {
            let pb1 = record1.get_personal_best(pb_type);
            let pb2 = record2.get_personal_best(pb_type);
            match (pb1, pb2) {
                (Some(pb1), Some(pb2)) => pb1.cmp(&pb2),
                (Some(_), None) => Ordering::Greater,
                (None, Some(_)) => Ordering::Less,
                (None, None) => Ordering::Equal,
            }
        })
        .map(|(index, _)| index)
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
    pub weight_unit: UserWeightUnit,
    pub distance_unit: UserDistanceUnit,
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
    pub weight_unit: UserWeightUnit,
    pub distance_unit: UserDistanceUnit,
}

impl UserWorkoutInput {
    /// Create a workout in the database and also update user and exercise associations.
    pub async fn calculate_and_commit(
        self,
        user_id: i32,
        db: &DatabaseConnection,
        id: String,
        preferences: UserExercisePreferences,
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
                            personal_bests: vec![],
                        }),
                    };
                    user_to_ex.insert(db).await.unwrap()
                }
                Some(e) => {
                    let performed = e.num_times_performed;
                    let mut extra_info = e.extra_information.clone();
                    extra_info.history.insert(0, history_item);
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
                        total.weight += w * Decimal::from_usize(r).unwrap();
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
            let mut personal_bests = association.extra_information.personal_bests.clone();
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
            for best_type in types_of_prs.iter() {
                let set_idx = get_index_of_highest_pb(&sets, best_type).unwrap();
                let possible_record = personal_bests
                    .iter()
                    .find(|pb| pb.lot == *best_type)
                    .and_then(|record| record.sets.first());
                let set = sets.get_mut(set_idx).unwrap();
                if let Some(r) = possible_record {
                    if set.get_personal_best(best_type) > r.data.get_personal_best(best_type) {
                        set.personal_bests.push(*best_type);
                    }
                } else {
                    set.personal_bests.push(*best_type);
                }
            }
            for (set_idx, set) in sets.iter().enumerate() {
                for best in set.personal_bests.iter() {
                    let to_insert_record = ExerciseBestSetRecord {
                        workout_id: id.clone(),
                        set_idx,
                        data: set.clone(),
                    };
                    if let Some(record) = personal_bests.iter_mut().find(|pb| pb.lot == *best) {
                        let mut data = LengthVec::from_vec_and_length(
                            record.sets.clone(),
                            preferences.save_history,
                        );
                        data.push_front(to_insert_record);
                        record.sets = data.into_vec();
                    } else {
                        personal_bests.push(UserToExerciseBestSetExtraInformation {
                            lot: *best,
                            sets: vec![to_insert_record],
                        });
                    }
                }
            }
            let mut association_extra_information = association.extra_information.clone();
            let mut association: user_to_exercise::ActiveModel = association.into();
            association_extra_information.lifetime_stats += total.clone();
            association_extra_information.personal_bests = personal_bests;
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
            processed: true,
            summary: WorkoutSummary {
                total: summary_total,
                exercises: exercises
                    .iter()
                    .map(|e| WorkoutSummaryExercise {
                        num_sets: e.sets.len(),
                        name: e.exercise_name.clone(),
                        best_set: e.sets[get_best_set_index(&e.sets).unwrap()].clone(),
                    })
                    .collect(),
            },
            information: WorkoutInformation {
                supersets: self.supersets,
                exercises,
                weight_unit: self.weight_unit,
                distance_unit: self.distance_unit,
            },
        };
        let insert: workout::ActiveModel = model.into();
        let data = insert.insert(db).await?;
        Ok(data.id)
    }
}
