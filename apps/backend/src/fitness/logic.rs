use anyhow::{bail, Result};
use chrono::Utc;
use database::ExerciseLot;
use nanoid::nanoid;
use rs_utils::LengthVec;
use rust_decimal::{prelude::FromPrimitive, Decimal};
use rust_decimal_macros::dec;
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseConnection, EntityTrait, ModelTrait,
    QueryFilter,
};

use crate::{
    entities::{
        prelude::{Exercise, UserToEntity},
        user_to_entity, workout,
    },
    models::fitness::{
        ExerciseBestSetRecord, ProcessedExercise, UserToExerciseBestSetExtraInformation,
        UserToExerciseExtraInformation, UserToExerciseHistoryExtraInformation, UserWorkoutInput,
        UserWorkoutSetRecord, WorkoutInformation, WorkoutOrExerciseTotals, WorkoutSetPersonalBest,
        WorkoutSetRecord, WorkoutSetStatistic, WorkoutSetTotals, WorkoutSummary,
        WorkoutSummaryExercise,
    },
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
    let record = records.iter().reduce(|record1, record2| {
        let pb1 = record1.get_personal_best(pb_type);
        let pb2 = record2.get_personal_best(pb_type);
        match (pb1, pb2) {
            (Some(pb1), Some(pb2)) => {
                if pb1 > pb2 {
                    record1
                } else {
                    record2
                }
            }
            _ => record1,
        }
    });
    record.and_then(|r| records.iter().position(|l| l == r))
}

impl UserWorkoutSetRecord {
    /// Set the invalid statistics to `None` according to the type of exercise.
    pub fn remove_invalids(&mut self, exercise_lot: &ExerciseLot) {
        let mut stats = WorkoutSetStatistic {
            ..Default::default()
        };
        match exercise_lot {
            ExerciseLot::Duration => stats.duration = self.statistic.duration,
            ExerciseLot::DistanceAndDuration => {
                stats.distance = self.statistic.distance;
                stats.duration = self.statistic.duration;
            }
            ExerciseLot::RepsAndWeight => {
                stats.reps = self.statistic.reps;
                stats.weight = self.statistic.weight;
            }
            ExerciseLot::Reps => {
                stats.reps = self.statistic.reps;
            }
        }
        self.statistic = stats;
    }
}

impl UserWorkoutInput {
    /// Create a workout in the database and also update user and exercise associations.
    pub async fn calculate_and_commit(
        self,
        user_id: i32,
        db: &DatabaseConnection,
        save_history: usize,
    ) -> Result<String> {
        let mut input = self;
        let id = input.id.unwrap_or_else(|| nanoid!(12));
        let mut exercises = vec![];
        let mut workout_totals = vec![];
        if input.exercises.is_empty() {
            bail!("This workout has no associated exercises")
        }
        for (exercise_idx, ex) in input.exercises.iter_mut().enumerate() {
            if ex.sets.is_empty() {
                bail!("This exercise has no associated sets")
            }
            let db_ex = match Exercise::find_by_id(ex.exercise_id.clone()).one(db).await? {
                None => {
                    tracing::error!("Exercise with id = {} not found", ex.exercise_id);
                    continue;
                }
                Some(e) => e,
            };
            let mut sets = vec![];
            let mut total = WorkoutOrExerciseTotals::default();
            let association = UserToEntity::find()
                .filter(user_to_entity::Column::UserId.eq(user_id))
                .filter(user_to_entity::Column::ExerciseId.eq(ex.exercise_id.clone()))
                .one(db)
                .await
                .ok()
                .flatten();
            let history_item = UserToExerciseHistoryExtraInformation {
                workout_id: id.clone(),
                idx: exercise_idx,
            };
            let association = match association {
                None => {
                    let user_to_ex = user_to_entity::ActiveModel {
                        user_id: ActiveValue::Set(user_id),
                        exercise_id: ActiveValue::Set(Some(ex.exercise_id.clone())),
                        exercise_extra_information: ActiveValue::Set(Some(
                            UserToExerciseExtraInformation {
                                history: vec![history_item],
                                lifetime_stats: WorkoutOrExerciseTotals::default(),
                                personal_bests: vec![],
                            },
                        )),
                        ..Default::default()
                    };
                    user_to_ex.insert(db).await.unwrap()
                }
                Some(e) => {
                    let performed = e.num_times_interacted;
                    let mut extra_info = e.exercise_extra_information.clone().unwrap();
                    extra_info.history.insert(0, history_item);
                    let mut up: user_to_entity::ActiveModel = e.into();
                    up.num_times_interacted = ActiveValue::Set(performed + 1);
                    up.exercise_extra_information = ActiveValue::Set(Some(extra_info));
                    up.last_updated_on = ActiveValue::Set(Utc::now());
                    up.update(db).await?
                }
            };
            if let Some(d) = ex.rest_time {
                total.rest_time += d * (ex.sets.len() - 1) as u16;
            }
            ex.sets
                .sort_unstable_by_key(|s| s.confirmed_at.unwrap_or_default());
            for set in ex.sets.iter_mut() {
                set.remove_invalids(&db_ex.lot);
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
                let mut totals = WorkoutSetTotals::default();
                if let (Some(we), Some(re)) = (&set.statistic.weight, &set.statistic.reps) {
                    totals.weight = Some(we * Decimal::from_usize(*re).unwrap());
                }
                let mut value = WorkoutSetRecord {
                    statistic: set.statistic.clone(),
                    lot: set.lot,
                    confirmed_at: set.confirmed_at,
                    totals,
                    personal_bests: vec![],
                };
                value.statistic.one_rm = value.calculate_one_rm();
                value.statistic.pace = value.calculate_pace();
                value.statistic.volume = value.calculate_volume();
                sets.push(value);
            }
            let mut personal_bests = association
                .exercise_extra_information
                .clone()
                .unwrap()
                .personal_bests;
            let types_of_prs = match db_ex.lot {
                ExerciseLot::Duration => vec![WorkoutSetPersonalBest::Time],
                ExerciseLot::DistanceAndDuration => {
                    vec![WorkoutSetPersonalBest::Pace, WorkoutSetPersonalBest::Time]
                }
                ExerciseLot::RepsAndWeight => vec![
                    WorkoutSetPersonalBest::Weight,
                    WorkoutSetPersonalBest::OneRm,
                    WorkoutSetPersonalBest::Volume,
                    WorkoutSetPersonalBest::Reps,
                ],
                ExerciseLot::Reps => vec![WorkoutSetPersonalBest::Reps],
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
                        total.personal_bests_achieved += 1;
                    }
                } else {
                    set.personal_bests.push(*best_type);
                    total.personal_bests_achieved += 1;
                }
            }
            workout_totals.push(total.clone());
            for (set_idx, set) in sets.iter().enumerate() {
                for best in set.personal_bests.iter() {
                    let to_insert_record = ExerciseBestSetRecord {
                        workout_id: id.clone(),
                        workout_done_on: input.end_time,
                        exercise_idx,
                        set_idx,
                        data: set.clone(),
                    };
                    if let Some(record) = personal_bests.iter_mut().find(|pb| pb.lot == *best) {
                        let mut data =
                            LengthVec::from_vec_and_length(record.sets.clone(), save_history);
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
            let mut association_extra_information =
                association.exercise_extra_information.clone().unwrap();
            let mut association: user_to_entity::ActiveModel = association.into();
            association_extra_information.lifetime_stats += total.clone();
            association_extra_information.personal_bests = personal_bests;
            association.exercise_extra_information =
                ActiveValue::Set(Some(association_extra_information));
            association.update(db).await?;
            exercises.push((
                db_ex.lot,
                ProcessedExercise {
                    name: db_ex.id,
                    lot: db_ex.lot,
                    sets,
                    notes: ex.notes.clone(),
                    rest_time: ex.rest_time,
                    assets: ex.assets.clone(),
                    superset_with: ex.superset_with.clone(),
                    total,
                },
            ));
        }
        let summary_total = workout_totals.into_iter().sum();
        let model = workout::Model {
            id,
            end_time: input.end_time,
            start_time: input.start_time,
            repeated_from: input.repeated_from,
            user_id,
            name: input.name,
            comment: input.comment,
            summary: WorkoutSummary {
                total: summary_total,
                exercises: exercises
                    .iter()
                    .map(|(lot, e)| WorkoutSummaryExercise {
                        num_sets: e.sets.len(),
                        id: e.name.clone(),
                        lot: *lot,
                        best_set: e.sets[get_best_set_index(&e.sets).unwrap()].clone(),
                    })
                    .collect(),
            },
            information: WorkoutInformation {
                assets: input.assets.clone(),
                exercises: exercises.into_iter().map(|(_, ex)| ex).collect(),
            },
        };
        let insert: workout::ActiveModel = model.into();
        let data = insert.insert(db).await?;
        Ok(data.id)
    }
}

impl workout::Model {
    // DEV: For exercises, reduce count, remove from history if present. We will not
    // recalculate exercise associations totals or change personal bests.
    pub async fn delete_existing(self, db: &DatabaseConnection, user_id: i32) -> Result<()> {
        for (idx, ex) in self.information.exercises.iter().enumerate() {
            let association = match UserToEntity::find()
                .filter(user_to_entity::Column::UserId.eq(user_id))
                .filter(user_to_entity::Column::ExerciseId.eq(ex.name.clone()))
                .one(db)
                .await?
            {
                None => continue,
                Some(assoc) => assoc,
            };
            let performed = association.num_times_interacted;
            let mut ei = association.exercise_extra_information.clone().unwrap();
            if let Some(ex_idx) = ei
                .history
                .iter()
                .position(|e| e.workout_id == self.id && e.idx == idx)
            {
                ei.history.remove(ex_idx);
            }
            let mut association: user_to_entity::ActiveModel = association.into();
            association.num_times_interacted = ActiveValue::Set(performed - 1);
            association.exercise_extra_information = ActiveValue::Set(Some(ei));
            association.update(db).await?;
        }
        self.delete(db).await?;
        Ok(())
    }
}
